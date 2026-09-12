import {
  whatsappMessageRequestSchema,
  whatsappWebhookResponseSchema,
} from "@agrosense/contracts";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import {
  AgentConfigurationError,
  conversationName,
  readAgentConfig,
} from "./agent/config";
import { normalizeInbound, verifyWebhookSignature } from "./agent/inbound";
import type { ApiEnv } from "./env";
import { requireAuth } from "./lib/auth";
import { jsonError } from "./lib/http";
import { KapsoError, readKapsoConfig, sendWhatsappText } from "./lib/kapso";

export const whatsapp = new Hono<ApiEnv>();

whatsapp.use("*", async (c, next) => {
  await next();
  c.header("Cache-Control", "private, no-store");
});

whatsapp.post(
  "/messages",
  requireAuth,
  bodyLimit({
    maxSize: 16 * 1024,
    onError: (c) =>
      jsonError(
        c,
        413,
        "PAYLOAD_LIMIT_EXCEEDED",
        "Request body exceeds 16 KiB",
      ),
  }),
  async (c) => {
    try {
      const config = readKapsoConfig(c.env);
      if (c.get("userId") !== config.KAPSO_ALLOWED_USER_ID) {
        return jsonError(
          c,
          403,
          "FORBIDDEN",
          "WhatsApp sending is not permitted for this user",
        );
      }
      if (new URL(c.req.url).search) {
        return jsonError(
          c,
          400,
          "BAD_REQUEST",
          "Query parameters are not supported",
        );
      }
      if (
        c.req.header("Content-Type")?.split(";")[0]?.trim().toLowerCase() !==
        "application/json"
      ) {
        return jsonError(
          c,
          415,
          "UNSUPPORTED_MEDIA_TYPE",
          "Content-Type must be application/json",
        );
      }
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return jsonError(
          c,
          400,
          "BAD_REQUEST",
          "Request body must be valid JSON",
        );
      }
      const message = whatsappMessageRequestSchema.safeParse(body);
      if (!message.success) {
        return jsonError(
          c,
          422,
          "VALIDATION_ERROR",
          "Provide an international phone number and 1–4096 characters of text; no extra fields",
        );
      }
      return c.json(await sendWhatsappText(config, message.data));
    } catch (error) {
      if (error instanceof KapsoError) {
        return jsonError(c, error.status, error.code, error.message);
      }
      throw error;
    }
  },
);

whatsapp.post(
  "/webhook",
  bodyLimit({
    maxSize: 128 * 1024,
    onError: (c) =>
      jsonError(c, 413, "PAYLOAD_LIMIT_EXCEEDED", "Webhook exceeds 128 KiB"),
  }),
  async (c) => {
    try {
      const config = readAgentConfig(c.env);
      if (!c.env.WHATSAPP_CONVERSATIONS) throw new AgentConfigurationError();
      const raw = new Uint8Array(await c.req.arrayBuffer());
      if (raw.byteLength > 128 * 1024)
        return jsonError(
          c,
          413,
          "PAYLOAD_LIMIT_EXCEEDED",
          "Webhook exceeds 128 KiB",
        );
      if (
        !(await verifyWebhookSignature(
          raw,
          c.req.header("X-Webhook-Signature"),
          config.webhookSecret,
        ))
      )
        return jsonError(
          c,
          401,
          "UNAUTHORIZED",
          "Valid webhook signature required",
        );
      let payload: unknown;
      try {
        payload = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(raw),
        );
      } catch {
        throw new SyntaxError("Invalid webhook encoding or JSON");
      }
      const { messages, ignored } = normalizeInbound(
        payload,
        c.req.header("X-Webhook-Event"),
        config,
      );
      console.log("[webhook:inbound]", {
        event: c.req.header("X-Webhook-Event"),
        accepted: messages.length,
        ignored,
      });
      let admission = { accepted: 0, duplicates: 0 };
      if (messages.length) {
        const stub = c.env.WHATSAPP_CONVERSATIONS.getByName(
          await conversationName(config),
        );
        const result = await stub.enqueue(messages, config.ownerId);
        if ("error" in result) {
          if (result.status === 429) c.header("Retry-After", "60");
          return c.json({ error: result.error }, result.status);
        }
        admission = result;
      }
      return c.json(
        whatsappWebhookResponseSchema.parse({ ...admission, ignored }),
      );
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError)
        return jsonError(
          c,
          400,
          "BAD_REQUEST",
          "Invalid Kapso webhook payload",
        );
      return jsonError(
        c,
        503,
        "AGENT_UNAVAILABLE",
        "WhatsApp agent is temporarily unavailable",
      );
    }
  },
);

whatsapp.get("/agent/runs/:messageId", requireAuth, async (c) => {
  try {
    const config = readAgentConfig(c.env);
    if (c.get("userId") !== config.ownerId)
      return jsonError(
        c,
        403,
        "FORBIDDEN",
        "Agent status is restricted to its operator",
      );
    if (!c.env.WHATSAPP_CONVERSATIONS) throw new AgentConfigurationError();
    const messageId = z
      .string()
      .min(1)
      .max(512)
      .parse(c.req.param("messageId"));
    const stub = c.env.WHATSAPP_CONVERSATIONS.getByName(
      await conversationName(config),
    );
    const run = await stub.status(messageId);
    return run ? c.json(run) : jsonError(c, 404, "NOT_FOUND", "Run not found");
  } catch {
    return jsonError(
      c,
      503,
      "AGENT_UNAVAILABLE",
      "Agent status is temporarily unavailable",
    );
  }
});
