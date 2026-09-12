import {
  polygonSchema,
  satelliteRequestSchema,
  uuidSchema,
} from "@agrosense/contracts";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { ApiEnv } from "../env";
import { requireAuth } from "../lib/auth";
import { jsonError } from "../lib/http";
import { loadSatellitePreview } from "./provider";

export const satelliteRoutes = new Hono<ApiEnv>();
satelliteRoutes.post(
  "/api/farms/:farmId/satellite",
  requireAuth,
  bodyLimit({
    maxSize: 1024,
    onError: (c) => {
      c.header("Cache-Control", "private, no-store");
      return jsonError(
        c,
        413,
        "PAYLOAD_LIMIT_EXCEEDED",
        "Satellite requests must not exceed 1024 bytes",
      );
    },
  }),
  async (c) => {
    c.header("Cache-Control", "private, no-store");
    const farmId = c.req.param("farmId");
    if (!uuidSchema.safeParse(farmId).success || new URL(c.req.url).search)
      return jsonError(
        c,
        400,
        "BAD_REQUEST",
        "A valid farm ID without query parameters is required",
      );
    const input = satelliteRequestSchema.safeParse(
      await c.req.json().catch(() => null),
    );
    if (!input.success || Date.parse(input.data.to) > Date.now())
      return jsonError(
        c,
        400,
        "BAD_REQUEST",
        "Choose a past window of at most 31 days",
      );
    const { data, error } = await c
      .get("supabase")
      .from("farms")
      .select("boundary_geojson")
      .eq("id", farmId)
      .eq("owner_id", c.get("userId"))
      .maybeSingle();
    if (error)
      return jsonError(
        c,
        500,
        "INTERNAL_ERROR",
        "The farm could not be loaded",
      );
    if (!data) return jsonError(c, 404, "NOT_FOUND", "Farm not found");
    const boundary = polygonSchema.safeParse(data.boundary_geojson);
    if (!boundary.success)
      return jsonError(
        c,
        422,
        "VALIDATION_ERROR",
        "The farm boundary is unavailable",
      );
    try {
      return c.json(
        await loadSatellitePreview(c.env, boundary.data, input.data),
      );
    } catch {
      return jsonError(
        c,
        503,
        "SATELLITE_UNAVAILABLE",
        "Satellite imagery is temporarily unavailable. Try a smaller date window or retry later.",
      );
    }
  },
);
