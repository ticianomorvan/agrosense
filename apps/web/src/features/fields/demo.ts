import { dashboardResponseSchema, type Polygon } from "@agrosense/contracts";

function rectangle(
  west: number,
  south: number,
  east: number,
  north: number,
): Polygon {
  return {
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
  };
}
// Synthetic geometry near Córdoba. These are not real property boundaries.
const observed = "2026-09-12T06:00:00Z";
const plotIds = [
  "22222222-2222-4222-8222-222222222221",
  "22222222-2222-4222-8222-222222222222",
  "22222222-2222-4222-8222-222222222223",
];
export const demoDashboard = dashboardResponseSchema.parse({
  schemaVersion: 1,
  asOf: observed,
  farm: {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Demo farm",
    province: "Córdoba",
    locality: null,
    timezone: "America/Argentina/Cordoba",
    dataMode: "demo",
    boundary: rectangle(-64.17, -31.47, -64.154, -31.456),
    declaredAreaHa: 235,
    dataVersion: 1,
  },
  plots: [
    {
      id: plotIds[0],
      name: "North field",
      boundary: rectangle(-64.17, -31.463, -64.154, -31.456),
      samplePoint: { type: "Point", coordinates: [-64.162, -31.4595] },
      declaredAreaHa: 118,
      activeCropCycle: {
        id: "33333333-3333-4333-8333-333333333331",
        plotId: plotIds[0],
        cropCode: "maize",
        seasonLabel: "2026/27",
        sownOn: null,
        stageCode: "V6",
        stageAsOf: "2026-09-11",
        endedOn: null,
        updatedAt: observed,
      },
    },
    {
      id: plotIds[1],
      name: "Southwest field",
      boundary: rectangle(-64.17, -31.47, -64.162, -31.463),
      samplePoint: { type: "Point", coordinates: [-64.166, -31.4665] },
      declaredAreaHa: 59,
      activeCropCycle: {
        id: "33333333-3333-4333-8333-333333333332",
        plotId: plotIds[1],
        cropCode: "soybean",
        seasonLabel: "2026/27",
        sownOn: null,
        stageCode: "R4",
        stageAsOf: "2026-09-11",
        endedOn: null,
        updatedAt: observed,
      },
    },
    {
      id: plotIds[2],
      name: "Southeast field",
      boundary: rectangle(-64.162, -31.47, -64.154, -31.463),
      samplePoint: { type: "Point", coordinates: [-64.158, -31.4665] },
      declaredAreaHa: 58,
      activeCropCycle: null,
    },
  ],
  basemap: {
    status: "unavailable",
    reason: "Satellite imagery has not been loaded.",
  },
  forecast: null,
  events: [],
  monitoring: {
    status: "never_refreshed",
    lastAttemptAt: null,
    lastSuccessAt: null,
    lastErrorCode: null,
    forecastValidUntil: null,
  },
});
