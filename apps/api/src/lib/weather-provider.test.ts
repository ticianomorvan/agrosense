import {
  eventEvidenceSchema,
  forecastSummarySchema,
  plotForecastSchema,
} from "@agrosense/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import app from "../index";
import {
  buildForecastSummary,
  detectFrostEvents,
  detectThreatEvents,
  fetchOpenMeteoPlotForecast,
  fetchSmnAlerts,
  generateDemoPlotForecast,
  getPlotForecastWithFallback,
} from "./weather-provider";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("weather-provider domain adapter", () => {
  const samplePlotId = "11111111-1111-4111-8111-111111111111";
  const samplePoint = {
    type: "Point" as const,
    coordinates: [-64.18, -31.42] as [number, number],
  };

  it("generates a valid 168-hour demo forecast with all required hourly fields", () => {
    const demo = generateDemoPlotForecast({
      plotId: samplePlotId,
      samplePoint,
      includeFrost: true,
      includeHeatwave: true,
      includeSevereStorm: true,
      includeHail: true,
    });

    expect(demo.hours.length).toBe(168);
    expect(demo.source.code).toBe("demo");
    expect(demo.source.isDemo).toBe(true);

    const firstHour = demo.hours[0];
    expect(firstHour).toBeDefined();
    if (firstHour) {
      expect(typeof firstHour.temperatureC).toBe("number");
      expect(typeof firstHour.windGustKmh).toBe("number");
      expect(typeof firstHour.precipitationMm).toBe("number");
      expect(typeof firstHour.weatherCode).toBe("number");
    }
    expect(() => plotForecastSchema.parse(demo)).not.toThrow();

    // Check multi-threat detection
    const threats = detectThreatEvents(demo);
    const kinds = threats.map((t) => t.kind);
    expect(kinds).toContain("frost");
    expect(kinds).toContain("extreme-heat");
    expect(kinds).toContain("severe-storm");
    expect(kinds).toContain("hail");

    for (const threat of threats) {
      expect(() => eventEvidenceSchema.parse(threat.evidence)).not.toThrow();
    }
  });

  it("fetches live Open-Meteo forecast and maps all requested hourly variables", async () => {
    const times: string[] = [];
    const temps: number[] = [];
    const gusts: number[] = [];
    const precips: number[] = [];
    const codes: number[] = [];
    const probs: number[] = [];

    for (let i = 0; i < 168; i++) {
      const d = new Date(Date.UTC(2026, 8, 12, i, 0, 0));
      times.push(d.toISOString().slice(0, 16));
      temps.push(i === 10 ? -1.5 : 22.0);
      gusts.push(i === 15 ? 72.0 : 15.0);
      precips.push(i === 20 ? 40.0 : 0.0);
      codes.push(i === 25 ? 99 : 1);
      probs.push(i === 25 ? 90 : 10);
    }

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("open-meteo.com")) {
          return new Response(
            JSON.stringify({
              hourly: {
                time: times,
                temperature_2m: temps,
                wind_gusts_10m: gusts,
                precipitation: precips,
                weather_code: codes,
                precipitation_probability: probs,
              },
            }),
            { status: 200 },
          );
        }
        return new Response("Not found", { status: 404 });
      }),
    );

    const forecast = await fetchOpenMeteoPlotForecast({
      plotId: samplePlotId,
      samplePoint,
    });

    expect(forecast.hours.length).toBe(168);
    expect(forecast.source.code).toBe("open_meteo");
    expect(forecast.source.isDemo).toBe(false);
    expect(() => plotForecastSchema.parse(forecast)).not.toThrow();

    const frostEvents = detectFrostEvents(forecast);
    expect(frostEvents.length).toBe(1);
    expect(frostEvents[0]?.sourceEventKey).toBe(
      `open_meteo:frost:${samplePlotId}:2026-09-12`,
    );

    const allThreats = detectThreatEvents(forecast);
    expect(allThreats.some((t) => t.kind === "frost")).toBe(true);
    expect(allThreats.some((t) => t.kind === "severe-storm")).toBe(true);
    expect(allThreats.some((t) => t.kind === "hail")).toBe(true);
  });

  it("fetches SMN alerts filtered by province", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify([
            {
              date: "2026-09-12T10:00:00Z",
              severity: "Amarilla",
              description: "Vientos intensos con ráfagas",
              zones: [{ state: "Córdoba" }],
            },
          ]),
          { status: 200 },
        );
      }),
    );

    const alerts = await fetchSmnAlerts("Córdoba");
    expect(alerts.length).toBe(1);
    expect(alerts[0]?.severity).toBe("Amarilla");
    expect(alerts[0]?.description).toContain("Vientos intensos");
  });

  it("builds a ForecastSummary covering all plots", () => {
    const p1 = generateDemoPlotForecast({
      plotId: samplePlotId,
      samplePoint,
    });
    const summary = buildForecastSummary([p1]);

    expect(summary.schemaVersion).toBe(1);
    expect(summary.plots.length).toBe(1);
    expect(() => forecastSummarySchema.parse(summary)).not.toThrow();
  });

  it("falls back to demo forecast if Open-Meteo request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("Provider timeout");
      }),
    );

    const result = await getPlotForecastWithFallback({
      plotId: samplePlotId,
      samplePoint,
    });

    expect(result.forecast.source.code).toBe("demo");
    expect(result.forecast.hours.length).toBe(168);
  });
});

describe("Weather / Forecast API endpoint", () => {
  it("responds with validated ForecastSummary and threats", async () => {
    const res = await app.request("/weather/-31.42/-64.18");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      summary: unknown;
      hours: Array<{
        temperatureC: number;
        windGustKmh: number | null;
        precipitationMm: number | null;
        weatherCode?: number;
        precipitationProbability?: number | null;
      }>;
      events: unknown[];
    };
    expect(() => forecastSummarySchema.parse(body.summary)).not.toThrow();
    expect(Array.isArray(body.events)).toBe(true);
    expect(Array.isArray(body.hours)).toBe(true);
    expect(body.hours.length).toBe(168);

    const firstHour = body.hours[0];
    expect(firstHour).toBeDefined();
    if (firstHour) {
      expect(typeof firstHour.temperatureC).toBe("number");
      expect(
        firstHour.windGustKmh === null ||
          typeof firstHour.windGustKmh === "number",
      ).toBe(true);
      expect(
        firstHour.precipitationMm === null ||
          typeof firstHour.precipitationMm === "number",
      ).toBe(true);
      expect(typeof firstHour.weatherCode).toBe("number");
    }
  });

  it("rejects invalid coordinate inputs with 400 BAD_REQUEST", async () => {
    const res = await app.request("/weather/invalid/coordinates");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: { code: "BAD_REQUEST", message: "Invalid coordinates" },
    });
  });
});
