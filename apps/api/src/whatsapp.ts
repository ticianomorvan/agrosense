import { whatsappMessageRequestSchema } from "@agrosense/contracts";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ApiEnv } from "./env";
import { requireAuth } from "./lib/auth";
import { KapsoError, readKapsoConfig, sendWhatsappText } from "./lib/kapso";

export const whatsapp = new Hono<ApiEnv>();

whatsapp.post(
  "/messages",
  requireAuth,
  bodyLimit({
    maxSize: 16 * 1024,
    onError: (c) =>
      c.json(
        {
          error: {
            code: "PAYLOAD_LIMIT_EXCEEDED",
            message: "Request body exceeds 16 KiB",
          },
        },
        413,
      ),
  }),
  async (c) => {
    c.header("Cache-Control", "private, no-store");
    try {
      const config = readKapsoConfig(c.env);
      if (c.get("userId") !== config.KAPSO_ALLOWED_USER_ID) {
        return c.json(
          {
            error: {
              code: "FORBIDDEN",
              message: "WhatsApp sending is not permitted for this user",
            },
          },
          403,
        );
      }
      if (new URL(c.req.url).search) {
        return c.json(
          {
            error: {
              code: "BAD_REQUEST",
              message: "Query parameters are not supported",
            },
          },
          400,
        );
      }
      if (
        c.req.header("Content-Type")?.split(";")[0]?.trim().toLowerCase() !==
        "application/json"
      ) {
        return c.json(
          {
            error: {
              code: "UNSUPPORTED_MEDIA_TYPE",
              message: "Content-Type must be application/json",
            },
          },
          415,
        );
      }
      let body: unknown;
      try {
        body = await c.req.json();
      } catch {
        return c.json(
          {
            error: {
              code: "BAD_REQUEST",
              message: "Request body must be valid JSON",
            },
          },
          400,
        );
      }
      const message = whatsappMessageRequestSchema.safeParse(body);
      if (!message.success) {
        return c.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message:
                "Provide an international phone number and 1–4096 characters of text; no extra fields",
            },
          },
          422,
        );
      }
      return c.json(await sendWhatsappText(config, message.data));
    } catch (error) {
      if (error instanceof KapsoError) {
        return c.json(
          { error: { code: error.code, message: error.message } },
          error.status,
        );
      }
      throw error;
    }
  },
);
