import {
  type DashboardResponse,
  dashboardResponseSchema,
  estimateEconomicImpact,
  type SatellitePreview,
  type SatelliteRequest,
} from "@agrosense/contracts";
import type { FarmDataSource } from "./queries";

function rectangle(west: number, south: number, east: number, north: number) {
  return {
    type: "Polygon" as const,
    coordinates: [
      [
        [west, south],
        [east, south],
        [east, north],
        [west, north],
        [west, south],
      ],
    ],
  };
}

export function createDemoDashboard(now = new Date()): DashboardResponse {
  const asOf = now.toISOString();

  // Use today if not late in the day, otherwise tomorrow so upcoming window fits in 24h
  const currentHour = now.getUTCHours();
  const isLate = currentHour >= 21;
  const targetDateObj = isLate ? new Date(now.getTime() + 86400000) : now;
  const year = targetDateObj.getUTCFullYear();
  const month = String(targetDateObj.getUTCMonth() + 1).padStart(2, "0");
  const day = String(targetDateObj.getUTCDate()).padStart(2, "0");
  const forecastDate = `${year}-${month}-${day}`;

  const startsHour = isLate ? 2 : currentHour;
  const endsHour = startsHour + 4;

  const event1StartsAt = `${forecastDate}T${String(startsHour).padStart(2, "0")}:00:00Z`;
  const event1EndsAt = `${forecastDate}T${String(endsHour).padStart(2, "0")}:00:00Z`;

  const validUntil = new Date(now.getTime() + 6 * 3600 * 1000).toISOString();

  const plot1Id = "22222222-2222-4222-8222-222222222221";
  const plot2Id = "22222222-2222-4222-8222-222222222222";
  const plot3Id = "22222222-2222-4222-8222-222222222223";

  const plot1Area = 100;
  const plot2Area = 60;
  const plot3Area = 40;

  const source = {
    code: "demo" as const,
    url: null,
    issuedAt: null,
    retrievedAt: asOf,
    isDemo: true,
  };

  // 24 hours strictly belonging to forecastDate
  const hours = Array.from({ length: 24 }, (_, i) => {
    const hh = String(i).padStart(2, "0");
    const at = `${forecastDate}T${hh}:00:00Z`;
    const isQualifying = i >= startsHour && i < endsHour;
    return {
      at,
      temperatureC: isQualifying ? -1.5 : 14,
      windGustKmh: 15,
      precipitationMm: 0,
      precipitationProbability: 0,
      weatherCode: 0,
    };
  });

  const lossPlot1 = estimateEconomicImpact({
    areaHa: plot1Area,
    cropCode: "maize",
    hazardKind: "frost",
    riskLevel: "high",
  });

  const lossPlot2 = estimateEconomicImpact({
    areaHa: plot2Area,
    cropCode: "soybean",
    hazardKind: "frost",
    riskLevel: "high",
  });

  const event1Id = "44444444-4444-4444-8444-444444444441";

  const evidence = {
    schemaVersion: 1 as const,
    scope: "farm_demo" as const,
    plotIds: [plot1Id, plot2Id],
    forecastDate,
    samplePoint: null,
    source,
    temperatureHeightM: 2 as const,
    detectionThresholdC: 0,
    hours,
  };

  const eventSnapshot = {
    id: event1Id,
    status: "active" as const,
    startsAt: event1StartsAt,
    endsAt: event1EndsAt,
    evidence,
  };

  const cycle1 = {
    id: "33333333-3333-4333-8333-333333333331",
    plotId: plot1Id,
    cropCode: "maize" as const,
    seasonLabel: "2026/27",
    sownOn: "2026-08-01",
    stageCode: "V6" as const,
    stageAsOf: forecastDate,
    endedOn: null,
    updatedAt: asOf,
  };

  const cycle2 = {
    id: "33333333-3333-4333-8333-333333333332",
    plotId: plot2Id,
    cropCode: "soybean" as const,
    seasonLabel: "2026/27",
    sownOn: "2026-08-10",
    stageCode: "R4" as const,
    stageAsOf: forecastDate,
    endedOn: null,
    updatedAt: asOf,
  };

  const cycle3 = {
    id: "33333333-3333-4333-8333-333333333333",
    plotId: plot3Id,
    cropCode: "maize" as const,
    seasonLabel: "2026/27",
    sownOn: "2026-08-20",
    stageCode: "V3" as const,
    stageAsOf: forecastDate,
    endedOn: null,
    updatedAt: asOf,
  };

  const alert1 = {
    id: "55555555-5555-4555-8555-555555555551",
    plotId: plot1Id,
    eventId: event1Id,
    assessmentState: "evaluated" as const,
    riskLevel: "high" as const,
    reason:
      "Synthetic scenario: rule demo-maize-v6 matches (-1°C at maize V6).",
    recommendedActions: [
      "Apply supplemental irrigation before the event to increase soil thermal inertia.",
      "Suspend crop-protection and foliar fertilizer applications until thermal recovery.",
      "Monitor the growing point and damage to exposed leaves 48–72 hours after the frost.",
    ],
    ruleVersion: "demo-v1",
    generatedAt: asOf,
    validUntil,
    generationMethod: "template" as const,
    inputSnapshot: {
      schemaVersion: 1 as const,
      plotId: plot1Id,
      cropCycle: cycle1,
      event: eventSnapshot,
      ruleSetVersion: "demo-v1",
      matchedRuleCodes: ["demo-maize-v6"],
      generation: {
        method: "template" as const,
        modelId: null,
        promptVersion: null,
      },
      lossEstimate: lossPlot1,
    },
    lossEstimate: lossPlot1,
    isStale: false,
  };

  const alert2 = {
    id: "55555555-5555-4555-8555-555555555552",
    plotId: plot2Id,
    eventId: event1Id,
    assessmentState: "evaluated" as const,
    riskLevel: "high" as const,
    reason:
      "Synthetic scenario: rule demo-soybean-r4 matches (-1°C at soybean R4).",
    recommendedActions: [
      "Apply irrigation beforehand if the field has equipment to mitigate the temperature drop.",
      "Suspend foliar chemical treatments to avoid phytotoxicity under cold stress.",
      "Monitor damage to flowers, nodes, and developing pods after the event.",
    ],
    ruleVersion: "demo-v1",
    generatedAt: asOf,
    validUntil,
    generationMethod: "template" as const,
    inputSnapshot: {
      schemaVersion: 1 as const,
      plotId: plot2Id,
      cropCycle: cycle2,
      event: eventSnapshot,
      ruleSetVersion: "demo-v1",
      matchedRuleCodes: ["demo-soybean-r4"],
      generation: {
        method: "template" as const,
        modelId: null,
        promptVersion: null,
      },
      lossEstimate: lossPlot2,
    },
    lossEstimate: lossPlot2,
    isStale: false,
  };

  const temporalState: "upcoming" | "ongoing" | "recent" =
    asOf < event1StartsAt
      ? "upcoming"
      : asOf < event1EndsAt
        ? "ongoing"
        : "recent";

  return dashboardResponseSchema.parse({
    schemaVersion: 1,
    asOf,
    farm: {
      id: "11111111-1111-4111-8111-111111111111",
      name: "La Posta Farm (Demo)",
      province: "Córdoba",
      locality: "Río Cuarto",
      timezone: "America/Argentina/Cordoba",
      dataMode: "demo",
      boundary: rectangle(-64.17, -31.47, -64.14, -31.44),
      declaredAreaHa: 200,
      dataVersion: 1,
      customRules: [],
    },
    plots: [
      {
        id: plot1Id,
        name: "Field 1 (Maize V6 - High Risk)",
        boundary: rectangle(-64.17, -31.46, -64.154, -31.44),
        samplePoint: { type: "Point", coordinates: [-64.162, -31.45] },
        declaredAreaHa: plot1Area,
        activeCropCycle: cycle1,
      },
      {
        id: plot2Id,
        name: "Field 2 (Soybean R4 - High Risk)",
        boundary: rectangle(-64.154, -31.47, -64.14, -31.45),
        samplePoint: { type: "Point", coordinates: [-64.147, -31.46] },
        declaredAreaHa: plot2Area,
        activeCropCycle: cycle2,
      },
      {
        id: plot3Id,
        name: "Field 3 (Maize V3 - No Alert)",
        boundary: rectangle(-64.154, -31.45, -64.14, -31.44),
        samplePoint: { type: "Point", coordinates: [-64.147, -31.445] },
        declaredAreaHa: plot3Area,
        activeCropCycle: cycle3,
      },
    ],
    basemap: {
      status: "unavailable",
      reason: "Satellite imagery preview is not configured.",
    },
    forecast: {
      schemaVersion: 1,
      fetchedAt: asOf,
      windowStart: `${forecastDate}T00:00:00Z`,
      windowEnd: new Date(
        Date.parse(`${forecastDate}T00:00:00Z`) + 24 * 3600 * 1000,
      ).toISOString(),
      plots: [
        {
          plotId: plot1Id,
          samplePoint: { type: "Point", coordinates: [-64.162, -31.45] },
          source,
          temperatureHeightM: 2,
          hours,
        },
        {
          plotId: plot2Id,
          samplePoint: { type: "Point", coordinates: [-64.147, -31.46] },
          source,
          temperatureHeightM: 2,
          hours,
        },
        {
          plotId: plot3Id,
          samplePoint: { type: "Point", coordinates: [-64.147, -31.445] },
          source,
          temperatureHeightM: 2,
          hours,
        },
      ],
    },
    events: [
      {
        ...eventSnapshot,
        kind: "frost",
        title: "Forecast Meteorological Frost",
        temporalState,
        source,
        alerts: [alert1, alert2],
      },
    ],
    monitoring: {
      status: "fresh",
      lastAttemptAt: asOf,
      lastSuccessAt: asOf,
      lastErrorCode: null,
      forecastValidUntil: validUntil,
    },
  });
}

export function createDemoSource(): FarmDataSource {
  return {
    scope: "demo",
    farmId: "11111111-1111-4111-8111-111111111111",
    loadDashboard: async () => createDemoDashboard(),
    loadSatellite: async (
      _window: SatelliteRequest,
    ): Promise<SatellitePreview> => ({
      status: "unavailable",
      reason: "not_configured",
      message: "Satellite preview is not configured in demo mode.",
    }),
  };
}
