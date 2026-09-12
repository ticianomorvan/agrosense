import {
  addMinutes,
  compareInstants,
  DEMO_V1_RULESET,
  ExpiredForecastEvidenceError,
  eventEvidenceSchema,
  type ForecastSummary,
  forecastSummarySchema,
  type PlotForecast,
  type RefreshResponse,
  refreshResponseSchema,
  resolveRules,
  riskRuleSchema,
} from "@agrosense/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { DashboardPayloadLimitError, loadDashboardSnapshot } from "./dashboard";
import type { Database, Json } from "./database.types";
import { iso, json } from "./database-utils";
import { ProviderTimeoutError } from "./http";
import {
  buildPublication,
  type PreviousEvent,
  projectPublicationCycle,
} from "./publication";
import { validatePublicationDashboard } from "./publication-validation";
import type { createServiceClient } from "./supabase";
import {
  detectThreatEvents,
  fetchOpenMeteoPlotForecast,
} from "./weather-provider";

type UserClient = SupabaseClient<Database>;
type ServiceClient = ReturnType<typeof createServiceClient>;
type PlotRow = Database["public"]["Tables"]["plots"]["Row"];

export type RefreshFailure =
  | { kind: "not_found" }
  | { kind: "rate_limited"; retryAfter: number }
  | { kind: "conflict" }
  | { kind: "stale_provider" }
  | { kind: "payload_limit" }
  | {
      kind: "unavailable";
      code:
        | "PROVIDER_TIMEOUT"
        | "PROVIDER_UNAVAILABLE"
        | "INVALID_PROVIDER_DATA"
        | "PUBLISH_FAILED";
    };

export class RefreshError extends Error {
  constructor(public readonly failure: RefreshFailure) {
    super(failure.kind);
  }
}

function rpcFailure(message: string): RefreshError {
  if (message === "NOT_FOUND") return new RefreshError({ kind: "not_found" });
  if (message === "VERSION_CONFLICT")
    return new RefreshError({ kind: "conflict" });
  if (message === "STALE_PROVIDER_DATA")
    return new RefreshError({ kind: "stale_provider" });
  if (message === "PAYLOAD_LIMIT_EXCEEDED")
    return new RefreshError({ kind: "payload_limit" });
  if (message.startsWith("RATE_LIMITED:"))
    return new RefreshError({
      kind: "rate_limited",
      retryAfter: Number(message.slice("RATE_LIMITED:".length)),
    });
  return new RefreshError({
    kind: "unavailable",
    code:
      message === "INVALID_PROVIDER_DATA"
        ? "INVALID_PROVIDER_DATA"
        : "PUBLISH_FAILED",
  });
}

function invalidForecast(): never {
  throw new RefreshError({
    kind: "unavailable",
    code: "INVALID_PROVIDER_DATA",
  });
}

function validateFarmForecast(
  candidate: unknown,
  plots: PlotRow[],
  mode: "demo" | "live",
  now: string,
): ForecastSummary {
  const forecast = forecastSummarySchema.parse(candidate);
  if (
    forecast.plots.length !== plots.length ||
    new Set(forecast.plots.map((p) => p.plotId)).size !== plots.length
  )
    invalidForecast();
  const first = forecast.plots[0];
  for (const item of forecast.plots) {
    const plot = plots.find((p) => p.id === item.plotId);
    const firstHour = item.hours[0],
      lastHour = item.hours.at(-1);
    if (
      !plot ||
      !firstHour ||
      !lastHour ||
      JSON.stringify(item.samplePoint.coordinates) !==
        JSON.stringify(
          json<PlotForecast["samplePoint"]>(plot.sample_point_geojson)
            .coordinates,
        ) ||
      item.source.code !== (mode === "demo" ? "demo" : "open_meteo") ||
      compareInstants(firstHour.at, forecast.windowStart) !== 0 ||
      compareInstants(addMinutes(lastHour.at, 60), forecast.windowEnd) !== 0 ||
      compareInstants(item.source.retrievedAt, now) > 0 ||
      compareInstants(addMinutes(item.source.retrievedAt, 60), now) <= 0 ||
      (item.source.issuedAt &&
        compareInstants(addMinutes(item.source.issuedAt, 360), now) <= 0) ||
      (mode === "demo" &&
        (JSON.stringify(item.hours) !== JSON.stringify(first?.hours) ||
          JSON.stringify(item.source) !== JSON.stringify(first?.source)))
    )
      invalidForecast();
  }
  return forecast;
}

function syntheticForecast(
  plots: Database["public"]["Tables"]["plots"]["Row"][],
  refreshedAt: string,
) {
  const windowStart = new Date(refreshedAt);
  windowStart.setUTCMinutes(0, 0, 0);
  const windowEnd = new Date(windowStart);
  windowEnd.setUTCHours(windowEnd.getUTCHours() + 24);
  return {
    schemaVersion: 1 as const,
    fetchedAt: refreshedAt,
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    plots: plots.map((plot) => ({
      plotId: plot.id,
      samplePoint: json<PlotForecast["samplePoint"]>(plot.sample_point_geojson),
      source: {
        code: "demo" as const,
        url: null,
        issuedAt: null,
        retrievedAt: refreshedAt,
        isDemo: true,
      },
      temperatureHeightM: 2 as const,
      hours: Array.from({ length: 24 }, (_, index) => {
        const at = new Date(windowStart);
        at.setUTCHours(at.getUTCHours() + index);
        return {
          at: at.toISOString(),
          temperatureC: 8,
          windGustKmh: null,
          precipitationMm: null,
          precipitationProbability: null,
          weatherCode: null,
        };
      }),
    })),
  };
}

// ownerId comes from verified bearer identity, never a request body.
export async function refreshFarm(
  userClient: UserClient,
  serviceClient: ServiceClient,
  farmId: string,
  ownerId: string,
  now = new Date(),
  options: { signal?: AbortSignal; apiKey?: string } = {},
): Promise<RefreshResponse> {
  const signal = options.signal ?? AbortSignal.timeout(55_000);
  const attemptAt = now.toISOString();
  const admission = await serviceClient
    .rpc("admit_farm_refresh", {
      p_owner_id: ownerId,
      p_farm_id: farmId,
      p_attempt_at: attemptAt,
    })
    .abortSignal(signal);
  if (admission.error) throw rpcFailure(admission.error.message);
  const admitted = z
    .strictObject({
      dataVersion: z.int().positive(),
      dataMode: z.enum(["demo", "live"]),
      customRules: z.array(riskRuleSchema).max(10),
    })
    .parse(admission.data);
  try {
    const snapshot = await loadDashboardSnapshot(userClient, farmId, signal);
    if (!snapshot.farm || snapshot.farm.owner_id !== ownerId)
      throw new RefreshError({ kind: "not_found" });
    if (snapshot.farm.data_version !== admitted.dataVersion)
      throw new RefreshError({ kind: "conflict" });
    let candidate: ForecastSummary;
    if (admitted.dataMode === "demo") {
      candidate = syntheticForecast(snapshot.plots, attemptAt);
    } else {
      const fetched: PlotForecast[] = [];
      try {
        // At most two provider requests in flight for the bounded farm dataset.
        for (let i = 0; i < snapshot.plots.length; i += 2) {
          fetched.push(
            ...(await Promise.all(
              snapshot.plots.slice(i, i + 2).map((plot) =>
                fetchOpenMeteoPlotForecast({
                  plotId: plot.id,
                  samplePoint: json<PlotForecast["samplePoint"]>(
                    plot.sample_point_geojson,
                  ),
                  signal,
                  apiKey: options.apiKey,
                }),
              ),
            )),
          );
        }
      } catch (error) {
        throw new RefreshError({
          kind: "unavailable",
          code:
            error instanceof ProviderTimeoutError ||
            signal.aborted ||
            (error instanceof DOMException && error.name === "AbortError")
              ? "PROVIDER_TIMEOUT"
              : error instanceof z.ZodError
                ? "INVALID_PROVIDER_DATA"
                : "PROVIDER_UNAVAILABLE",
        });
      }
      const firstHour = fetched[0]?.hours[0],
        lastHour = fetched[0]?.hours.at(-1);
      if (!firstHour || !lastHour) invalidForecast();
      candidate = {
        schemaVersion: 1,
        fetchedAt: fetched.reduce(
          (latest, plot) =>
            compareInstants(plot.source.retrievedAt, latest) > 0
              ? plot.source.retrievedAt
              : latest,
          fetched[0]?.source.retrievedAt ?? attemptAt,
        ),
        windowStart: firstHour.at,
        windowEnd: addMinutes(lastHour.at, 60),
        plots: fetched,
      };
    }
    const publishedAt = new Date().toISOString();
    const forecast = validateFarmForecast(
      candidate,
      snapshot.plots,
      admitted.dataMode,
      publishedAt,
    );
    const previousEvents: PreviousEvent[] = snapshot.events.map((event) => ({
      sourceCode: event.source_code as PreviousEvent["sourceCode"],
      sourceEventKey: event.source_event_key,
      kind: event.kind as PreviousEvent["kind"],
      title: event.title,
      startsAt: iso(event.starts_at),
      endsAt: iso(event.ends_at),
      issuedAt: event.issued_at ? iso(event.issued_at) : null,
      retrievedAt: iso(event.retrieved_at),
      sourceUrl: event.source_url,
      isDemo: event.is_demo,
      status: event.status as PreviousEvent["status"],
      evidence: eventEvidenceSchema.parse(event.evidence),
    }));
    const publications = buildPublication({
      forecasts: forecast.plots,
      plotAreasHa: new Map(
        snapshot.plots.map((plot) => [plot.id, plot.declared_area_ha]),
      ),
      cycles: snapshot.crop_cycles
        .filter((c) => c.ended_on === null)
        .map(projectPublicationCycle),
      previousEvents,
      now: publishedAt,
      detect: detectThreatEvents,
      ruleSet: {
        version: DEMO_V1_RULESET.version,
        rules: resolveRules(DEMO_V1_RULESET.rules, admitted.customRules),
      },
    });
    validatePublicationDashboard(snapshot, forecast, publications, publishedAt);
    const published = await serviceClient
      .rpc("publish_farm_refresh", {
        p_owner_id: ownerId,
        p_farm_id: farmId,
        p_expected_data_version: admitted.dataVersion,
        p_attempt_at: attemptAt,
        p_published_at: publishedAt,
        p_forecast: forecast as unknown as Json,
        p_events: publications as unknown as Json,
      })
      .abortSignal(signal);
    if (published.error) throw rpcFailure(published.error.message);
    const result = z
      .union([
        z.strictObject({ dataVersion: z.int().positive() }),
        z.strictObject({ errorCode: z.string() }),
      ])
      .parse(published.data);
    if ("errorCode" in result) throw rpcFailure(result.errorCode);
    return refreshResponseSchema.parse({
      farmId,
      dataVersion: result.dataVersion,
      refreshedAt: publishedAt,
      dataMode: admitted.dataMode,
      eventCount: publications.length,
      alertCount: publications.reduce(
        (count, event) => count + event.alerts.length,
        0,
      ),
    });
  } catch (error) {
    const failure =
      error instanceof RefreshError
        ? error
        : error instanceof DashboardPayloadLimitError
          ? new RefreshError({ kind: "payload_limit" })
          : error instanceof z.ZodError ||
              error instanceof ExpiredForecastEvidenceError
            ? new RefreshError({
                kind: "unavailable",
                code: "INVALID_PROVIDER_DATA",
              })
            : new RefreshError({ kind: "unavailable", code: "PUBLISH_FAILED" });
    if (
      failure.failure.kind === "unavailable" ||
      failure.failure.kind === "payload_limit"
    ) {
      await serviceClient
        .rpc("fail_farm_refresh", {
          p_owner_id: ownerId,
          p_farm_id: farmId,
          p_expected_data_version: admitted.dataVersion,
          p_attempt_at: attemptAt,
          p_completed_at: new Date().toISOString(),
          p_error_code:
            failure.failure.kind === "payload_limit"
              ? "PAYLOAD_LIMIT_EXCEEDED"
              : failure.failure.code,
        })
        .abortSignal(AbortSignal.timeout(8000));
    }
    throw failure;
  }
}
