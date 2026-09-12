import {
  forecastSummarySchema,
  type PlotForecast,
  type RefreshResponse,
  refreshResponseSchema,
} from "@agrosense/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./database.types";
import { json } from "./database-utils";
import { buildPublication } from "./publication";
import type { createServiceClient } from "./supabase";
import {
  detectThreatEvents,
  fetchOpenMeteoPlotForecast,
} from "./weather-provider";

type UserClient = SupabaseClient<Database>;
type ServiceClient = ReturnType<typeof createServiceClient>;

export type RefreshFailure =
  | { kind: "not_found" }
  | { kind: "rate_limited"; retryAfter: number }
  | { kind: "conflict" }
  | {
      kind: "unavailable";
      code:
        | "PROVIDER_TIMEOUT"
        | "PROVIDER_UNAVAILABLE"
        | "INVALID_PROVIDER_DATA";
    };

export class RefreshError extends Error {
  constructor(public readonly failure: RefreshFailure) {
    super(failure.kind);
  }
}

function classifyProviderFailure(error: unknown): RefreshFailure {
  if (error instanceof DOMException && error.name === "AbortError")
    return { kind: "unavailable", code: "PROVIDER_TIMEOUT" };
  if (error instanceof Error && error.name === "ZodError")
    return { kind: "unavailable", code: "INVALID_PROVIDER_DATA" };
  if (error instanceof Error)
    return { kind: "unavailable", code: "PROVIDER_UNAVAILABLE" };
  throw error;
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

export async function refreshFarm(
  userClient: UserClient,
  _serviceClient: ServiceClient,
  farmId: string,
  now = new Date(),
): Promise<RefreshResponse> {
  const refreshedAt = now.toISOString();
  const admission = await userClient.rpc("admit_farm_refresh", {
    p_farm_id: farmId,
    p_attempt_at: refreshedAt,
  });
  if (admission.error) {
    if (admission.error.message === "NOT_FOUND")
      throw new RefreshError({ kind: "not_found" });
    if (admission.error.message.startsWith("RATE_LIMITED:"))
      throw new RefreshError({
        kind: "rate_limited",
        retryAfter: Number(
          admission.error.message.slice("RATE_LIMITED:".length),
        ),
      });
    throw admission.error;
  }
  const admitted = json<{ dataVersion: number; dataMode: "demo" | "live" }>(
    admission.data,
  );
  const { data: plots, error: plotsError } = await userClient
    .from("plots")
    .select("*")
    .eq("farm_id", farmId);
  if (plotsError) throw plotsError;
  const { data: cycles, error: cyclesError } = await userClient
    .from("crop_cycles")
    .select("*")
    .in(
      "plot_id",
      (plots ?? []).map((plot) => plot.id),
    )
    .is("ended_on", null);
  if (cyclesError) throw cyclesError;
  let forecast:
    | ReturnType<typeof syntheticForecast>
    | {
        schemaVersion: 1;
        fetchedAt: string;
        windowStart: string;
        windowEnd: string;
        plots: PlotForecast[];
      };
  try {
    const fetched =
      admitted.dataMode === "live"
        ? await Promise.all(
            (plots ?? []).map((plot) =>
              fetchOpenMeteoPlotForecast({
                plotId: plot.id,
                samplePoint: json<PlotForecast["samplePoint"]>(
                  plot.sample_point_geojson,
                ),
              }),
            ),
          )
        : null;
    if (fetched) {
      const firstPlot = fetched[0];
      const firstHour = firstPlot?.hours[0];
      const lastHour = firstPlot?.hours.at(-1);
      if (!firstHour || !lastHour)
        throw new Error("Provider returned no hours");
      const start = fetched.reduce((min, plot) => {
        const hour = plot.hours[0];
        return hour && hour.at < min ? hour.at : min;
      }, firstHour.at);
      const end = fetched.reduce((max, plot) => {
        const hour = plot.hours.at(-1);
        return hour && hour.at > max ? hour.at : max;
      }, lastHour.at);
      const candidate = {
        schemaVersion: 1 as const,
        fetchedAt: refreshedAt,
        windowStart: start,
        windowEnd: new Date(Date.parse(end) + 3_600_000).toISOString(),
        plots: fetched,
      };
      forecastSummarySchema.parse(candidate);
      forecast = candidate;
    } else forecast = syntheticForecast(plots ?? [], refreshedAt);
  } catch (error) {
    const failure = classifyProviderFailure(error);
    await userClient.rpc("fail_farm_refresh", {
      p_farm_id: farmId,
      p_expected_data_version: admitted.dataVersion,
      p_attempt_at: refreshedAt,
      p_completed_at: now.toISOString(),
      p_error_code:
        failure.kind === "unavailable" ? failure.code : "PROVIDER_UNAVAILABLE",
    });
    throw new RefreshError(failure);
  }
  const publications = buildPublication({
    forecasts: forecast.plots,
    cycles: (cycles ?? []).map((cycle) => ({
      id: cycle.id,
      plotId: cycle.plot_id,
      cropCode: cycle.crop_code as "maize" | "soybean",
      stageCode: cycle.stage_code,
      stageAsOf: cycle.stage_as_of,
      sownOn: cycle.sown_on,
      endedOn: cycle.ended_on,
      updatedAt: cycle.updated_at,
    })),
    now: refreshedAt,
    detect: detectThreatEvents,
  });
  const published = await userClient.rpc("publish_farm_refresh", {
    p_farm_id: farmId,
    p_expected_data_version: admitted.dataVersion,
    p_attempt_at: refreshedAt,
    p_published_at: refreshedAt,
    p_forecast: forecast as unknown as Json,
    p_events: publications as unknown as Json,
    p_alerts: [],
  });
  if (published.error) {
    if (published.error.message === "VERSION_CONFLICT")
      throw new RefreshError({ kind: "conflict" });
    throw published.error;
  }
  const publicationResult = json<{ dataVersion?: number; errorCode?: string }>(
    published.data,
  );
  if (publicationResult.errorCode === "PUBLISH_FAILED")
    throw new RefreshError({
      kind: "unavailable",
      code: "PROVIDER_UNAVAILABLE",
    });

  return refreshResponseSchema.parse({
    farmId,
    dataVersion: publicationResult.dataVersion ?? admitted.dataVersion + 1,
    refreshedAt,
    dataMode: admitted.dataMode,
    eventCount: publications.length,
    alertCount: publications.reduce(
      (count, event) => count + event.alerts.length,
      0,
    ),
  });
}
