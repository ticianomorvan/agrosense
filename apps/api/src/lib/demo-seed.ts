import {
  type EventEvidence,
  pointInPolygon,
  pointSchema,
  polygonArea,
  polygonContainsPolygon,
  polygonSchema,
} from "@agrosense/contracts";
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "./database.types";
import { demoRuleSet, evaluateRisk } from "./risk";

const cycleSchema = z.strictObject({
  cropCode: z.enum(["maize", "soybean"]),
  seasonLabel: z.string().regex(/^\d{4}\/\d{2}$/),
  sownOn: z.iso.date().nullable(),
  stageCode: z.string().nullable(),
  stageAsOf: z.iso.date().nullable(),
});
export const demoSeedSchema = z.strictObject({
  farm: z.strictObject({
    name: z.string().min(1).max(100),
    province: z.string().min(1).max(100),
    locality: z.string().min(1).max(100).nullable(),
    boundary: polygonSchema,
    declaredAreaHa: z.number().positive(),
  }),
  plots: z
    .array(
      z.strictObject({
        name: z.string().min(1).max(100),
        boundary: polygonSchema,
        samplePoint: pointSchema,
        declaredAreaHa: z.number().positive(),
        cropCycle: cycleSchema,
      }),
    )
    .min(1)
    .max(10),
});
export type DemoSeed = z.infer<typeof demoSeedSchema>;
type ServiceClient = SupabaseClient<Database>;

function segments(ring: readonly (readonly [number, number])[]) {
  return ring.slice(0, -1).flatMap((a, i) => {
    const next = ring[i + 1];
    return next ? ([[a, next]] as const) : [];
  });
}
function cross(
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}
function properIntersection(
  a: readonly [number, number],
  b: readonly [number, number],
  c: readonly [number, number],
  d: readonly [number, number],
) {
  return (
    Math.sign(cross(a, b, c)) * Math.sign(cross(a, b, d)) < 0 &&
    Math.sign(cross(c, d, a)) * Math.sign(cross(c, d, b)) < 0
  );
}
function overlaps(
  a: readonly (readonly [number, number])[],
  b: readonly (readonly [number, number])[],
) {
  const firstA = a[0];
  const firstB = b[0];
  if (!firstA || !firstB) return false;
  return (
    segments(a).some(([x, y]) =>
      segments(b).some(([u, v]) => properIntersection(x, y, u, v)),
    ) ||
    pointInPolygon(firstA, [b as [number, number][]]) ||
    pointInPolygon(firstB, [a as [number, number][]])
  );
}

export function validateDemoSeed(input: unknown): DemoSeed {
  const seed = demoSeedSchema.parse(input);
  const farmRing = seed.farm.boundary.coordinates[0];
  if (!farmRing) throw new Error("Farm boundary is empty");
  for (const plot of seed.plots) {
    if (
      !polygonContainsPolygon(
        seed.farm.boundary.coordinates,
        plot.boundary.coordinates,
      )
    )
      throw new Error(`Plot ${plot.name} is outside the farm boundary`);
    if (
      !pointInPolygon(plot.samplePoint.coordinates, plot.boundary.coordinates)
    )
      throw new Error(`Sample point for ${plot.name} is outside its plot`);
  }
  for (let i = 0; i < seed.plots.length; i++)
    for (let j = i + 1; j < seed.plots.length; j++) {
      const a = seed.plots[i]?.boundary.coordinates[0];
      const b = seed.plots[j]?.boundary.coordinates[0];
      if (!a || !b) throw new Error("Plot boundary is empty");
      if (
        overlaps(a, b) &&
        polygonArea(a ? [a] : []) > 0 &&
        polygonArea(b ? [b] : []) > 0
      )
        throw new Error(
          `Plots ${seed.plots[i]?.name} and ${seed.plots[j]?.name} overlap`,
        );
    }
  if (
    farmRing.length +
      seed.plots.reduce(
        (n, p) => n + (p.boundary.coordinates[0]?.length ?? 0),
        0,
      ) >
    5000
  )
    throw new Error("Seed coordinate limit exceeded");
  return seed;
}

/**
 * Trusted seed boundary. Callers must use the server-only service-role client.
 * Validation happens before the first write; callers should run this once per
 * isolated seed operation, never from an authenticated browser request.
 */
export async function importDemoSeed(
  serviceClient: ServiceClient,
  ownerId: string,
  input: unknown,
  now = new Date(),
) {
  const seed = validateDemoSeed(input);
  const nowIso = now.toISOString();
  const { data: farm, error: farmError } = await serviceClient
    .from("farms")
    .insert({
      owner_id: ownerId,
      name: seed.farm.name,
      province: seed.farm.province,
      locality: seed.farm.locality,
      boundary_geojson: seed.farm
        .boundary as unknown as Database["public"]["Tables"]["farms"]["Insert"]["boundary_geojson"],
      declared_area_ha: seed.farm.declaredAreaHa,
      data_mode: "demo",
      custom_rules: [],
    })
    .select("id")
    .single();
  if (farmError) throw farmError;

  const plotIds: string[] = [];
  for (const plot of seed.plots) {
    const { data: inserted, error } = await serviceClient
      .from("plots")
      .insert({
        farm_id: farm.id,
        name: plot.name,
        boundary_geojson:
          plot.boundary as unknown as Database["public"]["Tables"]["plots"]["Insert"]["boundary_geojson"],
        sample_point_geojson:
          plot.samplePoint as unknown as Database["public"]["Tables"]["plots"]["Insert"]["sample_point_geojson"],
        declared_area_ha: plot.declaredAreaHa,
      })
      .select("id")
      .single();
    if (error) throw error;
    plotIds.push(inserted.id);
    const { error: cycleError } = await serviceClient
      .from("crop_cycles")
      .insert({
        plot_id: inserted.id,
        crop_code: plot.cropCycle.cropCode,
        season_label: plot.cropCycle.seasonLabel,
        sown_on: plot.cropCycle.sownOn,
        stage_code: plot.cropCycle.stageCode,
        stage_as_of: plot.cropCycle.stageAsOf,
      });
    if (cycleError) throw cycleError;
  }

  const forecastDate = now.toISOString().slice(0, 10);
  const hours = Array.from({ length: 24 }, (_, index) => ({
    at: new Date(
      Date.parse(`${forecastDate}T00:00:00Z`) + index * 3600000,
    ).toISOString(),
    temperatureC: index === 0 ? -2 : 8,
    windGustKmh: null,
    precipitationMm: null,
    precipitationProbability: null,
    weatherCode: null,
  }));
  const source = {
    code: "demo" as const,
    url: null,
    issuedAt: null,
    retrievedAt: nowIso,
    isDemo: true,
  };
  const evidence: EventEvidence = {
    schemaVersion: 1,
    scope: "farm_demo",
    plotIds,
    forecastDate,
    samplePoint: null,
    source,
    temperatureHeightM: 2,
    detectionThresholdC: 0,
    hours,
  };
  const firstHour = hours[0];
  const secondHour = hours[1];
  if (!firstHour || !secondHour) throw new Error("Demo forecast has no hours");
  const { data: event, error: eventError } = await serviceClient
    .from("events")
    .insert({
      farm_id: farm.id,
      source_code: "demo",
      source_event_key: `demo:frost:${forecastDate}`,
      kind: "frost",
      title: `Alerta de Helada (${forecastDate})`,
      starts_at: firstHour.at,
      ends_at: secondHour.at,
      issued_at: null,
      retrieved_at: nowIso,
      source_url: null,
      status: "active",
      evidence:
        evidence as unknown as Database["public"]["Tables"]["events"]["Insert"]["evidence"],
      is_demo: true,
    })
    .select("id")
    .single();
  if (eventError) throw eventError;
  for (const [index, plotId] of plotIds.entries()) {
    const cycle = seed.plots[index]?.cropCycle;
    const evaluation = evaluateRisk(
      demoRuleSet,
      evidence,
      cycle
        ? {
            id: "00000000-0000-4000-8000-000000000000",
            plotId,
            ...cycle,
            endedOn: null,
            updatedAt: nowIso,
          }
        : null,
      "frost",
    );
    const { error } = await serviceClient.from("plot_alerts").insert({
      farm_id: farm.id,
      plot_id: plotId,
      event_id: event.id,
      assessment_state: evaluation.assessmentState,
      risk_level: evaluation.riskLevel,
      reason: evaluation.reason,
      recommended_actions: evaluation.recommendedActions,
      input_snapshot: {
        schemaVersion: 1,
        plotId,
        cropCycle: null,
        event: {
          id: event.id,
          status: "active",
          startsAt: hours[0]?.at,
          endsAt: hours[1]?.at,
          evidence,
        } as unknown as Database["public"]["Tables"]["plot_alerts"]["Insert"]["input_snapshot"],
        ruleSetVersion: demoRuleSet.version,
        matchedRuleCodes: evaluation.matchedRuleCodes,
        generation: { method: "template", modelId: null, promptVersion: null },
      },
      rule_version: demoRuleSet.version,
      generated_at: nowIso,
      valid_until: new Date(now.getTime() + 3600000).toISOString(),
      generation_method: "template",
    });
    if (error) throw error;
  }
  return { farmId: farm.id, plotIds, eventId: event.id };
}
