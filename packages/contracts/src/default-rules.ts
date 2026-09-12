import type { AgronomicRule } from "./agronomic";

export const DEFAULT_AGRONOMIC_RULES: AgronomicRule[] = [
  // ==========================================
  // MAIZE
  // ==========================================
  {
    id: "rule-maize-emergence-frost",
    crop: "maize",
    phenologicalStage: "emergence",
    event: "frost",
    thresholds: {
      minTemperatureC: -1,
      minimumConsecutiveHours: 1,
    },
    severity: "moderate",
    titleTemplate: "Frost risk during maize emergence",
    descriptionTemplate:
      "Sub-zero temperatures during emergence. The growing point remains beneath the soil surface.",
    recommendedActions: [
      "Assess seedling emergence and survival 48 to 72 hours post-event.",
      "Check the color and turgor of the growing point beneath the soil surface.",
    ],
    baseConfidence: 0.9,
  },
  {
    id: "rule-maize-vegetative-frost",
    crop: "maize",
    phenologicalStage: "vegetative",
    event: "frost",
    thresholds: {
      minTemperatureC: -1,
      minimumConsecutiveHours: 1,
    },
    severity: "high",
    titleTemplate: "Agronomic frost in vegetative maize",
    descriptionTemplate:
      "Temperatures at or below -1°C in vegetative maize with exposed apex or susceptible to severe leaf necrosis.",
    recommendedActions: [
      "Inspect the percentage of active green leaf area remaining.",
      "Verify whether the above-ground growing point sustained lethal frost burn.",
      "Postpone post-emergence herbicide and foliar fertilizer applications until active recovery is confirmed.",
    ],
    baseConfidence: 0.9,
  },
  {
    id: "rule-maize-vegetative-storm",
    crop: "maize",
    phenologicalStage: "vegetative",
    event: "severe-storm",
    thresholds: {
      windGustKmh: 60,
      precipitationMm: 30,
      minimumConsecutiveHours: 1,
    },
    severity: "high",
    titleTemplate: "Severe storm with damaging gusts in vegetative maize",
    descriptionTemplate:
      "High wind gusts and intense rainfall with risk of stalk breakage (green snap) or root lodging.",
    recommendedActions: [
      "Survey fields to determine incidence of stalk breakage and lodging.",
      "Inspect drainage and identify low-lying areas susceptible to prolonged waterlogging.",
    ],
    baseConfidence: 0.85,
  },
  {
    id: "rule-maize-vegetative-hail",
    crop: "maize",
    phenologicalStage: "vegetative",
    event: "hail",
    thresholds: {
      convectiveIndex: 70,
      precipitationMm: 15,
      minimumConsecutiveHours: 1,
    },
    severity: "high",
    titleTemplate: "Hail alert in vegetative maize",
    descriptionTemplate:
      "Severe convective conditions with high probability of solid precipitation and mechanical defoliation.",
    recommendedActions: [
      "Wait 3 to 5 days before estimating permanent leaf area loss.",
      "Determine whether the whorl/growing point is actively pushing out new undamaged leaves.",
    ],
    baseConfidence: 0.8,
  },
  {
    id: "rule-maize-flowering-heat",
    crop: "maize",
    phenologicalStage: "flowering",
    event: "extreme-heat",
    thresholds: {
      maxTemperatureC: 35,
      minimumConsecutiveHours: 2,
    },
    severity: "critical",
    titleTemplate: "Extreme heat stress during maize flowering",
    descriptionTemplate:
      "Temperatures exceeding 35°C during pollination and silking, causing pollen desiccation and kernel abortion.",
    recommendedActions: [
      "Monitor synchrony between tassel pollen shed and silk emergence (anthesis-silking interval).",
      "Inspect ear fill and ovule fertilization once the high-temperature period subsides.",
    ],
    baseConfidence: 0.95,
  },
  {
    id: "rule-maize-grain-filling-frost",
    crop: "maize",
    phenologicalStage: "grain_filling",
    event: "frost",
    thresholds: {
      minTemperatureC: 0,
      minimumConsecutiveHours: 1,
    },
    severity: "critical",
    titleTemplate: "Early freeze during maize grain filling",
    descriptionTemplate:
      "Freezing temperatures halting canopy photosynthesis and premature grain dry-down.",
    recommendedActions: [
      "Check kernel milk line progression to evaluate physiological maturity status (black layer).",
      "Plan early harvesting for silage or prepare for artificial drying if maturation stopped prematurely.",
    ],
    baseConfidence: 0.9,
  },

  // ==========================================
  // SOYBEAN
  // ==========================================
  {
    id: "rule-soybean-emergence-frost",
    crop: "soybean",
    phenologicalStage: "emergence",
    event: "frost",
    thresholds: {
      minTemperatureC: 0,
      minimumConsecutiveHours: 1,
    },
    severity: "critical",
    titleTemplate: "Critical frost during soybean emergence",
    descriptionTemplate:
      "Tender cotyledon tissue highly vulnerable to lethal freezing injury at ground level.",
    recommendedActions: [
      "Assess seedling mortality below the cotyledonary node.",
      "Count surviving stand density per linear meter to evaluate potential replanting thresholds.",
    ],
    baseConfidence: 0.95,
  },
  {
    id: "rule-soybean-vegetative-frost",
    crop: "soybean",
    phenologicalStage: "vegetative",
    event: "frost",
    thresholds: {
      minTemperatureC: -1,
      minimumConsecutiveHours: 1,
    },
    severity: "moderate",
    titleTemplate: "Moderate frost in vegetative soybean",
    descriptionTemplate:
      "Foliar necrosis on expanded trifoliates; plants retain branching capacity from axillary buds.",
    recommendedActions: [
      "Inspect vitality of lower axillary nodes for regrowth potential.",
      "Suspend post-emergence pesticide spraying until new shoot development is observed.",
    ],
    baseConfidence: 0.85,
  },
  {
    id: "rule-soybean-flowering-heat",
    crop: "soybean",
    phenologicalStage: "flowering",
    event: "extreme-heat",
    thresholds: {
      maxTemperatureC: 35,
      minimumConsecutiveHours: 2,
    },
    severity: "critical",
    titleTemplate: "Extreme heat wave during soybean flowering",
    descriptionTemplate:
      "High temperatures accelerating floral and young pod abscission.",
    recommendedActions: [
      "Monitor flower retention rate across intermediate canopy nodes.",
      "Assess root zone plant-available water to anticipate pod abortion severity.",
    ],
    baseConfidence: 0.9,
  },
  {
    id: "rule-soybean-grain-filling-hail",
    crop: "soybean",
    phenologicalStage: "grain_filling",
    event: "hail",
    thresholds: {
      convectiveIndex: 70,
      precipitationMm: 20,
      minimumConsecutiveHours: 1,
    },
    severity: "critical",
    titleTemplate: "Destructive hail in pod-filling soybean",
    descriptionTemplate:
      "Mechanical hail damage with high risk of shattered pods and direct seed loss.",
    recommendedActions: [
      "Quantify opened, bruised, and dropped pods per square meter.",
      "Evaluate preventative fungicide application if severe stem bruising occurs under humid conditions.",
    ],
    baseConfidence: 0.9,
  },
  {
    id: "rule-soybean-grain-filling-frost",
    crop: "soybean",
    phenologicalStage: "grain_filling",
    event: "frost",
    thresholds: {
      minTemperatureC: -1,
      minimumConsecutiveHours: 1,
    },
    severity: "high",
    titleTemplate: "Frost during soybean seed filling",
    descriptionTemplate:
      "Premature canopy senescence and arrested seed development in green pods.",
    recommendedActions: [
      "Monitor percentage of green seeds affecting commercial grade.",
      "Track grain moisture to schedule harvesting as soon as optimal harvest moisture is reached.",
    ],
    baseConfidence: 0.9,
  },
];
