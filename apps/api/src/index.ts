import {
  type HealthResponse,
  type SessionResponse,
  updateCropCycleRequestSchema,
  uuidSchema,
} from "@agrosense/contracts";
import { Hono } from "hono";
import { type ApiEnv, requireAuth } from "./lib/auth";
import { CropCycleError, updateCropCycle } from "./lib/crop-cycle";
import { DashboardPayloadLimitError, loadDashboard } from "./lib/dashboard";
import { RefreshError, refreshFarm } from "./lib/refresh";
import { readLimitedRequestBody } from "./lib/request-body";
import { createServiceClient } from "./lib/supabase";
import { satelliteRoutes } from "./satellite/routes";

const app = new Hono<ApiEnv>();
app.route("/", satelliteRoutes);

app.get("/api/health", (c) =>
  c.json({ status: "ok", service: "agrosense-api" } satisfies HealthResponse),
);

app.get("/api/session", requireAuth, (c) =>
  c.json({ userId: c.get("userId") } satisfies SessionResponse),
);

app.get("/api/farms/:farmId/dashboard", requireAuth, async (c) => {
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
  if (!uuidSchema.safeParse(farmId).success)
    return c.json(
      { error: { code: "BAD_REQUEST", message: "farmId must be a UUID" } },
      400,
    );
  try {
    const dashboard = await loadDashboard(c.get("supabase"), farmId);
    if (!dashboard)
      return c.json(
        { error: { code: "NOT_FOUND", message: "Farm not found" } },
        404,
      );
    return c.json(dashboard);
  } catch (error) {
    if (error instanceof DashboardPayloadLimitError)
      return c.json(
        { error: { code: "PAYLOAD_LIMIT_EXCEEDED", message: error.message } },
        413,
      );
    throw error;
  }
});

app.post("/api/farms/:farmId/refresh", requireAuth, async (c) => {
  c.header("Cache-Control", "private, no-store");
  if (
    Object.keys(c.req.query()).length > 0 ||
    (await c.req.text()).trim().length > 0
  )
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
  if (!uuidSchema.safeParse(farmId).success)
    return c.json(
      { error: { code: "BAD_REQUEST", message: "farmId must be a UUID" } },
      400,
    );
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
        return c.json(
          { error: { code: "NOT_FOUND", message: "Farm not found" } },
          404,
        );
      case "rate_limited":
        c.header("Retry-After", String(error.failure.retryAfter));
        return c.json(
          {
            error: {
              code: "RATE_LIMITED",
              message: "Farm refresh is cooling down",
            },
          },
          429,
        );
      case "conflict":
        return c.json(
          {
            error: {
              code: "VERSION_CONFLICT",
              message: "Farm changed during refresh",
            },
          },
          409,
        );
      case "unavailable":
        return c.json(
          {
            error: {
              code: "REFRESH_UNAVAILABLE",
              message: "Refresh provider is unavailable",
            },
          },
          503,
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

app.notFound((c) =>
  c.json({ error: { code: "NOT_FOUND", message: "Route not found" } }, 404),
);

app.onError((error, c) => {
  console.error(error);
  return c.json(
    { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
    500,
  );
});

export default app;
