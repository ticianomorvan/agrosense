import {
  polygonSchema,
  satelliteRequestSchema,
  uuidSchema,
} from "@agrosense/contracts";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ApiEnv } from "../env";
import { requireAuth } from "../lib/auth";
import { loadSatellitePreview } from "./provider";

export const satelliteRoutes = new Hono<ApiEnv>();
satelliteRoutes.post(
  "/api/farms/:farmId/satellite",
  requireAuth,
  bodyLimit({
    maxSize: 1024,
    onError: (c) => {
      c.header("Cache-Control", "private, no-store");
      return c.json(
        {
          error: {
            code: "PAYLOAD_LIMIT_EXCEEDED",
            message: "Satellite requests must not exceed 1024 bytes",
          },
        },
        413,
      );
    },
  }),
  async (c) => {
    c.header("Cache-Control", "private, no-store");
    const farmId = c.req.param("farmId");
    if (!uuidSchema.safeParse(farmId).success || new URL(c.req.url).search)
      return c.json(
        {
          error: {
            code: "BAD_REQUEST",
            message: "A valid farm ID without query parameters is required",
          },
        },
        400,
      );
    const input = satelliteRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!input.success || Date.parse(input.data.to) > Date.now())
      return c.json(
        {
          error: {
            code: "BAD_REQUEST",
            message: "Choose a past window of at most 31 days",
          },
        },
        400,
      );
    const { data, error } = await c
      .get("supabase")
      .from("farms")
      .select("boundary_geojson")
      .eq("id", farmId)
      .eq("owner_id", c.get("userId"))
      .maybeSingle();
    if (error)
      return c.json(
        {
          error: {
            code: "INTERNAL_ERROR",
            message: "The farm could not be loaded",
          },
        },
        500,
      );
    if (!data)
      return c.json(
        { error: { code: "NOT_FOUND", message: "Farm not found" } },
        404,
      );
    const boundary = polygonSchema.safeParse(data.boundary_geojson);
    if (!boundary.success)
      return c.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "The farm boundary is unavailable",
          },
        },
        422,
      );
    try {
      return c.json(
        await loadSatellitePreview(c.env, boundary.data, input.data),
      );
    } catch {
      return c.json(
        {
          error: {
            code: "SATELLITE_UNAVAILABLE",
            message:
              "Satellite imagery is temporarily unavailable. Try a smaller date window or retry later.",
          },
        },
        503,
      );
    }
  },
);
