const instantFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: "America/Argentina/Cordoba",
  dateStyle: "medium",
  timeStyle: "short",
});

export function formatInstant(value: string | null) {
  return value ? instantFormatter.format(new Date(value)) : "Unavailable";
}
