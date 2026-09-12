import type { Json } from "./database.types";

export const json = <T>(value: Json): T => value as T;

/** Canonical UTC at PostgreSQL's microsecond precision, including change tokens. */
export function iso(value: string): string {
  const fraction = /\.(\d+)(?:Z|[+-]\d{2}:\d{2})$/i.exec(value)?.[1] ?? "";
  if (fraction.length > 6)
    throw new RangeError("Unsupported timestamp precision");
  const seconds = new Date(value).toISOString().slice(0, 19);
  return `${seconds}.${fraction.padEnd(6, "0")}Z`;
}
