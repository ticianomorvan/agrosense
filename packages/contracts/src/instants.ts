function submillisecondDigits(instant: string): string {
  return (/\.(\d+)Z$/.exec(instant)?.[1] ?? "").slice(3);
}

/** Compare UTC instants without discarding PostgreSQL fractional precision. */
export function compareInstants(left: string, right: string): number {
  const milliseconds = Date.parse(left) - Date.parse(right);
  if (milliseconds !== 0) return milliseconds;
  const leftDigits = submillisecondDigits(left);
  const rightDigits = submillisecondDigits(right);
  const width = Math.max(leftDigits.length, rightDigits.length);
  const leftFraction = leftDigits.padEnd(width, "0");
  const rightFraction = rightDigits.padEnd(width, "0");
  return leftFraction < rightFraction
    ? -1
    : leftFraction > rightFraction
      ? 1
      : 0;
}

/** Add whole minutes while retaining digits below JavaScript's millisecond precision. */
export function addMinutes(instant: string, minutes: number): string {
  const shifted = new Date(
    Date.parse(instant) + minutes * 60_000,
  ).toISOString();
  return `${shifted.slice(0, -1)}${submillisecondDigits(instant)}Z`;
}
