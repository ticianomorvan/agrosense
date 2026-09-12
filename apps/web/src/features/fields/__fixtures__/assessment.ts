import {
  type DashboardResponse,
  dashboardResponseSchema,
  estimateEconomicImpact,
} from "@agrosense/contracts";

// Synthetic test input only; no application fallback or production data source.
export function createAssessmentDashboard(
  now = new Date("2026-09-12T12:00:00Z"),
): DashboardResponse {
  const asOf = now.toISOString();
  const hour = `${asOf.slice(0, 13)}:00:00Z`;
  const rectangle = (
    west: number,
    south: number,
    east: number,
    north: number,
  ) => ({
    type: "Polygon",
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  });
  const plotIds = [
    "22222222-2222-4222-8222-222222222221",
    "22222222-2222-4222-8222-222222222222",
  ];
  const specs = [
    {
      id: plotIds[0],
      name: "North field",
      crop: "maize" as const,
      stage: "V6",
      area: 100,
      south: -31.463,
      north: -31.456,
      action:
        "Apply supplemental irrigation before the event to increase soil thermal inertia.",
    },
    {
      id: plotIds[1],
      name: "South field",
      crop: "soybean" as const,
      stage: "R4",
      area: 60,
      south: -31.47,
      north: -31.463,
      action:
        "Monitor damage to flowers, nodes, and developing pods after the event.",
    },
  ];
  const plots = specs.map((spec, index) => ({
    id: spec.id,
    name: spec.name,
    boundary: rectangle(-64.17, spec.south, -64.154, spec.north),
    samplePoint: {
      type: "Point",
      coordinates: [-64.162, (spec.south + spec.north) / 2],
    },
    declaredAreaHa: spec.area,
    activeCropCycle: {
      id: `33333333-3333-4333-8333-33333333333${index + 1}`,
      plotId: spec.id,
      cropCode: spec.crop,
      seasonLabel: "2026/27",
      sownOn: null,
      stageCode: spec.stage,
      stageAsOf: asOf.slice(0, 10),
      endedOn: null,
      updatedAt: asOf,
    },
  }));
  const source = {
    code: "demo",
    url: null,
    issuedAt: null,
    retrievedAt: asOf,
    isDemo: true,
  };
  const hours = [
    {
      at: hour,
      temperatureC: -1,
      windGustKmh: null,
      precipitationMm: null,
      precipitationProbability: null,
      weatherCode: null,
    },
  ];
  const evidence = {
    schemaVersion: 1,
    scope: "farm_demo",
    plotIds,
    forecastDate: asOf.slice(0, 10),
    samplePoint: null,
    source,
    temperatureHeightM: 2,
    detectionThresholdC: 0,
    hours,
  };
  const event = {
    id: "44444444-4444-4444-8444-444444444444",
    status: "active",
    startsAt: hour,
    endsAt: new Date(now.getTime() + 2 * 3600000).toISOString(),
    evidence,
  };
  const alerts = specs.map((spec, index) => {
    const lossEstimate = estimateEconomicImpact({
      areaHa: spec.area,
      cropCode: spec.crop,
      hazardKind: "frost",
      riskLevel: "high",
    });
    return {
      id: `55555555-5555-4555-8555-55555555555${index + 1}`,
      plotId: spec.id,
      eventId: event.id,
      assessmentState: "evaluated",
      riskLevel: "high",
      reason: `Synthetic frost assessment for ${spec.name}.`,
      recommendedActions: [spec.action],
      ruleVersion: "test-v1",
      generatedAt: new Date(now.getTime() - 60000).toISOString(),
      validUntil: new Date(now.getTime() + 6 * 3600000).toISOString(),
      generationMethod: "template",
      isStale: false,
      lossEstimate,
      inputSnapshot: {
        schemaVersion: 1,
        plotId: spec.id,
        cropCycle: plots[index]?.activeCropCycle,
        event,
        ruleSetVersion: "test-v1",
        matchedRuleCodes: [],
        generation: { method: "template", modelId: null, promptVersion: null },
        lossEstimate,
      },
    };
  });
  return dashboardResponseSchema.parse({
    schemaVersion: 1,
    asOf,
    farm: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Test farm",
      province: "Córdoba",
      locality: null,
      timezone: "America/Argentina/Cordoba",
      dataMode: "demo",
      boundary: rectangle(-64.17, -31.47, -64.154, -31.456),
      declaredAreaHa: 235,
      dataVersion: 1,
      customRules: [],
    },
    plots,
    basemap: { status: "unavailable", reason: "No test imagery is supplied." },
    forecast: {
      schemaVersion: 1,
      fetchedAt: asOf,
      windowStart: hour,
      windowEnd: new Date(Date.parse(hour) + 3600000).toISOString(),
      plots: plots.map((plot) => ({
        plotId: plot.id,
        samplePoint: plot.samplePoint,
        source,
        temperatureHeightM: 2,
        hours,
      })),
    },
    events: [
      {
        ...event,
        kind: "frost",
        title: "Synthetic frost event",
        temporalState: "ongoing",
        source,
        alerts,
      },
    ],
    monitoring: {
      status: "fresh",
      lastAttemptAt: asOf,
      lastSuccessAt: asOf,
      lastErrorCode: null,
      forecastValidUntil: new Date(now.getTime() + 3600000).toISOString(),
    },
  });
}
