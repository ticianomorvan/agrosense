import {
  type CreateFarmRequest,
  type CreatePlotRequest,
  createFarmResponseSchema,
  createPlotResponseSchema,
  farmListResponseSchema,
  pointInPolygon,
  polygonContainsPolygon,
  polygonSchema,
  polygonsOverlap,
} from "@agrosense/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "./database.types";

type Client = SupabaseClient<Database>;
export type OnboardingFailure =
  | "not_found"
  | "conflict"
  | "duplicate"
  | "limit"
  | "invalid";

export class OnboardingError extends Error {
  constructor(
    public kind: OnboardingFailure,
    message: string,
  ) {
    super(message);
    this.name = "OnboardingError";
  }
}

export async function listFarms(client: Client) {
  const { data, error } = await client
    .from("farms")
    .select("id,name,province,locality,data_mode")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return farmListResponseSchema.parse({
    farms: data.map((farm) => ({
      id: farm.id,
      name: farm.name,
      province: farm.province,
      locality: farm.locality,
      dataMode: farm.data_mode,
    })),
  });
}

export async function createFarm(
  client: Client,
  ownerId: string,
  request: CreateFarmRequest,
) {
  const extent = polygonExtent(request.boundary.coordinates[0] ?? []);
  if (extent.width > 0.25 || extent.height > 0.25)
    throw new OnboardingError(
      "invalid",
      "Farm boundary must span at most 0.25° in each direction for satellite previews.",
    );
  const { data, error } = await client.rpc("create_user_farm", {
    p_owner_id: ownerId,
    p_payload: request as unknown as Json,
  });
  if (error) throwOnboardingError(error);
  return createFarmResponseSchema.parse(data);
}

export async function createPlot(
  client: Client,
  ownerId: string,
  farmId: string,
  request: CreatePlotRequest,
  now = new Date(),
) {
  const { data: farm, error: farmError } = await client
    .from("farms")
    .select("id,boundary_geojson,declared_area_ha,data_version")
    .eq("id", farmId)
    .eq("owner_id", ownerId)
    .maybeSingle();
  if (farmError) throw farmError;
  if (!farm) throw new OnboardingError("not_found", "Farm not found");
  const { data: plots, error: plotsError } = await client
    .from("plots")
    .select("boundary_geojson")
    .eq("farm_id", farmId)
    .limit(11);
  if (plotsError) throw plotsError;
  if (plots.length >= 10)
    throw new OnboardingError("limit", "A farm can contain at most 10 plots.");

  const farmBoundary = polygonSchema.parse(farm.boundary_geojson);
  if (
    !polygonContainsPolygon(
      farmBoundary.coordinates,
      request.boundary.coordinates,
    )
  )
    throw new OnboardingError(
      "invalid",
      "Plot boundary must remain inside the farm boundary.",
    );
  if (
    !pointInPolygon(
      request.samplePoint.coordinates,
      request.boundary.coordinates,
    )
  )
    throw new OnboardingError(
      "invalid",
      "The forecast sample point must remain inside the plot.",
    );
  for (const stored of plots) {
    const boundary = polygonSchema.parse(stored.boundary_geojson);
    if (polygonsOverlap(boundary.coordinates, request.boundary.coordinates))
      throw new OnboardingError("invalid", "Plot boundaries cannot overlap.");
  }
  if (request.declaredAreaHa > farm.declared_area_ha)
    throw new OnboardingError(
      "invalid",
      "Plot declared area cannot exceed the farm declared area.",
    );
  const today = cordobaDate(now);
  if (
    (request.cropCycle.sownOn && request.cropCycle.sownOn > today) ||
    (request.cropCycle.stageAsOf && request.cropCycle.stageAsOf > today)
  )
    throw new OnboardingError("invalid", "Crop dates cannot be in the future.");

  const { data, error } = await client.rpc("create_farm_plot", {
    p_owner_id: ownerId,
    p_farm_id: farmId,
    p_expected_data_version: farm.data_version,
    p_payload: request as unknown as Json,
  });
  if (error) throwOnboardingError(error);
  return createPlotResponseSchema.parse(data);
}

function polygonExtent(ring: readonly (readonly [number, number])[]) {
  const longitude = ring.map(([value]) => value);
  const latitude = ring.map(([, value]) => value);
  return {
    width: Math.max(...longitude) - Math.min(...longitude),
    height: Math.max(...latitude) - Math.min(...latitude),
  };
}

function cordobaDate(now: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Argentina/Cordoba",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${value("year")}-${value("month")}-${value("day")}`;
}

function throwOnboardingError(error: {
  code?: string;
  message: string;
}): never {
  if (error.code === "P0002")
    throw new OnboardingError("not_found", "Farm not found");
  if (error.code === "40001")
    throw new OnboardingError("conflict", "Farm changed during setup");
  if (error.code === "23505")
    throw new OnboardingError("duplicate", "A plot with this name exists");
  if (error.code === "54000")
    throw new OnboardingError("limit", "The farm has reached its plot limit");
  throw error;
}
