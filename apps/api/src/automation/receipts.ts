import { whatsappPhoneSchema } from "@agrosense/contracts";
import { z } from "zod";

const timestampSchema = z
  .string()
  .regex(/^\d{1,12}$/)
  .transform(Number)
  .pipe(z.number().int().min(0).max(253402300799));
const statusSchema = z.enum(["sent", "delivered", "read", "failed"]);
const callbackSchema = z.string().max(512);
const receiptSchema = z.object({
  phone_number_id: z.string().regex(/^[1-9]\d{0,29}$/),
  message: z.object({
    id: z.string().min(1).max(1024),
    timestamp: timestampSchema.optional(),
    to: whatsappPhoneSchema.optional(),
    biz_opaque_callback_data: callbackSchema.optional(),
    kapso: z.object({
      direction: z.literal("outbound"),
      status: statusSchema,
      statuses: z
        .array(
          z.object({
            id: z.string().max(1024),
            status: z.string().max(30),
            timestamp: timestampSchema,
            recipient_id: whatsappPhoneSchema.optional(),
            biz_opaque_callback_data: callbackSchema.optional(),
          }),
        )
        .max(100)
        .optional(),
    }),
  }),
});

/** Kapso v2 phone-number event payload; headers cannot override signed status. */
export function normalizeReceipt(
  payload: unknown,
  event: string | undefined,
  phoneNumberId: string,
) {
  const expectedStatus = event?.replace(/^whatsapp\.message\./, "");
  if (!statusSchema.safeParse(expectedStatus).success) return null;
  const parsed = receiptSchema.parse(payload);
  if (parsed.phone_number_id !== phoneNumberId) return null;
  const { message } = parsed;
  if (message.kapso.status !== expectedStatus)
    throw new Error("RECEIPT_STATUS_MISMATCH");
  const statuses =
    message.kapso.statuses?.filter(
      (s) => s.id === message.id && s.status === expectedStatus,
    ) ?? [];
  const callbacks = new Set(
    [
      message.biz_opaque_callback_data,
      ...statuses.map((s) => s.biz_opaque_callback_data),
    ].filter((s) => s !== undefined),
  );
  const recipients = new Set(
    [message.to, ...statuses.map((s) => s.recipient_id)].filter(
      (s) => s !== undefined,
    ),
  );
  if (callbacks.size > 1 || recipients.size > 1)
    throw new Error("RECEIPT_IDENTITY_MISMATCH");
  const callback = [...callbacks][0];
  let notificationId: string | null = null;
  let token: string | null = null;
  if (callback?.startsWith("agrosense:")) {
    const parts = callback.split(":");
    if (parts.length !== 3) throw new Error("INVALID_CALLBACK");
    notificationId = z.uuid().parse(parts[1]);
    token = z.uuid().parse(parts[2]);
  }
  const timestamp = statuses.length
    ? Math.max(...statuses.map((s) => s.timestamp))
    : message.timestamp;
  if (timestamp === undefined) throw new Error("MISSING_RECEIPT_TIME");
  return {
    phoneNumberId,
    messageId: message.id,
    status: message.kapso.status,
    occurredAt: new Date(timestamp * 1000).toISOString(),
    recipient: [...recipients][0] ?? null,
    notificationId,
    token,
  };
}
