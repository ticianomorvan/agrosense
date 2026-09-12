import { whatsappWebhookResponseSchema } from "@agrosense/contracts";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { ApiEnv } from "../env";
import { requireAuth } from "../lib/auth";
import { jsonError } from "../lib/http";
import {
  AgentConfigurationError,
  conversationName,
  readAgentConfig,
} from "./config";
import { normalizeInbound, verifyWebhookSignature } from "./inbound";

export const whatsappAgentRoutes = new Hono<ApiEnv>();
whatsappAgentRoutes.use("*", async (c, next) => {
  c.header("Cache-Control", "private, no-store");
  await next();
});

whatsappAgentRoutes.post(
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

whatsappAgentRoutes.get("/agent/runs/:messageId", requireAuth, async (c) => {
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
