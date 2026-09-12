import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("agrosense-api"),
});
export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const sessionResponseSchema = z.object({ userId: z.uuid() });
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
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

export * from "./dashboard";
export * from "./geometry";
export * from "./land";
export * from "./satellite";
export * from "./time";
