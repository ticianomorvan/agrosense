import type {
  WhatsappMessageRequest,
  WhatsappMessageResponse,
} from "@agrosense/contracts";
import { z } from "zod";
import { boundedFetch, ProviderTimeoutError } from "./http";

export type KapsoBindings = {
  KAPSO_API_KEY?: string;
  KAPSO_PHONE_NUMBER_ID?: string;
  KAPSO_ALLOWED_USER_ID?: string;
};

export const kapsoSendConfigSchema = z.object({
  KAPSO_API_KEY: z
    .string()
    .min(1)
    .max(4096)
    .regex(/^[\x21-\x7e]+$/),
  KAPSO_PHONE_NUMBER_ID: z.string().regex(/^[1-9]\d{0,29}$/),
});
const configSchema = kapsoSendConfigSchema.extend({
  KAPSO_ALLOWED_USER_ID: z.uuid(),
});

type KapsoConfig = z.infer<typeof configSchema>;

export class KapsoError extends Error {
  constructor(
    readonly code:
      | "KAPSO_UNAVAILABLE"
      | "KAPSO_REJECTED"
      | "KAPSO_RATE_LIMITED"
      | "SEND_OUTCOME_UNKNOWN",
    readonly status: 502 | 503 | 504,
    message: string,
  ) {
    super(message);
  }
}

export function readKapsoConfig(env: KapsoBindings): KapsoConfig {
  const config = configSchema.safeParse(env);
  if (!config.success) {
    throw new KapsoError(
      "KAPSO_UNAVAILABLE",
      503,
      "WhatsApp sending is not configured",
    );
  }
  return config.data;
}

// Only consume the documented fields needed by our public response.
const sendResponseSchema = z.object({
  messaging_product: z.literal("whatsapp"),
  messages: z.tuple([z.object({ id: z.string().trim().min(1).max(1024) })]),
});

/** One attempt only: a lost response may still represent an accepted message. */
export async function sendWhatsappText(
  config: z.infer<typeof kapsoSendConfigSchema>,
  message: WhatsappMessageRequest & { callbackData?: string },
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<WhatsappMessageResponse> {
  return sendWhatsappRequest(
    config,
    {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: message.to,
      type: "text",
      ...(message.callbackData
        ? { biz_opaque_callback_data: message.callbackData }
        : {}),
      text: { body: message.text, preview_url: false },
    },
    fetcher,
    signal,
  );
}

async function sendWhatsappRequest(
  config: z.infer<typeof kapsoSendConfigSchema>,
  payload: Record<string, unknown>,
  fetcher: typeof fetch,
  signal?: AbortSignal,
): Promise<WhatsappMessageResponse> {
  try {
    const response = await boundedFetch(
      `https://api.kapso.ai/meta/whatsapp/v24.0/${config.KAPSO_PHONE_NUMBER_ID}/messages`,
      {
        method: "POST",
        headers: {
          "X-API-Key": config.KAPSO_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
      { fetcher, signal, timeoutMs: 8000, maxBytes: 16 * 1024 },
    );
    if (!response.ok) {
      // Do not expose or log upstream bodies; they can contain sensitive data.
      if (response.status === 429)
        throw new KapsoError(
          "KAPSO_RATE_LIMITED",
          503,
          "WhatsApp provider rate limit reached",
        );
      if (
        response.status >= 400 &&
        response.status < 500 &&
        response.status !== 408
      )
        throw new KapsoError(
          "KAPSO_REJECTED",
          502,
          "WhatsApp provider rejected the message",
        );
      throw new Error("Uncertain provider response");
    }
    const result = sendResponseSchema.parse(await response.json());
    return { messageId: result.messages[0].id, status: "accepted" };
  } catch (error) {
    if (error instanceof KapsoError) throw error;
    throw new KapsoError(
      "SEND_OUTCOME_UNKNOWN",
      error instanceof ProviderTimeoutError ? 504 : 502,
      "Message outcome is unknown; check Kapso before retrying",
    );
  }
}
