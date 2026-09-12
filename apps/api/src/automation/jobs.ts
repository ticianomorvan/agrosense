import { z } from "zod";
import { KapsoError } from "../lib/kapso";
import { RefreshError, refreshFarm } from "../lib/refresh";
import type { createServiceClient } from "../lib/supabase";
import {
  notificationJobSchema,
  type readNotificationConfig,
  sendNotification,
} from "./notification";

type ServiceClient = ReturnType<typeof createServiceClient>;
const weatherClaimSchema = z.strictObject({
  farmId: z.uuid(),
  ownerId: z.uuid(),
  token: z.uuid(),
});

/** Supabase owns admission, leases and the completion watermark. */
export async function processWeather(
  client: ServiceClient,
  options: { apiKey?: string; signal?: AbortSignal } = {},
) {
  const claim = await client
    .rpc("claim_weather_farm", { p_now: new Date().toISOString() })
    .abortSignal(AbortSignal.timeout(8000));
  if (claim.error) throw new Error("SCHEDULE_CLAIM_FAILED");
  if (claim.data === null) return { claimed: 0, published: 0 };
  const job = weatherClaimSchema.parse(claim.data);
  try {
    const result = await refreshFarm(
      client,
      client,
      job.farmId,
      job.ownerId,
      new Date(),
      options,
    );
    return {
      claimed: 1,
      published: 1,
      farmId: job.farmId,
      eventCount: result.eventCount,
      alertCount: result.alertCount,
    };
  } catch (error) {
    const failure = await client
      .rpc("fail_weather_schedule", {
        p_farm_id: job.farmId,
        p_token: job.token,
        p_now: new Date().toISOString(),
      })
      .abortSignal(AbortSignal.timeout(8000));
    if (failure.error) throw new Error("SCHEDULE_FAILURE_RECORD_FAILED");
    const code =
      error instanceof RefreshError
        ? error.failure.kind === "unavailable"
          ? error.failure.code
          : error.failure.kind.toUpperCase()
        : "REFRESH_FAILED";
    return { claimed: 1, published: 0, farmId: job.farmId, errorCode: code };
  }
}

/** Bounded drain; two HTTP sends at a time, ten notices per invocation. */
export async function dispatchNotifications(
  client: ServiceClient,
  config: ReturnType<typeof readNotificationConfig>,
  options: { fetcher?: typeof fetch; signal?: AbortSignal } = {},
) {
  const signal = options.signal ?? AbortSignal.timeout(50_000);
  const summary = {
    claimed: 0,
    accepted: 0,
    retry: 0,
    failed: 0,
    unknown: 0,
    skipped: 0,
  };
  let remaining = 10;
  async function consume() {
    while (remaining-- > 0) {
      signal.throwIfAborted();
      const claim = await client
        .rpc("claim_notification", { p_now: new Date().toISOString() })
        .abortSignal(signal);
      if (claim.error) throw new Error("NOTIFICATION_CLAIM_FAILED");
      if (claim.data === null) break;
      const job = notificationJobSchema.parse(claim.data);
      summary.claimed++;
      const begin = await client
        .rpc("begin_notification_send", {
          p_id: job.id,
          p_token: job.token,
          p_phone_number_id: config.KAPSO_PHONE_NUMBER_ID,
          p_now: new Date().toISOString(),
        })
        .abortSignal(signal);
      if (begin.error) throw new Error("SEND_ADMISSION_FAILED");
      if (!begin.data) {
        summary.skipped++;
        continue;
      }
      let outcome: "accepted" | "retry" | "failed" | "unknown";
      let messageId: string | null = null;
      let errorCode: string | null = null;
      try {
        const response = await sendNotification(
          config,
          job,
          options.fetcher,
          signal,
        );
        outcome = "accepted";
        messageId = response.messageId;
      } catch (error) {
        errorCode =
          error instanceof KapsoError ? error.code : "SEND_OUTCOME_UNKNOWN";
        outcome =
          errorCode === "KAPSO_RATE_LIMITED"
            ? "retry"
            : errorCode === "KAPSO_REJECTED"
              ? "failed"
              : "unknown";
        if (outcome === "unknown") errorCode = "SEND_OUTCOME_UNKNOWN";
      }
      // Use a separate deadline to persist an outcome even if the send timed out.
      // If this acknowledgement fails, the sending lease recovers as unknown.
      const complete = await client
        .rpc("complete_notification_send", {
          p_id: job.id,
          p_token: job.token,
          p_outcome: outcome,
          p_message_id: messageId,
          p_error_code: errorCode,
          p_now: new Date().toISOString(),
        })
        .abortSignal(AbortSignal.timeout(8000));
      if (complete.error || !complete.data)
        throw new Error("SEND_OUTCOME_RECORD_FAILED");
      summary[outcome]++;
    }
  }
  const workers = await Promise.allSettled([consume(), consume()]);
  if (workers.some((worker) => worker.status === "rejected"))
    throw new Error("NOTIFICATION_DISPATCH_INCOMPLETE");
  return summary;
}
