import { readFile } from "node:fs/promises";

// Service administration only. The contact file records independently obtained
// ownership/phone verification and WhatsApp opt-in; this is not a signup endpoint.
const [contactFile] = process.argv.slice(2);
if (!contactFile || process.argv.length !== 3) {
  throw new Error(
    "Usage: node --env-file=apps/api/.env scripts/configure-notification-contact.mjs <contact.json>",
  );
}
const contact = JSON.parse(await readFile(contactFile, "utf8"));
if (
  Object.keys(contact).sort().join(",") !==
    "consentedAt,enabled,ownerId,phoneNumber" ||
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
    contact.ownerId,
  ) ||
  !/^[1-9]\d{6,14}$/.test(contact.phoneNumber) ||
  typeof contact.enabled !== "boolean" ||
  !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/.test(
    contact.consentedAt,
  ) ||
  !Number.isFinite(Date.parse(contact.consentedAt)) ||
  Date.parse(contact.consentedAt) > Date.now()
) {
  throw new Error(
    "Contact must contain a valid ownerId, international phoneNumber, past consentedAt UTC instant, and enabled boolean",
  );
}
const url = new URL(process.env.SUPABASE_URL ?? "");
if (
  (url.protocol !== "https:" &&
    !(
      url.protocol === "http:" &&
      ["127.0.0.1", "localhost"].includes(url.hostname)
    )) ||
  url.username ||
  url.password ||
  url.pathname !== "/" ||
  url.search ||
  url.hash ||
  !process.env.SUPABASE_SECRET_KEY
)
  throw new Error("Server Supabase configuration is required");
const response = await fetch(
  `${url.origin}/rest/v1/rpc/configure_notification_contact`,
  {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(8000),
    headers: {
      apikey: process.env.SUPABASE_SECRET_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      p_owner_id: contact.ownerId,
      p_phone_number: contact.phoneNumber,
      p_consented_at: contact.consentedAt,
      p_enabled: contact.enabled,
    }),
  },
);
if (!response.ok || (await response.json()) !== true)
  throw new Error(`Contact configuration failed (HTTP ${response.status})`);
console.log(
  contact.enabled
    ? "Owner notification contact configured."
    : "Owner notifications disabled.",
);
