import type { RiskRule, RuleSet } from "./agronomic";
import type { EventKind } from "./dashboard";

/**
 * Recommended preventive actions by hazard kind for demonstration and operational use.
 */
export const HAZARD_RECOMMENDED_ACTIONS: Record<EventKind, string[]> = {
  frost: [
    "Aplicar riego previo si el lote cuenta con equipo para aumentar la inercia térmica del suelo.",
    "Suspender aplicaciones de herbicidas post-emergentes y fertilizantes foliares hasta la recuperación térmica.",
    "Monitorear ápice de crecimiento y daño foliar a las 48–72 hs posteriores a la helada.",
  ],
  "extreme-heat": [
    "Priorizar turnos de riego de alivio durante etapas de floración (VT/R1) para sostener el cuaje de granos.",
    "Suspender pulverizaciones diurnas con temperaturas superiores a 32 °C para evitar deriva y fitotoxicidad.",
    "Programar aplicaciones en ventanas nocturnas o matutinas con coadyuvantes antievaporantes.",
  ],
  "severe-storm": [
    "Resguardar pulverizadoras, tolvas y maquinaria en galpones antes del inicio de ráfagas intensas.",
    "Suspender tratamientos fitosanitarios para evitar el lavado de producto por lluvias torrenciales.",
    "Revisar y despejar canales aliviadores o vías de escurrimiento para prevenir anegamientos prolongados.",
  ],
  hail: [
    "Verificar la vigencia y cobertura de las pólizas de seguro agrícola para los lotes afectados.",
    "Resguardar vehículos y maquinaria móvil en áreas cubiertas antes del inicio de la tormenta.",
    "Planificar recorrida a campo post-tormenta para evaluar porcentaje de defoliación y viabilidad de nudos.",
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
    reasonTemplate: "Escenario sintético: la regla {code} coincide.",
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
    reasonTemplate: "Escenario sintético: la regla {code} coincide.",
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
    reasonTemplate: "Escenario sintético: la regla {code} coincide.",
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
    reasonTemplate: "Escenario sintético: la regla {code} coincide.",
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
    reasonTemplate: "Escenario sintético: la regla {code} coincide.",
    recommendedActionTemplates: HAZARD_RECOMMENDED_ACTIONS["severe-storm"],
  },
];

export const DEMO_V1_RULESET: RuleSet = {
  version: "demo-v1",
  rules: DEMO_V1_RULES,
};

export const DEFAULT_AGRONOMIC_RULES = DEMO_V1_RULES;
