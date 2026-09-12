import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("agrosense-api"),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const sessionResponseSchema = z.object({ userId: z.uuid() });
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

export const whatsappPhoneSchema = z
  .string()
  .regex(/^\+?[1-9]\d{6,14}$/)
  .transform((value) => value.replace(/^\+/, ""));
export const whatsappTextSchema = z.string().trim().min(1).max(4096);
export const whatsappMessageRequestSchema = z.strictObject({
  to: whatsappPhoneSchema,
  text: whatsappTextSchema,
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

export {
  type WhatsappAgentRun,
  whatsappAgentRunSchema,
  whatsappWebhookResponseSchema,
} from "./whatsapp-agent";
export const uuidSchema = z.uuid();

export const refreshResponseSchema = z.object({
  farmId: z.uuid(),
  dataVersion: z.number().int().min(1),
  refreshedAt: z.iso.datetime({ offset: false }),
  dataMode: z.enum(["demo", "live"]),
  eventCount: z.number().int().min(0),
  alertCount: z.number().int().min(0),
});
export type RefreshResponse = z.infer<typeof refreshResponseSchema>;

export * from "./agronomic";
export * from "./dashboard";
export * from "./default-rules";
export * from "./engine";
export * from "./geometry";
export * from "./land";
export * from "./notifications";
export * from "./onboarding";
export * from "./satellite";
export * from "./time";
