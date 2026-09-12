import {
  type AuthConfigResponse,
  authConfigResponseSchema,
} from "@agrosense/contracts/auth";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getJson } from "../../lib/api";

export type AuthClient = SupabaseClient;
let clientPromise: Promise<AuthClient> | undefined;

export function getAuthClient(): Promise<AuthClient> {
  clientPromise ??= loadAuthConfig().then((config) =>
    // Supabase v2 exposes these browser-session controls on createClient.
    // https://supabase.com/docs/reference/javascript/initializing
    createClient(config.url, config.publishableKey, {
      auth: {
        autoRefreshToken: true,
        persistSession: false,
        detectSessionInUrl: false,
      },
    }),
  );
  return clientPromise;
}

async function loadAuthConfig(): Promise<AuthConfigResponse> {
  return getJson("/api/auth/config", authConfigResponseSchema);
}
