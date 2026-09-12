import { z } from "zod";

export const phoneSchema = z
  .string()
  .regex(/^\+?[1-9]\d{6,14}$/)
  .transform((value) => value.replace(/^\+/, ""));
export const inboundMessageSchema = z.strictObject({
  messageId: z.string().min(1).max(512),
  phoneNumberId: z.string().regex(/^[1-9]\d{0,29}$/),
  sender: z.string().regex(/^[1-9]\d{6,14}$/),
  text: z.string().trim().min(1).max(4096),
  sentAt: z.iso.datetime(),
});
export type InboundMessage = z.infer<typeof inboundMessageSchema>;
const eventSchema = z.object({
  phone_number_id: z.string(),
  message: z.object({
    id: z.string().min(1).max(512),
    timestamp: z.string().regex(/^\d{1,13}$/),
    type: z.string(),
    from: z.string().optional(),
    text: z.object({ body: z.string().max(4096) }).optional(),
    kapso: z.object({
      direction: z.string(),
      status: z.string(),
      origin: z.string().optional(),
    }),
  }),
  conversation: z.object({
    phone_number: z.string().optional(),
    phone_number_id: z.string(),
  }),
});

export async function verifyWebhookSignature(
  raw: Uint8Array,
  signature: string | undefined,
  secret: string,
): Promise<boolean> {
  if (!secret || !signature || !/^[a-f0-9]{64}$/i.test(signature)) return false;
  const bytes = Uint8Array.from(signature.match(/../g) ?? [], (byte) =>
    Number.parseInt(byte, 16),
  );
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, bytes, new Uint8Array(raw));
}

export function normalizeInbound(
  payload: unknown,
  event: string | undefined,
  config: { phoneNumberId: string; sender: string },
  now = new Date(),
): InboundMessage[] {
  if (event !== "whatsapp.message.received") return [];
  const batch = z.object({ batch: z.boolean().optional() }).parse(payload);
  const entries = batch.batch
    ? z
        .object({
          type: z.literal("whatsapp.message.received"),
          data: z.array(eventSchema).min(1).max(20),
        })
        .parse(payload).data
    : [eventSchema.parse(payload)];
  const result: InboundMessage[] = [];
  for (const entry of entries) {
    const { message, conversation } = entry;
    if (
      entry.phone_number_id !== config.phoneNumberId ||
      conversation.phone_number_id !== config.phoneNumberId ||
      message.kapso.direction !== "inbound" ||
      message.kapso.status !== "received" ||
      message.kapso.origin === "history_sync" ||
      message.type !== "text"
    )
      continue;
    const from = phoneSchema.safeParse(
      message.from ?? conversation.phone_number,
    );
    const contact = phoneSchema.safeParse(
      conversation.phone_number ?? message.from,
    );
    if (
      !from.success ||
      !contact.success ||
      from.data !== contact.data ||
      from.data !== config.sender
    )
      continue;
    const timestamp = Number(message.timestamp) * 1000;
    if (
      timestamp > now.getTime() + 5 * 60000 ||
      timestamp < now.getTime() - 86400000
    )
      continue;
    const normalized = inboundMessageSchema.safeParse({
      messageId: message.id,
      phoneNumberId: entry.phone_number_id,
      sender: from.data,
      text: message.text?.body,
      sentAt: new Date(timestamp).toISOString(),
    });
    if (normalized.success) result.push(normalized.data);
  }
  return result;
}

export async function messageFingerprint(
  message: InboundMessage,
): Promise<string> {
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify([
        message.messageId,
        message.phoneNumberId,
        message.sender,
        message.text,
        message.sentAt,
      ]),
    ),
  );
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
