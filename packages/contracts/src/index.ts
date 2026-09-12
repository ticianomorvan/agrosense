import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("agrosense-api"),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const sessionResponseSchema = z.object({ userId: z.uuid() });
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const whatsappMessageRequestSchema = z.strictObject({
  to: z
    .string()
    .regex(/^\+?[1-9]\d{6,14}$/)
    .transform((value) => value.replace(/^\+/, "")),
  text: z.string().trim().min(1).max(4096),
});
export type WhatsappMessageRequest = z.infer<
  typeof whatsappMessageRequestSchema
>;

export const whatsappMessageResponseSchema = z.strictObject({
  messageId: z.string().min(1).max(1024),
  status: z.literal("accepted"),
});
export type WhatsappMessageResponse = z.infer<
  typeof whatsappMessageResponseSchema
>;
