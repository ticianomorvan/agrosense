import { whatsappWebhookResponseSchema } from "@agrosense/contracts";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { z } from "zod";
import type { ApiEnv } from "../env";
import { requireAuth } from "../lib/auth";
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
      c.json(
        {
          error: {
            code: "PAYLOAD_LIMIT_EXCEEDED",
            message: "Webhook exceeds 128 KiB",
          },
        },
        413,
      ),
  }),
  async (c) => {
    try {
      const config = readAgentConfig(c.env);
      if (!c.env.WHATSAPP_CONVERSATIONS) throw new AgentConfigurationError();
      const raw = new Uint8Array(await c.req.arrayBuffer());
      if (raw.byteLength > 128 * 1024)
        return c.json(
          {
            error: {
              code: "PAYLOAD_LIMIT_EXCEEDED",
              message: "Webhook exceeds 128 KiB",
            },
          },
          413,
        );
      if (
        !(await verifyWebhookSignature(
          raw,
          c.req.header("X-Webhook-Signature"),
          config.webhookSecret,
        ))
      )
        return c.json(
          {
            error: {
              code: "UNAUTHORIZED",
              message: "Valid webhook signature required",
            },
          },
          401,
        );
      let payload: unknown;
      try {
        payload = JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(raw),
        );
      } catch {
        throw new SyntaxError("Invalid webhook encoding or JSON");
      }
      const messages = normalizeInbound(
        payload,
        c.req.header("X-Webhook-Event"),
        config,
      );
      const envelope = z
        .object({
          batch: z.boolean().optional(),
          data: z.array(z.unknown()).optional(),
        })
        .safeParse(payload);
      const count =
        envelope.success && envelope.data.batch
          ? (envelope.data.data?.length ?? 1)
          : 1;
      if (!messages.length)
        return c.json(
          whatsappWebhookResponseSchema.parse({
            accepted: 0,
            duplicates: 0,
            ignored: count,
          }),
        );
      const stub = c.env.WHATSAPP_CONVERSATIONS.getByName(
        await conversationName(config),
      );
      const admitted = await stub.fetch("https://conversation/enqueue", {
        method: "POST",
        body: JSON.stringify({ ownerId: config.ownerId, messages }),
      });
      if (!admitted.ok) {
        if (admitted.status === 409 || admitted.status === 429) {
          if (admitted.status === 429) c.header("Retry-After", "60");
          return c.newResponse(await admitted.text(), admitted.status, {
            "Content-Type": "application/json",
          });
        }
        throw new AgentConfigurationError();
      }
      const result = z
        .strictObject({
          accepted: z.number().int().min(0),
          duplicates: z.number().int().min(0),
        })
        .parse(await admitted.json());
      return c.json(
        whatsappWebhookResponseSchema.parse({
          ...result,
          ignored: count - messages.length,
        }),
      );
    } catch (error) {
      if (error instanceof z.ZodError || error instanceof SyntaxError)
        return c.json(
          {
            error: {
              code: "BAD_REQUEST",
              message: "Invalid Kapso webhook payload",
            },
          },
          400,
        );
      return c.json(
        {
          error: {
            code: "AGENT_UNAVAILABLE",
            message: "WhatsApp agent is temporarily unavailable",
          },
        },
        503,
      );
    }
  },
);

whatsappAgentRoutes.get("/agent/runs/:messageId", requireAuth, async (c) => {
  try {
    const config = readAgentConfig(c.env);
    if (c.get("userId") !== config.ownerId)
      return c.json(
        {
          error: {
            code: "FORBIDDEN",
            message: "Agent status is restricted to its operator",
          },
        },
        403,
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
    const response = await stub.fetch(
      `https://conversation/run?${new URLSearchParams({ messageId })}`,
    );
    if (response.status !== 200 && response.status !== 404)
      throw new AgentConfigurationError();
    return c.newResponse(await response.text(), response.status, {
      "Content-Type": "application/json",
    });
  } catch {
    return c.json(
      {
        error: {
          code: "AGENT_UNAVAILABLE",
          message: "Agent status is temporarily unavailable",
        },
      },
      503,
    );
  }
});
