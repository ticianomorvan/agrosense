import type { HealthResponse, SessionResponse } from "@agrosense/contracts";
import { Hono } from "hono";
import { type ApiEnv, requireAuth } from "./lib/auth";
import { loadDashboard } from "./lib/dashboard";

const app = new Hono<ApiEnv>();

app.get("/api/health", (c) =>
  c.json({ status: "ok", service: "agrosense-api" } satisfies HealthResponse),
);

app.get("/api/session", requireAuth, (c) =>
  c.json({ userId: c.get("userId") } satisfies SessionResponse),
);

app.get("/api/farms/:farmId/dashboard", requireAuth, async (c) => {
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
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      farmId,
    )
  )
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
    c.header("Cache-Control", "private, no-store");
    return c.json(dashboard);
  } catch (error) {
    console.error(error);
    return c.json(
      { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
      500,
    );
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
