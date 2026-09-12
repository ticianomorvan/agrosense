import { z } from "zod";

export const instantSchema = z.iso.datetime({ offset: false });

// Compare validated UTC instants without dropping PostgreSQL fractional precision.
export function compareInstants(left: string, right: string) {
  const [leftSecond = "", leftFraction = ""] = left.slice(0, -1).split(".");
  const [rightSecond = "", rightFraction = ""] = right.slice(0, -1).split(".");
  const precision = Math.max(leftFraction.length, rightFraction.length);
  const a = `${leftSecond}.${leftFraction.padEnd(precision, "0")}`;
  const b = `${rightSecond}.${rightFraction.padEnd(precision, "0")}`;
  return a === b ? 0 : a < b ? -1 : 1;
}

// Browser clocks have millisecond precision; never expire a sub-ms deadline early.
export function deadlineMilliseconds(instant: string) {
  const submillisecond = /\.\d{3}(\d+)Z$/.exec(instant)?.[1] ?? "";
  return Date.parse(instant) + (/[1-9]/.test(submillisecond) ? 1 : 0);
}
