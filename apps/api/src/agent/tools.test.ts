import { describe, expect, it, vi } from "vitest";
import { createAgentTools } from "./tools";

const ownerId = "11111111-1111-4111-8111-111111111111";
const farmId = "22222222-2222-4222-8222-222222222222";
const plotId = "33333333-3333-4333-8333-333333333333";
const env = {
  SUPABASE_URL: "https://tools.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "public_test",
  SUPABASE_JWKS_URL: "https://tools.supabase.co/auth/v1/.well-known/jwks.json",
  SUPABASE_SECRET_KEY: "secret_test",
};
const now = () => new Date("2026-09-12T12:00:00Z");
const forecast = {
  timezone: "America/Argentina/Cordoba",
  daily_units: {
    time: "iso8601",
    temperature_2m_min: "°C",
    temperature_2m_max: "°C",
    precipitation_sum: "mm",
  },
  daily: {
    time: ["2026-09-12", "2026-09-13", "2026-09-14"],
    temperature_2m_min: [3, 2, 4],
    temperature_2m_max: [18, 19, 21],
    precipitation_sum: [0, 3, 0.5],
  },
};
const plot = {
  id: plotId,
  name: "North",
  farm_id: farmId,
  sample_point_geojson: { type: "Point", coordinates: [-64.2, -31.4] },
  farms: {
    owner_id: ownerId,
    data_mode: "live",
    timezone: "America/Argentina/Cordoba",
  },
};

function setup(data: unknown = [plot], weather: unknown = forecast) {
  const fetcher = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(String(input));
    if (url.origin === env.SUPABASE_URL) {
      expect(new Headers(init?.headers).get("apikey")).toBe(
        env.SUPABASE_SECRET_KEY,
      );
      return Response.json(data);
    }
    expect(url.origin).toBe("https://api.open-meteo.com");
    expect(url.pathname).toBe("/v1/forecast");
    return Response.json(weather);
  });
  return { fetcher, tools: createAgentTools({ env, ownerId, fetcher, now }) };
}
const signal = () => new AbortController().signal;

describe("agent tools", () => {
  it("lists only the configured owner's farms and omits credentials/ownership", async () => {
    const { tools, fetcher } = setup([
      {
        id: farmId,
        name: "Farm",
        province: "Córdoba",
        locality: null,
        timezone: "America/Argentina/Cordoba",
        data_mode: "live",
      },
    ]);
    const result = await tools.execute("list_farms", "{}", signal());
    expect(result).toEqual({
      ok: true,
      data: {
        farms: [
          {
            id: farmId,
            name: "Farm",
            province: "Córdoba",
            locality: null,
            timezone: "America/Argentina/Cordoba",
            dataMode: "live",
          },
        ],
      },
    });
    const url = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(url.searchParams.get("owner_id")).toBe(`eq.${ownerId}`);
    expect(url.searchParams.get("limit")).toBe("11");
    expect(JSON.stringify(result)).not.toContain(env.SUPABASE_SECRET_KEY);
  });

  it("scopes plot discovery by farm and owner in the same database query", async () => {
    const { tools, fetcher } = setup([
      {
        id: plotId,
        name: "North",
        farm_id: farmId,
        farms: { owner_id: ownerId },
      },
    ]);
    const result = await tools.execute(
      "list_plots",
      JSON.stringify({ farmId }),
      signal(),
    );
    expect(result).toEqual({
      ok: true,
      data: { plots: [{ id: plotId, name: "North", farmId }] },
    });
    const url = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(url.searchParams.get("farm_id")).toBe(`eq.${farmId}`);
    expect(url.searchParams.get("farms.owner_id")).toBe(`eq.${ownerId}`);
    expect(url.searchParams.get("select")).toContain("farms!inner");
  });

  it("gets three days for the stored plot point with explicit dates, units and source", async () => {
    const { tools, fetcher } = setup();
    const result = await tools.execute(
      "get_forecast",
      JSON.stringify({ plotId, days: 3 }),
      signal(),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("Expected forecast");
    expect(result.data).toMatchObject({
      plotId,
      plotName: "North",
      timezone: "America/Argentina/Cordoba",
      fetchedAt: now().toISOString(),
      temperatureHeightM: 2,
      source: {
        code: "open_meteo",
        url: "https://open-meteo.com/",
        issuedAt: null,
        isDemo: false,
      },
      days: [
        {
          date: "2026-09-12",
          minTemperatureC: 3,
          maxTemperatureC: 18,
          precipitationMm: 0,
        },
        {
          date: "2026-09-13",
          minTemperatureC: 2,
          maxTemperatureC: 19,
          precipitationMm: 3,
        },
        {
          date: "2026-09-14",
          minTemperatureC: 4,
          maxTemperatureC: 21,
          precipitationMm: 0.5,
        },
      ],
    });
    const dataUrl = new URL(String(fetcher.mock.calls[0]?.[0]));
    expect(dataUrl.searchParams.get("id")).toBe(`eq.${plotId}`);
    expect(dataUrl.searchParams.get("farms.owner_id")).toBe(`eq.${ownerId}`);
    const url = new URL(String(fetcher.mock.calls[1]?.[0]));
    expect(url.searchParams.get("latitude")).toBe("-31.4");
    expect(url.searchParams.get("longitude")).toBe("-64.2");
    expect(url.searchParams.get("forecast_days")).toBe("3");
    expect(url.searchParams.get("timezone")).toBe("America/Argentina/Cordoba");
  });

  it("does not call a weather provider for an inaccessible or absent plot", async () => {
    const { tools, fetcher } = setup([]);
    expect(
      await tools.execute(
        "get_forecast",
        JSON.stringify({ plotId, days: 3 }),
        signal(),
      ),
    ).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("fails closed even if a database response contains another owner's plot", async () => {
    const { tools, fetcher } = setup([
      { ...plot, farms: { ...plot.farms, owner_id: farmId } },
    ]);
    expect(
      await tools.execute(
        "get_forecast",
        JSON.stringify({ plotId, days: 3 }),
        signal(),
      ),
    ).toMatchObject({ ok: false });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not mix live forecasts into demo farms", async () => {
    const { tools, fetcher } = setup([
      { ...plot, farms: { ...plot.farms, data_mode: "demo" } },
    ]);
    expect(
      await tools.execute(
        "get_forecast",
        JSON.stringify({ plotId, days: 3 }),
        signal(),
      ),
    ).toMatchObject({
      ok: false,
      error: { code: "LIVE_FORECAST_UNAVAILABLE" },
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["arbitrary_sql", "{}", "UNKNOWN_TOOL"],
    ["get_forecast", "not-json", "INVALID_ARGUMENTS"],
    ["get_forecast", JSON.stringify({ plotId, days: 8 }), "INVALID_ARGUMENTS"],
    ["get_forecast", JSON.stringify({ plotId, days: 0 }), "INVALID_ARGUMENTS"],
    [
      "get_forecast",
      JSON.stringify({ plotId, days: 3, ownerId: farmId }),
      "INVALID_ARGUMENTS",
    ],
    ["list_farms", JSON.stringify({ ownerId: farmId }), "INVALID_ARGUMENTS"],
  ])(
    "rejects unauthorized tool or arguments (%s, case %#)",
    async (name, args, code) => {
      const { tools, fetcher } = setup();
      expect(await tools.execute(name, args, signal())).toMatchObject({
        ok: false,
        error: { code },
      });
      expect(fetcher).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      ...forecast,
      daily: { ...forecast.daily, temperature_2m_min: [null, 2, 4] },
    },
    {
      ...forecast,
      daily: {
        ...forecast.daily,
        time: ["2026-09-12", "2026-09-14", "2026-09-13"],
      },
    },
    { ...forecast, daily: { ...forecast.daily, temperature_2m_max: [18] } },
    {
      ...forecast,
      daily: { ...forecast.daily, temperature_2m_min: [25, 2, 4] },
    },
    {
      ...forecast,
      daily_units: { ...forecast.daily_units, temperature_2m_min: "°F" },
    },
  ])(
    "rejects incomplete, out-of-order or incompatible forecast data (case %#)",
    async (weather) => {
      const { tools } = setup([plot], weather);
      expect(
        await tools.execute(
          "get_forecast",
          JSON.stringify({ plotId, days: 3 }),
          signal(),
        ),
      ).toMatchObject({ ok: false, error: { code: "INVALID_PROVIDER_DATA" } });
    },
  );

  it("returns safe unavailability without leaking upstream errors", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json({ message: "private database details" }, { status: 500 }),
    );
    const tools = createAgentTools({ env, ownerId, fetcher, now });
    const result = await tools.execute("list_farms", "{}", signal());
    expect(result).toMatchObject({
      ok: false,
      error: { code: "TOOL_UNAVAILABLE" },
    });
    expect(JSON.stringify(result)).not.toContain("private database details");
  });
});
