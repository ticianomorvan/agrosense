import type { RiskRule, RuleSet } from "./agronomic";
import type { EventKind } from "./dashboard";

/**
 * Recommended preventive actions by hazard kind for demonstration and operational use.
 */
export const HAZARD_RECOMMENDED_ACTIONS: Record<EventKind, string[]> = {
  frost: [
    "Apply irrigation beforehand if the field has equipment to increase soil thermal inertia.",
    "Suspend post-emergence herbicide and foliar fertilizer applications until thermal recovery.",
    "Monitor the growing point and foliar damage 48–72 hours after the frost.",
  ],
  "extreme-heat": [
    "Prioritize relief irrigation shifts during flowering stages (VT/R1) to sustain grain set.",
    "Suspend daytime spraying above 32 °C to avoid drift and phytotoxicity.",
    "Schedule applications in nighttime or morning windows with anti-evaporation adjuvants.",
  ],
  "severe-storm": [
    "Store sprayers, hoppers, and machinery in sheds before intense gusts begin.",
    "Suspend crop-protection treatments to prevent product wash-off from torrential rain.",
    "Inspect and clear relief channels or drainage paths to prevent prolonged waterlogging.",
  ],
  hail: [
    "Verify the validity and coverage of agricultural insurance policies for affected fields.",
    "Move vehicles and mobile machinery to covered areas before the storm begins.",
    "Plan a post-storm field walk to assess defoliation percentage and node viability.",
  ],
};

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
    reasonTemplate: "Synthetic scenario: rule {code} matches.",
    recommendedActionTemplates: HAZARD_RECOMMENDED_ACTIONS.frost,
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
    reasonTemplate: "Synthetic scenario: rule {code} matches.",
    recommendedActionTemplates: HAZARD_RECOMMENDED_ACTIONS.frost,
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
    reasonTemplate: "Synthetic scenario: rule {code} matches.",
    recommendedActionTemplates: HAZARD_RECOMMENDED_ACTIONS.frost,
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
    reasonTemplate: "Synthetic scenario: rule {code} matches.",
    recommendedActionTemplates: HAZARD_RECOMMENDED_ACTIONS["extreme-heat"],
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
    reasonTemplate: "Synthetic scenario: rule {code} matches.",
    recommendedActionTemplates: HAZARD_RECOMMENDED_ACTIONS["severe-storm"],
  },
];

export const DEMO_V1_RULESET: RuleSet = {
  version: "demo-v1",
  rules: DEMO_V1_RULES,
};
