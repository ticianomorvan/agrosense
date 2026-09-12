import { z } from "zod";
import { boundedFetch } from "./http";

export const FARM_TIMEZONE = "America/Argentina/Cordoba";
const temperature = z.number().min(-100).max(70);
const providerSchema = z.object({
  timezone: z.literal(FARM_TIMEZONE),
  daily_units: z.object({
    time: z.literal("iso8601"),
    temperature_2m_min: z.literal("°C"),
    temperature_2m_max: z.literal("°C"),
    precipitation_sum: z.literal("mm"),
  }),
  daily: z.object({
    time: z.array(z.iso.date()).min(1).max(7),
    temperature_2m_min: z.array(temperature).min(1).max(7),
    temperature_2m_max: z.array(temperature).min(1).max(7),
    precipitation_sum: z.array(z.number().min(0).max(5000)).min(1).max(7),
  }),
});

export class InvalidForecastError extends Error {}

export function localDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: FARM_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (name: string) =>
    parts.find((item) => item.type === name)?.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export async function getPlotForecast(options: {
  plotId: string;
  plotName: string;
  coordinates: [number, number];
  days: number;
  signal: AbortSignal;
  fetcher: typeof fetch;
  now: () => Date;
}) {
  const url = new URL("https://api.open-meteo.com/v1/forecast");
  url.search = new URLSearchParams({
    latitude: String(options.coordinates[1]),
    longitude: String(options.coordinates[0]),
    daily: "temperature_2m_min,temperature_2m_max,precipitation_sum",
    temperature_unit: "celsius",
    precipitation_unit: "mm",
    timezone: FARM_TIMEZONE,
    forecast_days: String(options.days),
  }).toString();
  const requestedAt = options.now();
  const response = await boundedFetch(
    url,
    {},
    { ...options, timeoutMs: 8000, maxBytes: 64 * 1024 },
  );
  if (!response.ok) throw new Error("Forecast provider unavailable");
  const parsed = providerSchema.safeParse(await response.json());
  if (!parsed.success) throw new InvalidForecastError();
  const { daily } = parsed.data;
  if (
    [
      daily.time,
      daily.temperature_2m_min,
      daily.temperature_2m_max,
      daily.precipitation_sum,
    ].some((items) => items.length !== options.days)
  )
    throw new InvalidForecastError();
  const start = new Date(`${localDate(requestedAt)}T00:00:00Z`).getTime();
  const days = daily.time.map((date, index) => {
    const minTemperatureC = daily.temperature_2m_min[index];
    const maxTemperatureC = daily.temperature_2m_max[index];
    const precipitationMm = daily.precipitation_sum[index];
    if (
      minTemperatureC === undefined ||
      maxTemperatureC === undefined ||
      precipitationMm === undefined ||
      minTemperatureC > maxTemperatureC ||
      date !== new Date(start + index * 86400000).toISOString().slice(0, 10)
    )
      throw new InvalidForecastError();
    return { date, minTemperatureC, maxTemperatureC, precipitationMm };
  });
  return {
    plotId: options.plotId,
    plotName: options.plotName,
    timezone: FARM_TIMEZONE,
    fetchedAt: options.now().toISOString(),
    temperatureHeightM: 2,
    source: {
      code: "open_meteo",
      url: "https://open-meteo.com/",
      issuedAt: null,
      isDemo: false,
    },
    days,
  };
}
