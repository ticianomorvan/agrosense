import {
  type EventEvidence,
  pointInPolygon,
  pointSchema,
  polygonContainsPolygon,
  polygonSchema,
  polygonsOverlap,
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
      if (polygonsOverlap([a], [b]))
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
  const plotIds = seed.plots.map(() => crypto.randomUUID());
  const forecastDate = nowIso.slice(0, 10);
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
  const firstHour = hours[0];
  const secondHour = hours[1];
  if (!firstHour || !secondHour) throw new Error("Demo forecast has no hours");
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
  const eventId = crypto.randomUUID();
  const alerts = seed.plots.map((plot, index) => {
    const plotId = plotIds[index];
    if (!plotId) throw new Error("Missing plot id");
    const evaluation = evaluateRisk(
      demoRuleSet,
      evidence,
      {
        id: crypto.randomUUID(),
        plotId,
        ...plot.cropCycle,
        endedOn: null,
        updatedAt: nowIso,
      },
      "frost",
    );
    return {
      plotId,
      assessmentState: evaluation.assessmentState,
      riskLevel: evaluation.riskLevel,
      reason: evaluation.reason,
      recommendedActions: evaluation.recommendedActions,
      inputSnapshot: {
        schemaVersion: 1,
        plotId,
        cropCycle: null,
        event: {
          id: eventId,
          status: "active",
          startsAt: firstHour.at,
          endsAt: secondHour.at,
          evidence,
        },
        ruleSetVersion: demoRuleSet.version,
        matchedRuleCodes: evaluation.matchedRuleCodes,
        generation: { method: "template", modelId: null, promptVersion: null },
      },
      ruleVersion: demoRuleSet.version,
      generatedAt: nowIso,
      validUntil: new Date(now.getTime() + 3600000).toISOString(),
      generationMethod: "template",
    };
  });
  const payload = {
    farm: {
      name: seed.farm.name,
      province: seed.farm.province,
      locality: seed.farm.locality,
      boundary: seed.farm.boundary,
      declaredAreaHa: seed.farm.declaredAreaHa,
    },
    plots: seed.plots.map((plot, index) => ({ ...plot, id: plotIds[index] })),
    event: {
      id: eventId,
      sourceEventKey: `demo:frost:${forecastDate}`,
      kind: "frost",
      title: `Alerta de Helada (${forecastDate})`,
      startsAt: firstHour.at,
      endsAt: secondHour.at,
      retrievedAt: nowIso,
      evidence,
    },
    alerts,
  };
  const { data, error } = await serviceClient.rpc("import_demo_seed", {
    p_owner_id: ownerId,
    p_payload:
      payload as unknown as Database["public"]["Functions"]["import_demo_seed"]["Args"]["p_payload"],
  });
  if (error) throw error;
  return { ...(data as { farmId: string; eventId: string }), plotIds };
}
