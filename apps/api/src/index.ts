import type { HealthResponse } from "@agrosense/contracts";
import { Hono } from "hono";

const app = new Hono();

app.get("/api/health", (c) =>
  c.json({ status: "ok", service: "agrosense-api" } satisfies HealthResponse),
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
