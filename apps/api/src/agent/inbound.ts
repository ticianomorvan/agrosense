import { whatsappPhoneSchema, whatsappTextSchema } from "@agrosense/contracts";
import { z } from "zod";
import { hashIdentity } from "./identity";

export const inboundMessageSchema = z.strictObject({
  messageId: z.string().min(1).max(512),
  phoneNumberId: z.string().regex(/^[1-9]\d{0,29}$/),
  sender: z.string().regex(/^[1-9]\d{6,14}$/),
  text: whatsappTextSchema,
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
const envelopeSchema = z.object({
  batch: z.boolean().optional(),
  data: z.unknown().optional(),
});
const batchSchema = z.object({
  type: z.literal("whatsapp.message.received"),
  data: z.array(eventSchema).min(1).max(20),
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
  config: { phoneNumberId: string },
  now = new Date(),
): { messages: InboundMessage[]; ignored: number } {
  const envelope = envelopeSchema.safeParse(payload);
  if (event !== "whatsapp.message.received")
    return {
      messages: [],
      ignored:
        envelope.success &&
        envelope.data.batch &&
        Array.isArray(envelope.data.data)
          ? envelope.data.data.length
          : 1,
    };
  if (!envelope.success) throw envelope.error;
  const entries = envelope.data.batch
    ? batchSchema.parse(payload).data
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
    const from = whatsappPhoneSchema.safeParse(
      message.from ?? conversation.phone_number,
    );
    const contact = whatsappPhoneSchema.safeParse(
      conversation.phone_number ?? message.from,
    );
    if (!from.success || !contact.success || from.data !== contact.data)
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
  return { messages: result, ignored: entries.length - result.length };
}

export function messageFingerprint(message: InboundMessage): Promise<string> {
  return hashIdentity([
    message.messageId,
    message.phoneNumberId,
    message.sender,
    message.text,
    message.sentAt,
  ]);
}
