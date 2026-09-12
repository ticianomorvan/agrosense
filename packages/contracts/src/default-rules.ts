import type { RiskRule, RuleSet } from "./agronomic";

/**
 * Synthetic initial agronomic rule catalog (version demo-v1)
 * Defined in docs/domain-model.md lines 325-341.
 */
export const DEMO_V1_RULES: RiskRule[] = [
  {
    code: "demo-maize-v3",
    hazardKind: "frost",
    cropCode: "maize",
    stageCodes: ["V3"],
    temperatureHeightM: 2,
    thresholdC: -1,
    windGustThresholdKmh: null,
    precipitationThresholdMm: null,
    minimumConsecutiveHours: 1,
    stageMaxAgeDays: 14,
    riskLevel: "moderate",
    reviewState: "synthetic",
    evidenceUrl: null,
    reasonTemplate: "Escenario sintético: la regla {code} coincide.",
    recommendedActionTemplates: [
      "Demostración: revisar el lote; no es asesoramiento agronómico.",
    ],
  },
  {
    code: "demo-maize-v6",
    hazardKind: "frost",
    cropCode: "maize",
    stageCodes: ["V6"],
    temperatureHeightM: 2,
    thresholdC: -1,
    windGustThresholdKmh: null,
    precipitationThresholdMm: null,
    minimumConsecutiveHours: 1,
    stageMaxAgeDays: 14,
    riskLevel: "high",
    reviewState: "synthetic",
    evidenceUrl: null,
    reasonTemplate: "Escenario sintético: la regla {code} coincide.",
    recommendedActionTemplates: [
      "Demostración: revisar el lote; no es asesoramiento agronómico.",
    ],
  },
  {
    code: "demo-soybean-r4",
    hazardKind: "frost",
    cropCode: "soybean",
    stageCodes: ["R4"],
    temperatureHeightM: 2,
    thresholdC: -1,
    windGustThresholdKmh: null,
    precipitationThresholdMm: null,
    minimumConsecutiveHours: 1,
    stageMaxAgeDays: 14,
    riskLevel: "high",
    reviewState: "synthetic",
    evidenceUrl: null,
    reasonTemplate: "Escenario sintético: la regla {code} coincide.",
    recommendedActionTemplates: [
      "Demostración: revisar el lote; no es asesoramiento agronómico.",
    ],
  },
  {
    code: "demo-maize-heat",
    hazardKind: "extreme-heat",
    cropCode: "maize",
    stageCodes: ["VT"],
    temperatureHeightM: 2,
    thresholdC: 35,
    windGustThresholdKmh: null,
    precipitationThresholdMm: null,
    minimumConsecutiveHours: 2,
    stageMaxAgeDays: 14,
    riskLevel: "critical",
    reviewState: "synthetic",
    evidenceUrl: null,
    reasonTemplate: "Escenario sintético: la regla {code} coincide.",
    recommendedActionTemplates: [
      "Demostración: revisar el lote; no es asesoramiento agronómico.",
    ],
  },
  {
    code: "demo-storm-v",
    hazardKind: "severe-storm",
    cropCode: "maize",
    stageCodes: ["V6"],
    temperatureHeightM: 2,
    thresholdC: null,
    windGustThresholdKmh: 70,
    precipitationThresholdMm: null,
    minimumConsecutiveHours: 1,
    stageMaxAgeDays: 14,
    riskLevel: "high",
    reviewState: "synthetic",
    evidenceUrl: null,
    reasonTemplate: "Escenario sintético: la regla {code} coincide.",
    recommendedActionTemplates: [
      "Demostración: revisar el lote; no es asesoramiento agronómico.",
    ],
  },
];

export const DEMO_V1_RULESET: RuleSet = {
  version: "demo-v1",
  rules: DEMO_V1_RULES,
};

export const DEFAULT_AGRONOMIC_RULES = DEMO_V1_RULES;
