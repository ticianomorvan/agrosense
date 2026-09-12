import { z } from "zod";

export const whatsappWebhookResponseSchema = z.strictObject({
  accepted: z.number().int().min(0),
  duplicates: z.number().int().min(0),
  ignored: z.number().int().min(0),
});
export const whatsappAgentRunSchema = z.strictObject({
  messageId: z.string().min(1).max(512),
  status: z.enum([
    "queued",
    "running",
    "reply_pending",
    "sending",
    "accepted",
    "failed",
    "send_unknown",
  ]),
  receivedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  attempts: z.number().int().min(0).max(2),
  modelSteps: z.number().int().min(0).max(8),
  trace: z
    .array(
      z.strictObject({
        tool: z.string().min(1).max(100),
        ok: z.boolean(),
        errorCode: z.string().max(100).nullable(),
        durationMs: z.number().min(0),
      }),
    )
    .max(8),
  replyMessageId: z.string().max(1024).nullable(),
  errorCode: z.string().max(100).nullable(),
});
export type WhatsappAgentRun = z.infer<typeof whatsappAgentRunSchema>;
