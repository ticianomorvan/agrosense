import { z } from "zod";
import { instantSchema } from "./time";

export const notificationStatusResponseSchema = z.strictObject({
  farmId: z.uuid(),
  notifications: z
    .array(
      z.strictObject({
        id: z.uuid(),
        plotId: z.uuid(),
        kind: z.enum(["hazard", "escalation", "withdrawal"]),
        status: z.enum([
          "pending",
          "leased",
          "sending",
          "unknown",
          "accepted",
          "sent",
          "delivered",
          "read",
          "failed",
          "cancelled",
          "expired",
        ]),
        attempts: z.int().min(0).max(5),
        lastErrorCode: z.string().max(100).nullable(),
        createdAt: instantSchema,
        updatedAt: instantSchema,
      }),
    )
    .max(100),
});
export type NotificationStatusResponse = z.infer<
  typeof notificationStatusResponseSchema
>;
