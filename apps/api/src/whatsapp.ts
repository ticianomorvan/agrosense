import { whatsappMessageRequestSchema } from "@agrosense/contracts";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ApiEnv } from "./env";
import { requireAuth } from "./lib/auth";
import { jsonError } from "./lib/http";
import { KapsoError, readKapsoConfig, sendWhatsappText } from "./lib/kapso";

export const whatsapp = new Hono<ApiEnv>();

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
    c.header("Cache-Control", "private, no-store");
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
        return c.json(
          { error: { code: error.code, message: error.message } },
          error.status,
        );
      }
      throw error;
    }
  },
);
