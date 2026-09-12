import type { Farm } from "@agrosense/contracts";
import type { BoundaryFieldPrefix } from "./BoundaryFields";
import type { CoordinateBounds } from "./geometry";

export function boundaryValues(
  form: FormData,
  prefix: BoundaryFieldPrefix,
): CoordinateBounds {
  const value = (direction: "West" | "South" | "East" | "North") =>
    String(form.get(`${prefix}${direction}`) ?? "");
  return {
    west: value("West"),
    south: value("South"),
    east: value("East"),
    north: value("North"),
  };
}

export function farmExtent(farm: Farm) {
  const ring = farm.boundary.coordinates[0] ?? [];
  const longitudes = ring.map(([longitude]) => longitude);
  const latitudes = ring.map(([, latitude]) => latitude);
  return {
    west: Math.min(...longitudes),
    east: Math.max(...longitudes),
    south: Math.min(...latitudes),
    north: Math.max(...latitudes),
  };
}

export function todayInCordoba(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Argentina/Cordoba",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
