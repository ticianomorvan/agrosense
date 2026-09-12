import type { ForecastSummary } from "@agrosense/contracts";
import { type DashboardSnapshot, projectDashboard } from "./dashboard";
import type { Json } from "./database.types";
import type { PublicationEvent } from "./publication";

/** Validate the complete prospective dashboard before the version-checked commit. */
export function validatePublicationDashboard(
  snapshot: DashboardSnapshot,
  forecast: ForecastSummary,
  publications: PublicationEvent[],
  now: string,
): void {
  if (!snapshot.farm) throw new Error("Missing publication farm");
  const farmId = snapshot.farm.id;
  const key = (source: string, identity: string) => `${source}:${identity}`;
  const events = new Map(
    snapshot.events.map((event) => [
      key(event.source_code, event.source_event_key),
      event,
    ]),
  );
  const alerts = new Map(
    snapshot.plot_alerts.map((alert) => [
      `${alert.event_id}:${alert.plot_id}`,
      alert,
    ]),
  );
  for (const event of publications) {
    const identity = key(event.sourceCode, event.sourceEventKey);
    const previous = events.get(identity);
    const id = previous?.id ?? crypto.randomUUID();
    events.set(identity, {
      id,
      farm_id: farmId,
      source_code: event.sourceCode,
      source_event_key: event.sourceEventKey,
      kind: event.kind,
      title: event.title,
      starts_at: event.startsAt,
      ends_at: event.endsAt,
      issued_at: event.issuedAt,
      retrieved_at: event.retrievedAt,
      source_url: event.sourceUrl,
      status: event.status,
      evidence: event.evidence as unknown as Json,
      is_demo: event.isDemo,
      created_at: previous?.created_at ?? now,
      updated_at: now,
    });
    for (const alert of event.alerts) {
      const alertKey = `${id}:${alert.plotId}`;
      const previousAlert = alerts.get(alertKey);
      alerts.set(alertKey, {
        id: previousAlert?.id ?? crypto.randomUUID(),
        farm_id: farmId,
        plot_id: alert.plotId,
        event_id: id,
        assessment_state: alert.assessmentState,
        risk_level: alert.riskLevel,
        reason: alert.reason,
        recommended_actions: alert.recommendedActions,
        input_snapshot: {
          ...alert.inputSnapshot,
          event: { ...alert.inputSnapshot.event, id },
        } as unknown as Json,
        rule_version: alert.ruleVersion,
        generated_at: alert.generatedAt,
        valid_until: alert.validUntil,
        generation_method: alert.generationMethod,
        created_at: previousAlert?.created_at ?? now,
        updated_at: now,
      });
    }
  }
  const retainedEvents = [...events.values()].filter(
    (event) => Date.parse(event.ends_at) > Date.parse(now) - 7 * 86400000,
  );
  const retainedIds = new Set(retainedEvents.map((event) => event.id));
  projectDashboard(
    {
      ...snapshot.farm,
      forecast_summary: forecast as unknown as Json,
      last_attempt_at: now,
      last_success_at: now,
      last_error_code: null,
      data_version: snapshot.farm.data_version + 1,
    },
    snapshot.plots,
    snapshot.crop_cycles,
    retainedEvents,
    [...alerts.values()].filter((alert) => retainedIds.has(alert.event_id)),
    now,
  );
}
