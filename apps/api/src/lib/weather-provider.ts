import {
  type EventEvidence,
  type EventKind,
  eventEvidenceSchema,
  type ForecastHour,
  type ForecastSummary,
  forecastHourSchema,
  forecastSummarySchema,
  type PlotForecast,
  type Point,
  plotForecastSchema,
  type Source,
} from "@agrosense/contracts";

export type {
  EventEvidence,
  EventKind,
  ForecastHour,
  ForecastSummary,
  PlotForecast,
  Point,
  Source,
};

export type WeatherThreatKind = EventKind;

export type DetectedThreatEvent = {
  sourceCode: "demo" | "open_meteo" | "smn";
  sourceEventKey: string;
  kind: EventKind;
  title: string;
  startsAt: string;
  endsAt: string;
  retrievedAt: string;
  sourceUrl: string | null;
  status: "active";
  evidence: EventEvidence;
  isDemo: boolean;
};

export type DetectedFrostEvent = DetectedThreatEvent;

/**
 * Fetch wrapper con timeout (8s por especificación de SLA de proveedor),
 * reintentos y exponential backoff.
 */
export async function fetchWithRetry(
  url: string,
  retries = 2,
  timeoutMs = 8000,
): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(id);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response;
    } catch (error) {
      clearTimeout(id);
      if (attempt === retries) throw error;
      await new Promise((resolve) => setTimeout(resolve, attempt * 1000));
    }
  }
  throw new Error("Unreachable");
}

type OpenMeteoRawResponse = {
  hourly?: {
    time?: string[];
    temperature_2m?: (number | null)[];
    precipitation?: (number | null)[];
    wind_gusts_10m?: (number | null)[];
    weather_code?: (number | null)[];
    precipitation_probability?: (number | null)[];
  };
};

/**
 * Normaliza un timestamp horario a formato RFC3339 UTC terminado en 'Z'.
 */
function normalizeUtcIso(timeStr: string): string {
  const iso = timeStr.endsWith("Z") ? timeStr : `${timeStr}Z`;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid date format received from provider: ${timeStr}`);
  }
  return date.toISOString();
}

/**
 * Genera un pronóstico de demostración sintético (168 horas) para un lote,
 * con todas las variables requeridas por el motor agronómico.
 */
export function generateDemoPlotForecast(params: {
  plotId: string;
  samplePoint: Point;
  retrievedAt?: string;
  includeFrost?: boolean;
  includeHeatwave?: boolean;
  includeSevereStorm?: boolean;
  includeHail?: boolean;
}): PlotForecast {
  const retrievedAt = params.retrievedAt || new Date().toISOString();
  const baseDate = new Date(retrievedAt);
  baseDate.setUTCMinutes(0, 0, 0);

  const hours: ForecastHour[] = [];
  for (let i = 0; i < 168; i++) {
    const current = new Date(baseDate.getTime() + i * 3600 * 1000);
    const hourOfDay = current.getUTCHours();
    let temp = 16 + 6 * Math.sin(((hourOfDay - 6) / 24) * 2 * Math.PI);
    let windGust = 15;
    let precipitation = 0;
    let weatherCode = 1;
    let precipitationProbability = 0;

    // Helada: madrugada del día 2 (horas 26 a 30)
    if (params.includeFrost && i >= 26 && i <= 30) {
      temp = -1.8;
      weatherCode = 0;
    }

    // Ola de calor: tarde del día 3 (horas 52 a 56)
    if (params.includeHeatwave && i >= 52 && i <= 56) {
      temp = 37.5;
    }

    // Tormenta severa: horas 70 a 74
    if (params.includeSevereStorm && i >= 70 && i <= 74) {
      windGust = 75;
      precipitation = 35;
      weatherCode = 95; // Thunderstorm
      precipitationProbability = 90;
    }

    // Granizo: horas 90 a 92
    if (params.includeHail && i >= 90 && i <= 92) {
      windGust = 85;
      precipitation = 25;
      weatherCode = 99; // Thunderstorm with heavy hail
      precipitationProbability = 95;
    }

    hours.push(
      forecastHourSchema.parse({
        at: current.toISOString(),
        temperatureC: Math.round(temp * 10) / 10,
        windGustKmh: windGust,
        precipitationMm: precipitation,
        weatherCode,
        precipitationProbability,
      }),
    );
  }

  const source: Source = {
    code: "demo",
    url: null,
    issuedAt: null,
    retrievedAt,
    isDemo: true,
  };

  return plotForecastSchema.parse({
    plotId: params.plotId,
    samplePoint: params.samplePoint,
    source,
    temperatureHeightM: 2,
    hours,
  });
}

/**
 * Consulta la API de Open-Meteo para obtener hasta 168 horas con:
 * - temperatureC (temperature_2m)
 * - windGustKmh (wind_gusts_10m)
 * - precipitationMm (precipitation)
 * - weatherCode (weather_code)
 * - precipitationProbability (precipitation_probability)
 */
export async function fetchOpenMeteoPlotForecast(params: {
  plotId: string;
  samplePoint: Point;
}): Promise<PlotForecast> {
  const [lon, lat] = params.samplePoint.coordinates;
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&hourly=temperature_2m,precipitation,wind_gusts_10m,weather_code,precipitation_probability&forecast_days=7&timezone=UTC`;

  const retrievedAt = new Date().toISOString();
  const response = await fetchWithRetry(url);
  const data = (await response.json()) as OpenMeteoRawResponse;

  if (
    !data.hourly?.time ||
    !data.hourly?.temperature_2m ||
    data.hourly.time.length === 0 ||
    data.hourly.time.length !== data.hourly.temperature_2m.length
  ) {
    throw new Error(
      "Open-Meteo returned invalid or missing hourly temperature data",
    );
  }

  const hours: ForecastHour[] = [];
  for (let i = 0; i < data.hourly.time.length; i++) {
    const timeStr = data.hourly.time[i];
    const temp = data.hourly.temperature_2m[i];
    const gust = data.hourly.wind_gusts_10m?.[i];
    const precip = data.hourly.precipitation?.[i];
    const code = data.hourly.weather_code?.[i];
    const prob = data.hourly.precipitation_probability?.[i];

    if (
      timeStr === undefined ||
      temp === null ||
      temp === undefined ||
      !Number.isFinite(temp)
    ) {
      throw new Error(
        "Open-Meteo temperature values must be finite numbers; missing temperatures invalidate the refresh",
      );
    }

    hours.push(
      forecastHourSchema.parse({
        at: normalizeUtcIso(timeStr),
        temperatureC: Math.round(temp * 10) / 10,
        windGustKmh:
          gust !== null && gust !== undefined && Number.isFinite(gust)
            ? Math.max(0, Math.round(gust * 10) / 10)
            : 0,
        precipitationMm:
          precip !== null && precip !== undefined && Number.isFinite(precip)
            ? Math.max(0, Math.round(precip * 10) / 10)
            : 0,
        weatherCode:
          code !== null && code !== undefined && Number.isFinite(code)
            ? Math.max(0, Math.round(code))
            : 0,
        precipitationProbability:
          prob !== null && prob !== undefined && Number.isFinite(prob)
            ? Math.max(0, Math.min(100, Math.round(prob)))
            : null,
      }),
    );
  }

  const source: Source = {
    code: "open_meteo",
    url: "https://open-meteo.com",
    issuedAt: null,
    retrievedAt,
    isDemo: false,
  };

  return plotForecastSchema.parse({
    plotId: params.plotId,
    samplePoint: params.samplePoint,
    source,
    temperatureHeightM: 2,
    hours,
  });
}

/**
 * Consulta alertas del SMN (Servicio Meteorológico Nacional) para advertencias tempranas.
 */
type SmnAlertRaw = {
  date?: string;
  severity?: string;
  description?: string;
  zones?: Array<{ state?: string }>;
};

export async function fetchSmnAlerts(province = "córdoba"): Promise<
  Array<{
    date: string;
    severity: string;
    description: string;
  }>
> {
  const url = "https://ws.smn.gob.ar/alerts/type/AL";
  try {
    const response = await fetchWithRetry(url, 2, 5000);
    const data = (await response.json()) as unknown;
    if (!Array.isArray(data)) return [];

    const target = province.toLowerCase();
    const active = (data as SmnAlertRaw[]).filter((alert) =>
      alert.zones?.some((z) => z.state?.toLowerCase().includes(target)),
    );

    return active.map((a) => ({
      date: a.date || new Date().toISOString(),
      severity: a.severity || "Alerta",
      description: a.description || "",
    }));
  } catch (error) {
    console.warn("[WEATHER-PROVIDER] SMN alerts unavailable:", error);
    return [];
  }
}

/**
 * Construye el ForecastSummary consolidado de una lista de lotes de la granja.
 */
export function buildForecastSummary(plots: PlotForecast[]): ForecastSummary {
  const firstPlot = plots[0];
  if (!firstPlot) {
    throw new Error("ForecastSummary requires at least one plot forecast");
  }

  const firstHour = firstPlot.hours[0];
  const lastHour = firstPlot.hours[firstPlot.hours.length - 1];
  if (!firstHour || !lastHour) {
    throw new Error("Plot forecast must contain hours");
  }

  const windowStart = firstHour.at;
  const windowEnd = new Date(
    new Date(lastHour.at).getTime() + 3600 * 1000,
  ).toISOString();

  let latestRetrievedAt = firstPlot.source.retrievedAt;
  for (const p of plots) {
    if (p.source.retrievedAt > latestRetrievedAt) {
      latestRetrievedAt = p.source.retrievedAt;
    }
  }

  return forecastSummarySchema.parse({
    schemaVersion: 1,
    fetchedAt: latestRetrievedAt,
    windowStart,
    windowEnd,
    plots,
  });
}

/**
 * Detecta eventos de helada (<= 0°C a 2 m) según docs/domain-model.md.
 */
export function detectFrostEvents(
  plotForecast: PlotForecast,
): DetectedFrostEvent[] {
  return detectThreatEvents(plotForecast).filter((e) => e.kind === "frost");
}

/**
 * Motor de detección de amenazas agronómicas:
 * - frost: temperatura <= 0°C
 * - extreme_heat: temperatura >= 35°C
 * - severe_storm: ráfagas >= 60 km/h o precipitación horaria >= 25 mm
 * - hail: código WMO 96/99 (tormenta con granizo)
 */
export function detectThreatEvents(
  plotForecast: PlotForecast,
): DetectedThreatEvent[] {
  const daysMap = new Map<string, ForecastHour[]>();

  for (const hour of plotForecast.hours) {
    const dateStr = hour.at.slice(0, 10);
    const list = daysMap.get(dateStr) || [];
    list.push(hour);
    daysMap.set(dateStr, list);
  }

  const events: DetectedThreatEvent[] = [];
  const isDemo = plotForecast.source.isDemo;
  const sourceCode = plotForecast.source.code;

  for (const [dateStr, dayHours] of daysMap.entries()) {
    const frostHours = dayHours.filter((h) => h.temperatureC <= 0);
    const heatHours = dayHours.filter((h) => h.temperatureC >= 35);
    const stormHours = dayHours.filter(
      (h) => (h.windGustKmh ?? 0) >= 60 || (h.precipitationMm ?? 0) >= 25,
    );
    const hailHours = dayHours.filter(
      (h) => h.weatherCode === 96 || h.weatherCode === 99,
    );

    const createEvidence = (threshold?: number | null) =>
      eventEvidenceSchema.parse({
        schemaVersion: 1,
        scope: isDemo ? "farm_demo" : "plot_forecast",
        plotIds: [plotForecast.plotId],
        forecastDate: dateStr,
        samplePoint: isDemo ? null : plotForecast.samplePoint,
        source: plotForecast.source,
        temperatureHeightM: 2,
        detectionThresholdC: threshold ?? null,
        hours: dayHours.slice(0, 24),
      });

    // 1. Helada
    const firstFrost = frostHours[0];
    const lastFrost = frostHours[frostHours.length - 1];
    if (firstFrost && lastFrost) {
      events.push({
        sourceCode,
        sourceEventKey: isDemo
          ? `demo:frost:${dateStr}`
          : `open_meteo:frost:${plotForecast.plotId}:${dateStr}`,
        kind: "frost",
        title: `Alerta de Helada (${dateStr})`,
        startsAt: firstFrost.at,
        endsAt: new Date(
          new Date(lastFrost.at).getTime() + 3600 * 1000,
        ).toISOString(),
        retrievedAt: plotForecast.source.retrievedAt,
        sourceUrl: plotForecast.source.url,
        status: "active",
        evidence: createEvidence(0),
        isDemo,
      });
    }

    // 2. Ola de calor
    const firstHeat = heatHours[0];
    const lastHeat = heatHours[heatHours.length - 1];
    if (firstHeat && lastHeat) {
      events.push({
        sourceCode,
        sourceEventKey: isDemo
          ? `demo:extreme-heat:${dateStr}`
          : `open_meteo:extreme-heat:${plotForecast.plotId}:${dateStr}`,
        kind: "extreme-heat",
        title: `Ola de Calor / Estrés Térmico (${dateStr})`,
        startsAt: firstHeat.at,
        endsAt: new Date(
          new Date(lastHeat.at).getTime() + 3600 * 1000,
        ).toISOString(),
        retrievedAt: plotForecast.source.retrievedAt,
        sourceUrl: plotForecast.source.url,
        status: "active",
        evidence: createEvidence(35),
        isDemo,
      });
    }

    // 3. Tormenta severa
    const firstStorm = stormHours[0];
    const lastStorm = stormHours[stormHours.length - 1];
    if (firstStorm && lastStorm) {
      events.push({
        sourceCode,
        sourceEventKey: isDemo
          ? `demo:severe-storm:${dateStr}`
          : `open_meteo:severe-storm:${plotForecast.plotId}:${dateStr}`,
        kind: "severe-storm",
        title: `Tormenta Severa / Vientos Fuertes (${dateStr})`,
        startsAt: firstStorm.at,
        endsAt: new Date(
          new Date(lastStorm.at).getTime() + 3600 * 1000,
        ).toISOString(),
        retrievedAt: plotForecast.source.retrievedAt,
        sourceUrl: plotForecast.source.url,
        status: "active",
        evidence: createEvidence(null),
        isDemo,
      });
    }

    // 4. Granizo
    const firstHail = hailHours[0];
    const lastHail = hailHours[hailHours.length - 1];
    if (firstHail && lastHail) {
      events.push({
        sourceCode,
        sourceEventKey: isDemo
          ? `demo:hail:${dateStr}`
          : `open_meteo:hail:${plotForecast.plotId}:${dateStr}`,
        kind: "hail",
        title: `Riesgo de Granizo (${dateStr})`,
        startsAt: firstHail.at,
        endsAt: new Date(
          new Date(lastHail.at).getTime() + 3600 * 1000,
        ).toISOString(),
        retrievedAt: plotForecast.source.retrievedAt,
        sourceUrl: plotForecast.source.url,
        status: "active",
        evidence: createEvidence(null),
        isDemo,
      });
    }
  }

  return events;
}

/**
 * Obtiene el pronóstico completo y las amenazas detectadas para una coordenada o lote.
 */
export async function getPlotForecastWithFallback(params: {
  plotId: string;
  samplePoint: Point;
  forceDemo?: boolean;
}): Promise<{
  forecast: PlotForecast;
  events: DetectedThreatEvent[];
}> {
  if (params.forceDemo) {
    const forecast = generateDemoPlotForecast({
      plotId: params.plotId,
      samplePoint: params.samplePoint,
      includeFrost: true,
      includeHeatwave: true,
      includeSevereStorm: true,
      includeHail: true,
    });
    return { forecast, events: detectThreatEvents(forecast) };
  }

  try {
    const forecast = await fetchOpenMeteoPlotForecast({
      plotId: params.plotId,
      samplePoint: params.samplePoint,
    });
    const events = detectThreatEvents(forecast);
    return { forecast, events };
  } catch (error) {
    console.warn(
      "[WEATHER-PROVIDER] Live request failed, returning demo fallback:",
      error,
    );
    const forecast = generateDemoPlotForecast({
      plotId: params.plotId,
      samplePoint: params.samplePoint,
      includeFrost: true,
      includeHeatwave: true,
      includeSevereStorm: true,
      includeHail: true,
    });
    return { forecast, events: detectThreatEvents(forecast) };
  }
}
