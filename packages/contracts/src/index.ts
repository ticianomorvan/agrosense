import { z } from "zod";

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("agrosense-api"),
});

export type HealthResponse = z.infer<typeof healthResponseSchema>;

export const sessionResponseSchema = z.object({ userId: z.uuid() });
export type SessionResponse = z.infer<typeof sessionResponseSchema>;

// Agronomic Contracts & Engine
export * from "./agronomic";
export * from "./default-rules";
export * from "./engine";
