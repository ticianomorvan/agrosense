import {
  type HealthResponse,
  type SessionResponse,
  uuidSchema,
} from "@agrosense/contracts";
import { Hono } from "hono";
import { whatsappAgentRoutes } from "./agent/routes";
import type { ApiEnv } from "./env";
import { requireAuth } from "./lib/auth";
import { DashboardPayloadLimitError, loadDashboard } from "./lib/dashboard";
import { jsonError } from "./lib/http";
import { RefreshError, refreshFarm } from "./lib/refresh";
import { createServiceClient } from "./lib/supabase";
import { whatsapp } from "./whatsapp";

const app = new Hono<ApiEnv>();

app.route("/api/whatsapp", whatsapp);
app.route("/api/whatsapp", whatsappAgentRoutes);

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

app.notFound((c) => jsonError(c, 404, "NOT_FOUND", "Route not found"));

app.onError((error, c) => {
  console.error(error);
  return jsonError(c, 500, "INTERNAL_ERROR", "Internal server error");
});

export default app;
