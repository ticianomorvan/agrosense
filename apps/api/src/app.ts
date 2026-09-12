import {
  type HealthResponse,
  type SessionResponse,
  updateCropCycleRequestSchema,
  uuidSchema,
} from "@agrosense/contracts";
import { Hono } from "hono";
import type { ApiEnv } from "./env";
import { requireAuth } from "./lib/auth";
import { CropCycleError, updateCropCycle } from "./lib/crop-cycle";
import { DashboardPayloadLimitError, loadDashboard } from "./lib/dashboard";
import { jsonError } from "./lib/http";
import { RefreshError, refreshFarm } from "./lib/refresh";
import { readLimitedRequestBody } from "./lib/request-body";
import { createServiceClient } from "./lib/supabase";
import { whatsapp } from "./whatsapp";

const app = new Hono<ApiEnv>();

app.route("/api/whatsapp", whatsapp);

app.get("/api/health", (c) =>
  c.json({ status: "ok", service: "agrosense-api" } satisfies HealthResponse),
);

app.get("/api/session", requireAuth, (c) =>
  c.json({ userId: c.get("userId") } satisfies SessionResponse),
);

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
  if (
    Object.keys(c.req.query()).length > 0 ||
    (await c.req.text()).trim().length > 0
  )
    return jsonError(c, 400, "BAD_REQUEST", "Query parameters are unsupported");
  const farmId = c.req.param("farmId");
  if (!uuidSchema.safeParse(farmId).success)
    return jsonError(c, 400, "BAD_REQUEST", "farmId must be a UUID");
  try {
    const response = await refreshFarm(
      c.get("supabase"),
      createServiceClient(c.env),
      farmId,
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
      return c.json(
        {
          error: {
            code: "BAD_REQUEST",
            message: "Query parameters are unsupported",
          },
        },
        400,
      );
    const farmId = c.req.param("farmId");
    const plotId = c.req.param("plotId");
    if (
      !uuidSchema.safeParse(farmId).success ||
      !uuidSchema.safeParse(plotId).success
    )
      return c.json(
        {
          error: {
            code: "BAD_REQUEST",
            message: "farmId and plotId must be UUIDs",
          },
        },
        400,
      );
    const rawBody = await readLimitedRequestBody(c.req.raw, 16 * 1024);
    if (rawBody === null)
      return c.json(
        {
          error: {
            code: "PAYLOAD_TOO_LARGE",
            message: "Request body is too large",
          },
        },
        413,
      );
    let body: unknown;
    try {
      body = JSON.parse(rawBody);
    } catch {
      return c.json(
        {
          error: { code: "BAD_REQUEST", message: "Request body must be JSON" },
        },
        400,
      );
    }
    const parsed = updateCropCycleRequestSchema.safeParse(body);
    if (!parsed.success)
      return c.json(
        {
          error: { code: "BAD_REQUEST", message: "Invalid crop-cycle request" },
        },
        400,
      );
    try {
      return c.json(
        await updateCropCycle(c.get("supabase"), farmId, plotId, parsed.data),
      );
    } catch (error) {
      if (!(error instanceof CropCycleError)) throw error;
      if (error.failure.kind === "not_found")
        return c.json(
          {
            error: {
              code: "NOT_FOUND",
              message: "Farm, plot, or crop cycle not found",
            },
          },
          404,
        );
      if (error.failure.kind === "conflict")
        return c.json(
          {
            error: {
              code: "VERSION_CONFLICT",
              message: "Farm data has changed",
            },
          },
          409,
        );
      return c.json(
        { error: { code: "BAD_REQUEST", message: error.failure.message } },
        400,
      );
    }
  },
);

app.notFound((c) => jsonError(c, 404, "NOT_FOUND", "Route not found"));

app.onError((error, c) => {
  console.error(error);
  return jsonError(c, 500, "INTERNAL_ERROR", "Internal server error");
});

export default app;
