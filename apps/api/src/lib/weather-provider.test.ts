import {
  type ForecastHour,
  type PlotForecast,
  plotForecastSchema,
} from "@agrosense/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  detectThreatEvents,
  fetchOpenMeteoPlotForecast,
} from "./weather-provider";

const params = {
  plotId: "11111111-1111-4111-8111-111111111111",
  samplePoint: {
    type: "Point" as const,
    coordinates: [-64.18, -31.42] as [number, number],
  },
};
const retrievedAt = "2026-09-12T00:00:00.000Z";

function forecast(
  overrides: Partial<ForecastHour>[],
  start = Date.parse(retrievedAt),
): PlotForecast {
  return {
    ...params,
    source: {
      code: "open_meteo",
      url: "https://open-meteo.com",
      issuedAt: null,
      retrievedAt,
      isDemo: false,
    },
    temperatureHeightM: 2,
    hours: overrides.map((hour, index) => ({
      at: new Date(start + index * 3_600_000).toISOString(),
      temperatureC: 10,
      windGustKmh: null,
      precipitationMm: null,
      precipitationProbability: null,
      weatherCode: 1,
      ...hour,
    })),
  };
}

function providerHours(count = 3) {
  return {
    time: Array.from({ length: count }, (_, i) =>
      new Date(Date.parse(retrievedAt) + i * 3_600_000)
        .toISOString()
        .slice(0, 16),
    ),
    temperature_2m: Array<number | null>(count).fill(22),
    wind_gusts_10m: Array<number | null>(count).fill(15),
    precipitation: Array<number | null>(count).fill(0),
    weather_code: Array<number | null>(count).fill(1),
    precipitation_probability: Array<number | null>(count).fill(10),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("Open-Meteo adapter", () => {
  it("requests 168 hourly samples in UTC and preserves measured values", async () => {
    const hourly = providerHours(168);
    hourly.temperature_2m[0] = 0.04;
    hourly.wind_gusts_10m[0] = 59.99;
    hourly.precipitation[0] = 24.99;
    hourly.weather_code[0] = 99;
    const fetch = vi.fn(async (_url: string | URL | Request) =>
      Response.json({ hourly }),
    );
    vi.stubGlobal("fetch", fetch);
    const result = await fetchOpenMeteoPlotForecast(params);
    const query = new URL(String(fetch.mock.calls[0]?.[0])).searchParams;
    expect(query.get("latitude")).toBe("-31.42");
    expect(query.get("longitude")).toBe("-64.18");
    expect(query.get("forecast_days")).toBe("7");
    expect(query.get("timezone")).toBe("UTC");
    expect(query.get("hourly")?.split(",").sort()).toEqual([
      "precipitation",
      "precipitation_probability",
      "temperature_2m",
      "weather_code",
      "wind_gusts_10m",
    ]);
    expect(result.hours).toHaveLength(168);
    expect(result.hours[0]).toEqual({
      at: retrievedAt,
      temperatureC: 0.04,
      windGustKmh: 59.99,
      precipitationMm: 24.99,
      weatherCode: 99,
      precipitationProbability: 10,
    });
    expect(result.source).toMatchObject({
      code: "open_meteo",
      isDemo: false,
      issuedAt: null,
    });
  });

  it("accepts a shorter complete window and retains missing measurements as null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          hourly: {
            time: ["2026-09-12T00:00", "2026-09-12T01:00"],
            temperature_2m: [10, 11],
            wind_gusts_10m: [null, null],
          },
        }),
      ),
    );
    const result = await fetchOpenMeteoPlotForecast(params);
    expect(result.hours).toHaveLength(2);
    expect(result.hours[0]).toMatchObject({
      windGustKmh: null,
      precipitationMm: null,
      weatherCode: null,
      precipitationProbability: null,
    });
  });

  it.each([
    ["missing temperature", { temperature_2m: [null, 22, 22] }],
    ["mismatched arrays", { wind_gusts_10m: [15, 15] }],
    [
      "gap",
      { time: ["2026-09-12T00:00", "2026-09-12T02:00", "2026-09-12T03:00"] },
    ],
    [
      "duplicate",
      { time: ["2026-09-12T00:00", "2026-09-12T00:00", "2026-09-12T01:00"] },
    ],
    [
      "unaligned hour",
      { time: ["2026-09-12T00:30", "2026-09-12T01:30", "2026-09-12T02:30"] },
    ],
    [
      "invalid date",
      { time: ["2026-02-30T00:00", "2026-02-30T01:00", "2026-02-30T02:00"] },
    ],
    ["negative rain", { precipitation: [-1, 0, 0] }],
    ["invalid probability", { precipitation_probability: [101, 10, 10] }],
  ] satisfies [string, Partial<ReturnType<typeof providerHours>>][])(
    "rejects %s without manufacturing replacement data",
    async (_name, invalid) => {
      const hourly = { ...providerHours(), ...invalid };
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ hourly })),
      );
      await expect(fetchOpenMeteoPlotForecast(params)).rejects.toThrow();
    },
  );

  it.each([0, 169])(
    "rejects a %i-hour window without truncation",
    async (count) => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => Response.json({ hourly: providerHours(count) })),
      );
      await expect(fetchOpenMeteoPlotForecast(params)).rejects.toThrow();
    },
  );

  it("validates sampling coordinates before contacting the provider", async () => {
    const fetch = vi.fn(async () => Response.json({ hourly: providerHours() }));
    vi.stubGlobal("fetch", fetch);
    await expect(
      fetchOpenMeteoPlotForecast({
        ...params,
        samplePoint: { type: "Point", coordinates: [181, 91] },
      }),
    ).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("propagates HTTP failures without retrying or generating demo data", async () => {
    const fetch = vi.fn(async () => new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetch);
    await expect(fetchOpenMeteoPlotForecast(params)).rejects.toThrow("503");
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("aborts a stalled body at the eight-second deadline", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (_url, init) =>
          new Response(
            new ReadableStream({
              start(controller) {
                init.signal.addEventListener(
                  "abort",
                  () => controller.error(init.signal.reason),
                  { once: true },
                );
              },
            }),
          ),
      ),
    );
    const result = expect(fetchOpenMeteoPlotForecast(params)).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(8000);
    await result;
  });
});

describe("threat detection", () => {
  it.each([
    [{ temperatureC: 0 }, ["frost"]],
    [{ temperatureC: 0.01 }, []],
    [{ temperatureC: 35 }, ["extreme-heat"]],
    [{ temperatureC: 34.99 }, []],
    [{ windGustKmh: 60 }, ["severe-storm"]],
    [{ windGustKmh: 59.99 }, []],
    [{ precipitationMm: 25 }, ["severe-storm"]],
    [{ precipitationMm: 24.99 }, []],
    [{ weatherCode: 96 }, ["hail"]],
    [{ weatherCode: 99 }, ["hail"]],
    [{ weatherCode: 95 }, []],
  ] satisfies [Partial<ForecastHour>, string[]][])(
    "classifies %j at the exact threshold",
    (hour, kinds) => {
      expect(
        detectThreatEvents(forecast([hour])).map((event) => event.kind),
      ).toEqual(kinds);
    },
  );

  it("keeps day evidence, bounds nonconsecutive hazards, and preserves identity on revision", () => {
    const plot = forecast([
      { temperatureC: 0 },
      {},
      { temperatureC: -2 },
      { temperatureC: 35 },
      { windGustKmh: 60, weatherCode: 99 },
    ]);
    const events = detectThreatEvents(plot);
    expect(events.map((event) => event.kind)).toEqual([
      "frost",
      "extreme-heat",
      "severe-storm",
      "hail",
    ]);
    expect(events[0]).toMatchObject({
      sourceEventKey: `open_meteo:frost:${params.plotId}:2026-09-12`,
      startsAt: retrievedAt,
      endsAt: "2026-09-12T03:00:00.000Z",
      evidence: {
        hours: plot.hours,
        plotIds: [params.plotId],
        samplePoint: params.samplePoint,
        detectionThresholdC: 0,
      },
    });
    const revised = detectThreatEvents(
      forecast([{}, { temperatureC: -1 }, {}]),
    );
    expect(revised[0]?.sourceEventKey).toBe(events[0]?.sourceEventKey);
    expect(revised[0]?.startsAt).not.toBe(events[0]?.startsAt);
  });

  it("splits at UTC midnight and retains the demo source scope", () => {
    const plot = forecast(
      [{ temperatureC: -1 }, { temperatureC: -1 }],
      Date.parse("2026-09-12T23:00:00Z"),
    );
    plot.source = { ...plot.source, code: "demo", isDemo: true, url: null };
    const events = detectThreatEvents(plot);
    expect(events.map((event) => event.sourceEventKey)).toEqual([
      "demo:frost:2026-09-12",
      "demo:frost:2026-09-13",
    ]);
    expect(events[0]?.endsAt).toBe("2026-09-13T00:00:00.000Z");
    expect(events[1]?.endsAt).toBe("2026-09-13T01:00:00.000Z");
    for (const event of events)
      expect(event.evidence).toMatchObject({
        scope: "farm_demo",
        samplePoint: null,
        hours: [expect.any(Object)],
      });
  });

  it("rejects inconsistent sources and unknown normalized fields", () => {
    const plot = forecast([{}]);
    expect(
      plotForecastSchema.safeParse({
        ...plot,
        source: { ...plot.source, isDemo: true },
      }).success,
    ).toBe(false);
    expect(plotForecastSchema.safeParse({ ...plot, extra: true }).success).toBe(
      false,
    );
  });
});
