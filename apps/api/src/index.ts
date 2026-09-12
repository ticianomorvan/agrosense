import type { HealthResponse, SessionResponse } from "@agrosense/contracts";
import { Hono } from "hono";
import { type ApiEnv, requireAuth } from "./lib/auth";
import { whatsapp } from "./whatsapp";

const app = new Hono<ApiEnv>();

app.route("/api/whatsapp", whatsapp);

app.get("/api/health", (c) =>
  c.json({ status: "ok", service: "agrosense-api" } satisfies HealthResponse),
);

app.get("/api/session", requireAuth, (c) =>
  c.json({ userId: c.get("userId") } satisfies SessionResponse),
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
