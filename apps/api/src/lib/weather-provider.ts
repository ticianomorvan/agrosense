import {
  type EventEvidence,
  type EventKind,
  eventEvidenceSchema,
  type ForecastHour,
  forecastHourSchema,
  type PlotForecast,
  type Point,
  plotForecastSchema,
  pointSchema,
} from "@agrosense/contracts";
import { z } from "zod";

export type DetectedThreatEvent = {
  sourceEventKey: string;
  kind: EventKind;
  title: string;
  startsAt: string;
  endsAt: string;
  evidence: EventEvidence;
};

const hour = forecastHourSchema.shape;
const providerHourlySchema = z
  .object({
    time: z
      .array(z.iso.datetime({ local: true }))
      .min(1)
      .max(168),
    temperature_2m: z.array(hour.temperatureC),
    wind_gusts_10m: z.array(hour.windGustKmh).optional(),
    precipitation: z.array(hour.precipitationMm).optional(),
    weather_code: z.array(hour.weatherCode).optional(),
    precipitation_probability: z
      .array(hour.precipitationProbability)
      .optional(),
  })
  .refine(
    (data) =>
      Object.values(data).every(
        (values) => values === undefined || values.length === data.time.length,
      ),
    "Provider arrays must have matching lengths",
  );
const providerResponseSchema = z.object({ hourly: providerHourlySchema });

// One bounded request; refresh orchestration owns any subsequent attempt.
export async function fetchOpenMeteoPlotForecast(params: {
  plotId: string;
  samplePoint: Point;
}): Promise<PlotForecast> {
  const plotId = plotForecastSchema.shape.plotId.parse(params.plotId);
  const samplePoint = pointSchema.parse(params.samplePoint);
  const [lon, lat] = samplePoint.coordinates;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation,wind_gusts_10m,weather_code,precipitation_probability&forecast_days=7&timezone=UTC`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
    const { hourly } = providerResponseSchema.parse(await response.json());
    return plotForecastSchema.parse({
      plotId,
      samplePoint,
      source: {
        code: "open_meteo",
        url: "https://open-meteo.com",
        issuedAt: null,
        retrievedAt: new Date().toISOString(),
        isDemo: false,
      },
      temperatureHeightM: 2,
      hours: hourly.time.map((at, index) => ({
        at: new Date(at.endsWith("Z") ? at : `${at}Z`).toISOString(),
        temperatureC: hourly.temperature_2m[index],
        windGustKmh: hourly.wind_gusts_10m?.[index] ?? null,
        precipitationMm: hourly.precipitation?.[index] ?? null,
        weatherCode: hourly.weather_code?.[index] ?? null,
        precipitationProbability:
          hourly.precipitation_probability?.[index] ?? null,
      })),
    });
  } finally {
    clearTimeout(timeout);
  }
}

const threats: {
  kind: EventKind;
  title: string;
  threshold: number | null;
  matches: (hour: ForecastHour) => boolean;
}[] = [
  {
    kind: "frost",
    title: "Alerta de Helada",
    threshold: 0,
    matches: (h) => h.temperatureC <= 0,
  },
  {
    kind: "extreme-heat",
    title: "Ola de Calor / Estrés Térmico",
    threshold: 35,
    matches: (h) => h.temperatureC >= 35,
  },
  {
    kind: "severe-storm",
    title: "Tormenta Severa / Vientos Fuertes",
    threshold: null,
    matches: (h) =>
      (h.windGustKmh ?? 0) >= 60 || (h.precipitationMm ?? 0) >= 25,
  },
  {
    kind: "hail",
    title: "Riesgo de Granizo",
    threshold: null,
    matches: (h) => h.weatherCode === 96 || h.weatherCode === 99,
  },
];

export function detectThreatEvents(plot: PlotForecast): DetectedThreatEvent[] {
  plot = plotForecastSchema.parse(plot);
  const days = new Map<string, ForecastHour[]>();
  for (const hour of plot.hours) {
    const date = hour.at.slice(0, 10);
    const hours = days.get(date) ?? [];
    hours.push(hour);
    days.set(date, hours);
  }

  const events: DetectedThreatEvent[] = [];
  const { isDemo } = plot.source;
  for (const [date, hours] of days) {
    for (const threat of threats) {
      const qualifying = hours.filter(threat.matches);
      const first = qualifying[0];
      const last = qualifying[qualifying.length - 1];
      if (!first || !last) continue;
      events.push({
        sourceEventKey: isDemo
          ? `demo:${threat.kind}:${date}`
          : `open_meteo:${threat.kind}:${plot.plotId}:${date}`,
        kind: threat.kind,
        title: `${threat.title} (${date})`,
        startsAt: first.at,
        endsAt: new Date(Date.parse(last.at) + 3_600_000).toISOString(),
        evidence: eventEvidenceSchema.parse({
          schemaVersion: 1,
          scope: isDemo ? "farm_demo" : "plot_forecast",
          plotIds: [plot.plotId],
          forecastDate: date,
          samplePoint: isDemo ? null : plot.samplePoint,
          source: plot.source,
          temperatureHeightM: 2,
          detectionThresholdC: threat.threshold,
          hours,
        }),
      });
    }
  }
  return events;
}
