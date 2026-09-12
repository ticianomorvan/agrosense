import type { RefreshResponse } from "@agrosense/contracts";
import { refreshResponseSchema } from "@agrosense/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import type { createServiceClient } from "./supabase";

type UserClient = SupabaseClient<Database>;
type ServiceClient = ReturnType<typeof createServiceClient>;

export type RefreshFailure =
  | { kind: "not_found" }
  | { kind: "rate_limited"; retryAfter: number }
  | { kind: "conflict" }
  | { kind: "unavailable"; code: "PROVIDER_UNAVAILABLE" };

export class RefreshError extends Error {
  constructor(public readonly failure: RefreshFailure) {
    super(failure.kind);
  }
}

const REFRESH_COOLDOWN_MS = 60_000;

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
      samplePoint: plot.sample_point_geojson,
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
  serviceClient: ServiceClient,
  farmId: string,
  now = new Date(),
): Promise<RefreshResponse> {
  const { data: farm, error: farmError } = await userClient
    .from("farms")
    .select("id,data_mode,data_version,last_attempt_at")
    .eq("id", farmId)
    .maybeSingle();
  if (farmError) throw farmError;
  if (!farm) throw new RefreshError({ kind: "not_found" });

  if (farm.last_attempt_at) {
    const elapsed = now.getTime() - new Date(farm.last_attempt_at).getTime();
    if (elapsed < REFRESH_COOLDOWN_MS)
      throw new RefreshError({
        kind: "rate_limited",
        retryAfter: Math.ceil((REFRESH_COOLDOWN_MS - elapsed) / 1000),
      });
  }
  if (farm.data_mode !== "demo")
    throw new RefreshError({
      kind: "unavailable",
      code: "PROVIDER_UNAVAILABLE",
    });

  const { data: plots, error: plotsError } = await userClient
    .from("plots")
    .select("*")
    .eq("farm_id", farmId);
  if (plotsError) throw plotsError;
  const refreshedAt = now.toISOString();
  const nextVersion = farm.data_version + 1;
  const forecast = syntheticForecast(plots ?? [], refreshedAt);
  const { data: updatedFarm, error: updateError } = await serviceClient
    .from("farms")
    .update({
      forecast_summary: forecast,
      last_attempt_at: refreshedAt,
      last_success_at: refreshedAt,
      last_error_code: null,
      data_version: nextVersion,
    })
    .eq("id", farmId)
    .eq("data_version", farm.data_version)
    .select("id")
    .maybeSingle();
  if (updateError) throw updateError;
  if (!updatedFarm) throw new RefreshError({ kind: "conflict" });

  return refreshResponseSchema.parse({
    farmId,
    dataVersion: nextVersion,
    refreshedAt,
    dataMode: farm.data_mode,
    eventCount: 0,
    alertCount: 0,
  });
}
