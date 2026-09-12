import {
  assessmentStateSchema,
  eventKindSchema,
  riskLevelSchema,
  whatsappPhoneSchema,
} from "@agrosense/contracts";
import { z } from "zod";
import {
  type KapsoBindings,
  kapsoSendConfigSchema,
  sendWhatsappText,
} from "../lib/kapso";

export type AutomationBindings = {
  AUTOMATION_CRON_SECRET?: string;
  KAPSO_NOTIFICATION_WEBHOOK_SECRET?: string;
  OPEN_METEO_API_KEY?: string;
};

const notificationConfigSchema = kapsoSendConfigSchema;

export function readNotificationConfig(
  env: AutomationBindings & KapsoBindings,
) {
  return notificationConfigSchema.parse(env);
}

// Postgres JSON timestamps use offsets; normalize at the API boundary as needed.
const sqlInstant = z.iso.datetime({ offset: true });
export const notificationJobSchema = z.strictObject({
  id: z.uuid(),
  token: z.uuid(),
  ownerId: z.uuid(),
  recipient: whatsappPhoneSchema,
  kind: z.enum(["hazard", "escalation", "withdrawal"]),
  attempts: z.int().min(0).max(5),
  payload: z.strictObject({
    farmName: z.string().min(1).max(100),
    plotName: z.string().min(1).max(100),
    title: z.string().min(1).max(160),
    hazardKind: eventKindSchema,
    startsAt: sqlInstant,
    endsAt: sqlInstant,
    generatedAt: sqlInstant,
    assessmentState: assessmentStateSchema,
    riskLevel: riskLevelSchema.nullable(),
    reason: z.string().min(1).max(1000),
    recommendedActions: z.array(z.string().max(1000)).max(10),
  }),
});
export type NotificationJob = z.infer<typeof notificationJobSchema>;

const risks = {
  low: "low",
  moderate: "moderate",
  high: "high",
  critical: "critical",
};
const dateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/Argentina/Cordoba",
  day: "2-digit",
  month: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});
function compact(text: string, limit: number) {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}

export function notificationContent(job: NotificationJob) {
  const { payload } = job;
  const window = `${dateFormatter.format(new Date(payload.startsAt))}–${dateFormatter.format(new Date(payload.endsAt))} (Córdoba).`;
  const details =
    job.kind === "withdrawal"
      ? `Forecast withdrawn due to newer data. ${window} Check current conditions in AgroSense.`
      : payload.assessmentState === "evaluated" && payload.riskLevel !== null
        ? `${job.kind === "escalation" ? "Increased risk. " : ""}Crop risk: ${risks[payload.riskLevel]}. ${window} ${compact(payload.reason, 180)} ${compact(payload.recommendedActions[0] ?? "Check AgroSense.", 140)}`
        : `Weather alert. ${window} Crop risk unavailable: no applicable agronomic assessment with current data. Check AgroSense.`;
  return {
    farm: compact(payload.farmName, 100),
    plot: compact(payload.plotName, 100),
    hazard: compact(payload.title, 160),
    details: compact(details, 450),
  };
}

export function formatNotificationText(job: NotificationJob): string {
  const params = notificationContent(job);
  return [
    `*AgroSense: Weather alert*`,
    `Farm: ${params.farm}`,
    `Field: ${params.plot}`,
    `Forecast event: ${params.hazard}`,
    `Details: ${params.details}`,
    ``,
    `Check AgroSense to review the forecast and field assessment.`,
  ].join("\n");
}

export function sendNotification(
  config: z.infer<typeof notificationConfigSchema>,
  job: NotificationJob,
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
) {
  return sendWhatsappText(
    config,
    {
      to: job.recipient,
      text: formatNotificationText(job),
      callbackData: `agrosense:${job.id}:${job.token}`,
    },
    fetcher,
    signal,
  );
}
