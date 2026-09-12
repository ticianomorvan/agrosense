import {
  notificationStatusResponseSchema,
  uuidSchema,
} from "@agrosense/contracts";
import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { z } from "zod";
import type { ApiEnv } from "../env";
import { requireAuth } from "../lib/auth";
import type { Json } from "../lib/database.types";
import { iso } from "../lib/database-utils";
import { jsonError } from "../lib/http";
import { readLimitedRequestBody } from "../lib/request-body";
import { createServiceClient } from "../lib/supabase";
import { dispatchNotifications, processWeather } from "./jobs";
import { readNotificationConfig } from "./notification";

export const automationRoutes = new Hono<ApiEnv>();
automationRoutes.use("*", async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  await next();
});

const cronAuth = createMiddleware<ApiEnv>(async (c, next) => {
  const secret = c.env.AUTOMATION_CRON_SECRET;
  if (!secret || !/^[a-f0-9]{64}$/.test(secret))
    return jsonError(
      c,
      503,
      "AUTOMATION_UNAVAILABLE",
      "Automation authentication is not configured",
    );
  const supplied = /^Bearer ([a-f0-9]{64})$/.exec(
    c.req.header("Authorization") ?? "",
  )?.[1];
  if (!supplied)
    return jsonError(
      c,
      401,
      "UNAUTHORIZED",
      "Valid automation credentials required",
    );
  // WebCrypto verifies the MAC in constant time; no secret comparison in JS.
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(secret),
  );
  if (
    !(await crypto.subtle.verify(
      "HMAC",
      key,
      signature,
      encoder.encode(supplied),
    ))
  )
    return jsonError(
      c,
      401,
      "UNAUTHORIZED",
      "Valid automation credentials required",
    );
  await next();
});
const emptyJobBody = createMiddleware<ApiEnv>(async (c, next) => {
  if (new URL(c.req.url).search)
    return jsonError(c, 400, "BAD_REQUEST", "Job parameters are not accepted");
  const text = await readLimitedRequestBody(c.req.raw, 1024);
  if (text === null)
    return jsonError(c, 413, "PAYLOAD_TOO_LARGE", "Request body is too large");
  try {
    if (text.trim()) z.strictObject({}).parse(JSON.parse(text));
  } catch {
    return jsonError(
      c,
      400,
      "BAD_REQUEST",
      "Job body must be empty or an empty object",
    );
  }
  await next();
});

for (const task of ["weather", "notifications"] as const) {
  const path =
    task === "weather"
      ? "/api/internal/weather/refresh"
      : "/api/internal/notifications/dispatch";
  automationRoutes.post(path, cronAuth, emptyJobBody, async (c) => {
    const client = createServiceClient(c.env);
    const started = await client
      .rpc("start_automation_run", { p_task: task })
      .abortSignal(AbortSignal.timeout(8000));
    if (started.error)
      return jsonError(
        c,
        503,
        "AUTOMATION_UNAVAILABLE",
        "Could not record the job run",
      );
    const runId = uuidSchema.parse(started.data);
    let result: Json;
    let succeeded = false;
    try {
      if (task === "weather") {
        const weather = await processWeather(client, {
          apiKey: c.env.OPEN_METEO_API_KEY,
        });
        result = weather;
        succeeded = !weather.errorCode;
      } else {
        result = await dispatchNotifications(
          client,
          readNotificationConfig(c.env),
        );
        succeeded = true;
      }
    } catch {
      result = { errorCode: "AUTOMATION_RUN_FAILED" };
    }
    const finished = await client
      .rpc("finish_automation_run", {
        p_id: runId,
        p_succeeded: succeeded,
        p_result: result,
      })
      .abortSignal(AbortSignal.timeout(8000));
    succeeded = succeeded && !finished.error && finished.data === true;
    console.info(
      JSON.stringify({
        event: "automation_run",
        task,
        runId,
        succeeded,
      }),
    );
    return c.json({ runId, succeeded, result }, succeeded ? 200 : 503);
  });
}

automationRoutes.get(
  "/api/farms/:farmId/notifications",
  requireAuth,
  async (c) => {
    const farmId = c.req.param("farmId");
    if (!uuidSchema.safeParse(farmId).success || new URL(c.req.url).search)
      return jsonError(
        c,
        400,
        "BAD_REQUEST",
        "A farm UUID without query parameters is required",
      );
    const result = await c
      .get("supabase")
      .rpc("get_farm_notification_status", { p_farm_id: farmId });
    if (result.error) throw result.error;
    if (result.data === null)
      return jsonError(c, 404, "NOT_FOUND", "Farm not found");
    const raw = z
      .object({
        farmId: z.uuid(),
        notifications: z
          .array(
            z
              .object({
                createdAt: z.string(),
                updatedAt: z.string(),
              })
              .passthrough(),
          )
          .max(100),
      })
      .parse(result.data);
    return c.json(
      notificationStatusResponseSchema.parse({
        ...raw,
        notifications: raw.notifications.map((n) => ({
          ...n,
          createdAt: iso(n.createdAt),
          updatedAt: iso(n.updatedAt),
        })),
      }),
    );
  },
);
