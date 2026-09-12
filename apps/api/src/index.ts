import {
  type HealthResponse,
  type SessionResponse,
  uuidSchema,
} from "@agrosense/contracts";
import { Hono } from "hono";
import { type ApiEnv, requireAuth } from "./lib/auth";
import { DashboardPayloadLimitError, loadDashboard } from "./lib/dashboard";
import { RefreshError, refreshFarm } from "./lib/refresh";
import { createServiceClient } from "./lib/supabase";

const app = new Hono<ApiEnv>();

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
