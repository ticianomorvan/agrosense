import {
  authConfigResponseSchema,
  createFarmRequestSchema,
  createPlotRequestSchema,
  type HealthResponse,
  type SessionResponse,
  updateCropCycleRequestSchema,
  uuidSchema,
} from "@agrosense/contracts";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { automationRoutes } from "./automation/routes";
import type { ApiEnv } from "./env";
import { requireAuth } from "./lib/auth";
import { CropCycleError, updateCropCycle } from "./lib/crop-cycle";
import { DashboardPayloadLimitError, loadDashboard } from "./lib/dashboard";
import { jsonError } from "./lib/http";
import {
  createFarm,
  createPlot,
  listFarms,
  OnboardingError,
} from "./lib/onboarding";
import { RefreshError, refreshFarm } from "./lib/refresh";
import { readLimitedRequestBody } from "./lib/request-body";
import { createServiceClient, readSupabaseConfig } from "./lib/supabase";
import { satelliteRoutes } from "./satellite/routes";
import { whatsapp } from "./whatsapp";

const app = new Hono<ApiEnv>();
app.use(
  "/api/*",
  cors({
    origin: (origin, c) => (origin === c.env?.CORS_ORIGIN ? origin : undefined),
    allowHeaders: ["Authorization", "Content-Type"],
    allowMethods: ["GET", "HEAD", "POST", "PATCH", "OPTIONS"],
    maxAge: 86400,
  }),
);
app.route("/", automationRoutes);

app.route("/api/whatsapp", whatsapp);
app.route("/", satelliteRoutes);

app.get("/api/health", (c) =>
  c.json({ status: "ok", service: "agrosense-api" } satisfies HealthResponse),
);

app.get("/api/auth/config", (c) => {
  c.header("Cache-Control", "no-store");
  try {
    const config = readSupabaseConfig(c.env);
    return c.json(
      authConfigResponseSchema.parse({
        url: config.url,
        publishableKey: config.publishableKey,
      }),
    );
  } catch {
    return jsonError(
      c,
      503,
      "AUTH_UNAVAILABLE",
      "Authentication is temporarily unavailable",
    );
  }
});

app.get("/api/session", requireAuth, (c) => {
  c.header("Cache-Control", "private, no-store");
  return c.json({ userId: c.get("userId") } satisfies SessionResponse);
});

app.get("/api/farms", requireAuth, async (c) => {
  c.header("Cache-Control", "private, no-store");
  if (Object.keys(c.req.query()).length > 0)
    return jsonError(c, 400, "BAD_REQUEST", "Query parameters are unsupported");
  return c.json(await listFarms(c.get("supabase")));
});

app.post("/api/farms", requireAuth, async (c) => {
  c.header("Cache-Control", "private, no-store");
  if (Object.keys(c.req.query()).length > 0)
    return jsonError(c, 400, "BAD_REQUEST", "Query parameters are unsupported");
  const rawBody = await readLimitedRequestBody(c.req.raw, 16 * 1024);
  if (rawBody === null)
    return jsonError(c, 413, "PAYLOAD_TOO_LARGE", "Request body is too large");
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonError(c, 400, "BAD_REQUEST", "Request body must be JSON");
  }
  const request = createFarmRequestSchema.safeParse(body);
  if (!request.success)
    return jsonError(c, 400, "BAD_REQUEST", "Invalid farm setup request");
  try {
    const created = await createFarm(
      createServiceClient(c.env),
      c.get("userId"),
      request.data,
    );
    return c.json(created, 201);
  } catch (error) {
    return onboardingError(c, error);
  }
});

app.post("/api/farms/:farmId/plots", requireAuth, async (c) => {
  c.header("Cache-Control", "private, no-store");
  if (Object.keys(c.req.query()).length > 0)
    return jsonError(c, 400, "BAD_REQUEST", "Query parameters are unsupported");
  const farmId = c.req.param("farmId");
  if (!uuidSchema.safeParse(farmId).success)
    return jsonError(c, 400, "BAD_REQUEST", "farmId must be a UUID");
  const rawBody = await readLimitedRequestBody(c.req.raw, 16 * 1024);
  if (rawBody === null)
    return jsonError(c, 413, "PAYLOAD_TOO_LARGE", "Request body is too large");
  let body: unknown;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return jsonError(c, 400, "BAD_REQUEST", "Request body must be JSON");
  }
  const request = createPlotRequestSchema.safeParse(body);
  if (!request.success)
    return jsonError(c, 400, "BAD_REQUEST", "Invalid plot setup request");
  try {
    const created = await createPlot(
      createServiceClient(c.env),
      c.get("userId"),
      farmId,
      request.data,
    );
    return c.json(created, 201);
  } catch (error) {
    return onboardingError(c, error);
  }
});

app.get("/api/farms/:farmId/dashboard", requireAuth, async (c) => {
  c.header("Cache-Control", "private, no-store");
  if (Object.keys(c.req.query()).length > 0)
    return jsonError(c, 400, "BAD_REQUEST", "Query parameters are unsupported");
  const farmId = c.req.param("farmId");
  if (!uuidSchema.safeParse(farmId).success)
    return jsonError(c, 400, "BAD_REQUEST", "farmId must be a UUID");
  try {
    const dashboard = await loadDashboard(c.get("supabase"), farmId);
    if (!dashboard) return jsonError(c, 404, "NOT_FOUND", "Farm not found");
    return c.json(dashboard);
  } catch (error) {
    if (error instanceof DashboardPayloadLimitError)
      return jsonError(c, 413, "PAYLOAD_LIMIT_EXCEEDED", error.message);
    throw error;
  }
});

app.post("/api/farms/:farmId/refresh", requireAuth, async (c) => {
  c.header("Cache-Control", "private, no-store");
  if (Object.keys(c.req.query()).length > 0)
    return jsonError(c, 400, "BAD_REQUEST", "Query parameters are unsupported");
  const rawBody = await readLimitedRequestBody(c.req.raw, 16 * 1024);
  if (rawBody === null)
    return jsonError(c, 413, "PAYLOAD_TOO_LARGE", "Request body is too large");
  if (rawBody.trim().length > 0)
    return jsonError(c, 400, "BAD_REQUEST", "Request body is unsupported");
  const farmId = c.req.param("farmId");
  if (!uuidSchema.safeParse(farmId).success)
    return jsonError(c, 400, "BAD_REQUEST", "farmId must be a UUID");
  try {
    const response = await refreshFarm(
      c.get("supabase"),
      createServiceClient(c.env),
      farmId,
      c.get("userId"),
      new Date(),
      { apiKey: c.env?.OPEN_METEO_API_KEY },
    );
    return c.json(response);
  } catch (error) {
    if (!(error instanceof RefreshError)) throw error;
    switch (error.failure.kind) {
      case "not_found":
        return jsonError(c, 404, "NOT_FOUND", "Farm not found");
      case "rate_limited":
        c.header("Retry-After", String(error.failure.retryAfter));
        return jsonError(
          c,
          429,
          "RATE_LIMITED",
          "Farm refresh is cooling down",
        );
      case "conflict":
        return jsonError(
          c,
          409,
          "VERSION_CONFLICT",
          "Farm changed during refresh",
        );
      case "stale_provider":
        return jsonError(
          c,
          409,
          "STALE_PROVIDER_DATA",
          "Provider issuance is older than stored data",
        );
      case "payload_limit":
        return jsonError(
          c,
          413,
          "PAYLOAD_LIMIT_EXCEEDED",
          "Refresh exceeds its payload limits",
        );
      case "unavailable":
        return jsonError(
          c,
          503,
          "REFRESH_UNAVAILABLE",
          "Refresh provider is unavailable",
        );
    }
  }
});

app.patch(
  "/api/farms/:farmId/plots/:plotId/crop-cycle",
  requireAuth,
  async (c) => {
    c.header("Cache-Control", "private, no-store");
    if (Object.keys(c.req.query()).length > 0)
      return jsonError(
        c,
        400,
        "BAD_REQUEST",
        "Query parameters are unsupported",
      );
    const farmId = c.req.param("farmId");
    const plotId = c.req.param("plotId");
    if (
      !uuidSchema.safeParse(farmId).success ||
      !uuidSchema.safeParse(plotId).success
    )
      return jsonError(
        c,
        400,
        "BAD_REQUEST",
        "farmId and plotId must be UUIDs",
      );
    const rawBody = await readLimitedRequestBody(c.req.raw, 16 * 1024);
    if (rawBody === null)
      return jsonError(
        c,
        413,
        "PAYLOAD_TOO_LARGE",
        "Request body is too large",
      );
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return jsonError(c, 400, "BAD_REQUEST", "Request body must be JSON");
    }
    const parsed = updateCropCycleRequestSchema.safeParse(body);
    if (!parsed.success)
      return jsonError(c, 400, "BAD_REQUEST", "Invalid crop-cycle request");
    try {
      return c.json(
        await updateCropCycle(c.get("supabase"), farmId, plotId, parsed.data),
      );
    } catch (error) {
      if (!(error instanceof CropCycleError)) throw error;
      if (error.failure.kind === "not_found")
        return jsonError(
          c,
          404,
          "NOT_FOUND",
          "Farm, plot, or crop cycle not found",
        );
      if (error.failure.kind === "conflict")
        return jsonError(c, 409, "VERSION_CONFLICT", "Farm data has changed");
      return jsonError(c, 400, "BAD_REQUEST", error.failure.message);
    }
  },
);

app.notFound((c) => jsonError(c, 404, "NOT_FOUND", "Route not found"));

app.onError((error, c) => {
  console.error(error);
  return jsonError(c, 500, "INTERNAL_ERROR", "Internal server error");
});

export default app;

function onboardingError(
  context: Parameters<typeof jsonError>[0],
  error: unknown,
) {
  if (!(error instanceof OnboardingError)) throw error;
  switch (error.kind) {
    case "not_found":
      return jsonError(context, 404, "NOT_FOUND", error.message);
    case "conflict":
    case "duplicate":
      return jsonError(context, 409, "VERSION_CONFLICT", error.message);
    case "limit":
      return jsonError(context, 413, "PAYLOAD_LIMIT_EXCEEDED", error.message);
    case "invalid":
      return jsonError(context, 422, "VALIDATION_ERROR", error.message);
  }
}
