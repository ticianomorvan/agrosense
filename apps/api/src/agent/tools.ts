import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { Database } from "../lib/database.types";
import { readSupabaseConfig, type SupabaseBindings } from "../lib/supabase";
import {
  FARM_TIMEZONE,
  getPlotForecast,
  InvalidForecastError,
} from "./forecast";
import { boundedFetch } from "./http";

export type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; error: { code: string; message: string } };
export type AgentTools = ReturnType<typeof createAgentTools>;
const schemas = {
  list_farms: z.strictObject({}),
  list_plots: z.strictObject({ farmId: z.uuid() }),
  get_forecast: z.strictObject({
    plotId: z.uuid(),
    days: z.number().int().min(1).max(7),
  }),
};
const descriptions = {
  list_farms:
    "List the farms available to this producer. Use to discover real farm IDs; never invent IDs.",
  list_plots:
    "List plots in an accessible farm. Use the farmId from list_farms.",
  get_forecast:
    "Read fresh daily weather for an accessible plot, using its stored location. days is 1–7 local calendar days INCLUDING today. Temperatures are Celsius at 2 m; precipitation is mm. Demo farms cannot use this live tool. This does not evaluate crop risk or update records.",
};
const farmSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(100),
  province: z.string().max(100),
  locality: z.string().max(100).nullable(),
  timezone: z.literal(FARM_TIMEZONE),
  data_mode: z.enum(["demo", "live"]),
});
const plotSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1).max(100),
  farm_id: z.uuid(),
  farms: z.object({ owner_id: z.uuid() }),
});
const locatedPlotSchema = plotSchema.extend({
  sample_point_geojson: z.object({
    type: z.literal("Point"),
    coordinates: z.tuple([
      z.number().min(-180).max(180),
      z.number().min(-90).max(90),
    ]),
  }),
  farms: z.object({
    owner_id: z.uuid(),
    data_mode: z.enum(["demo", "live"]),
    timezone: z.literal(FARM_TIMEZONE),
  }),
});
const failure = (code: string, message: string): ToolResult => ({
  ok: false,
  error: { code, message },
});

export function createAgentTools(options: {
  env: SupabaseBindings;
  ownerId: string;
  fetcher?: typeof fetch;
  now?: () => Date;
}) {
  const fetcher = options.fetcher ?? fetch;
  const now = options.now ?? (() => new Date());
  // Server-selected identity is captured here and is absent from all tool schemas.
  const ownerId = z.uuid().parse(options.ownerId);
  function client(signal: AbortSignal) {
    const config = readSupabaseConfig(options.env);
    const secret = options.env.SUPABASE_SECRET_KEY;
    if (!secret) throw new Error("Agent data access not configured");
    return createClient<Database>(config.url, secret, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
      global: {
        fetch: (input, init) =>
          boundedFetch(input, init ?? {}, {
            fetcher,
            signal,
            timeoutMs: 8000,
            maxBytes: 128 * 1024,
          }),
      },
    });
  }
  return {
    definitions: Object.entries(schemas).map(([name, schema]) => ({
      type: "function" as const,
      name,
      description: descriptions[name as keyof typeof schemas],
      parameters: z.toJSONSchema(schema),
      strict: true,
    })),
    async execute(
      name: string,
      argumentsJson: string,
      signal: AbortSignal,
    ): Promise<ToolResult> {
      if (!Object.hasOwn(schemas, name))
        return failure("UNKNOWN_TOOL", "This tool is not available");
      let args: unknown;
      try {
        args = JSON.parse(argumentsJson);
      } catch {
        return failure("INVALID_ARGUMENTS", "Tool arguments must be JSON");
      }
      if (!schemas[name as keyof typeof schemas].safeParse(args).success)
        return failure(
          "INVALID_ARGUMENTS",
          "Arguments do not match the tool schema",
        );
      try {
        signal.throwIfAborted();
        const db = client(signal);
        if (name === "list_farms") {
          const { data, error } = await db
            .from("farms")
            .select("id,name,province,locality,timezone,data_mode")
            .eq("owner_id", ownerId)
            .order("name")
            .limit(11);
          if (error) throw error;
          const farms = z
            .array(farmSchema)
            .max(10)
            .parse(data)
            .map(({ data_mode, ...farm }) => ({
              ...farm,
              dataMode: data_mode,
            }));
          return { ok: true, data: { farms } };
        }
        if (name === "list_plots") {
          const { farmId } = schemas.list_plots.parse(args);
          const { data, error } = await db
            .from("plots")
            .select("id,name,farm_id,farms!inner(owner_id)")
            .eq("farm_id", farmId)
            .eq("farms.owner_id", ownerId)
            .order("name")
            .limit(11);
          if (error) throw error;
          const rows = z.array(plotSchema).max(10).parse(data);
          if (
            rows.some(
              (plot) =>
                plot.farms.owner_id !== ownerId || plot.farm_id !== farmId,
            )
          )
            throw new Error("Unexpected ownership");
          return {
            ok: true,
            data: {
              plots: rows.map((plot) => ({
                id: plot.id,
                name: plot.name,
                farmId: plot.farm_id,
              })),
            },
          };
        }
        const { plotId, days } = schemas.get_forecast.parse(args);
        const { data, error } = await db
          .from("plots")
          .select(
            "id,name,farm_id,sample_point_geojson,farms!inner(owner_id,data_mode,timezone)",
          )
          .eq("id", plotId)
          .eq("farms.owner_id", ownerId)
          .limit(1);
        if (error) throw error;
        const plot = z.array(locatedPlotSchema).max(1).parse(data)[0];
        if (!plot)
          return failure(
            "NOT_FOUND",
            "This plot is not available to the current producer",
          );
        if (plot.farms.owner_id !== ownerId || plot.id !== plotId)
          throw new Error("Unexpected ownership");
        if (plot.farms.data_mode === "demo")
          return failure(
            "LIVE_FORECAST_UNAVAILABLE",
            "This farm uses demo data. A live forecast is unavailable; do not invent one.",
          );
        return {
          ok: true,
          data: await getPlotForecast({
            plotId,
            plotName: plot.name,
            coordinates: plot.sample_point_geojson.coordinates,
            days,
            signal,
            fetcher,
            now,
          }),
        };
      } catch (error) {
        if (error instanceof InvalidForecastError)
          return failure(
            "INVALID_PROVIDER_DATA",
            "The forecast was incomplete or invalid; no forecast values are available",
          );
        return failure(
          "TOOL_UNAVAILABLE",
          "The data could not be retrieved. Do not infer missing values.",
        );
      }
    },
  };
}
