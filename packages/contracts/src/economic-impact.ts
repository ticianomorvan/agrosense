import { z } from "zod";
import type { CropCode } from "./agronomic";
import { eventKindSchema, riskLevelSchema } from "./agronomic";

export const demoEconomicImpactSchema = z.strictObject({
  currency: z.literal("USD"),
  estimatedLossUsd: z.number().min(0),
  exposedProductionTons: z.number().min(0),
  expectedYieldTonsPerHa: z.number().positive(),
  expectedPriceUsdPerTon: z.number().positive(),
  damageRate: z.number().min(0).max(1),
  hazardKind: eventKindSchema,
  riskLevel: riskLevelSchema,
  cropCode: z.enum(["maize", "soybean"]),
  methodologyVersion: z.literal("demo-v1"),
});
export type EconomicImpact = z.infer<typeof demoEconomicImpactSchema>;

const demoYieldTonsPerHa: Record<CropCode, number> = {
  maize: 8.5,
  soybean: 3.2,
};

const demoPriceUsdPerTon: Record<CropCode, number> = {
  maize: 180,
  soybean: 360,
};

const damageRates: Record<
  z.infer<typeof eventKindSchema>,
  Record<z.infer<typeof riskLevelSchema>, number>
> = {
  frost: { low: 0.03, moderate: 0.08, high: 0.2, critical: 0.4 },
  "extreme-heat": { low: 0.04, moderate: 0.12, high: 0.3, critical: 0.55 },
  "severe-storm": { low: 0.05, moderate: 0.15, high: 0.3, critical: 0.5 },
  hail: { low: 0.08, moderate: 0.2, high: 0.4, critical: 0.65 },
};

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100;
}

/**
 * Synthetic MVP valuation. Values are intentionally versioned and must not be
 * presented as validated agronomic or market data.
 */
export function estimateEconomicImpact(input: {
  areaHa: number;
  cropCode: CropCode;
  hazardKind: z.infer<typeof eventKindSchema>;
  riskLevel: z.infer<typeof riskLevelSchema>;
}): EconomicImpact {
  const expectedYieldTonsPerHa = demoYieldTonsPerHa[input.cropCode];
  const expectedPriceUsdPerTon = demoPriceUsdPerTon[input.cropCode];
  const damageRate = damageRates[input.hazardKind][input.riskLevel];
  const exposedProductionTons = input.areaHa * expectedYieldTonsPerHa;
  const estimatedLossUsd =
    exposedProductionTons * expectedPriceUsdPerTon * damageRate;

  return demoEconomicImpactSchema.parse({
    currency: "USD",
    estimatedLossUsd: roundCurrency(estimatedLossUsd),
    exposedProductionTons: roundCurrency(exposedProductionTons),
    expectedYieldTonsPerHa,
    expectedPriceUsdPerTon,
    damageRate,
    hazardKind: input.hazardKind,
    riskLevel: input.riskLevel,
    cropCode: input.cropCode,
    methodologyVersion: "demo-v1",
  });
}
