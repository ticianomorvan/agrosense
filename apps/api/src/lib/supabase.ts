import { createClient } from "@supabase/supabase-js";
import { createRemoteJWKSet, customFetch, errors, jwtVerify } from "jose";
import type { Database } from "./database.types";

export type SupabaseBindings = {
  SUPABASE_URL?: string;
  SUPABASE_PUBLISHABLE_KEY?: string;
  SUPABASE_JWKS_URL?: string;
  SUPABASE_SECRET_KEY?: string;
};

type SupabaseConfig = { url: string; publishableKey: string; jwksUrl: string };

export function readSupabaseConfig(env: SupabaseBindings): SupabaseConfig {
  if (
    !env.SUPABASE_URL ||
    !env.SUPABASE_PUBLISHABLE_KEY ||
    !env.SUPABASE_JWKS_URL
  ) {
    throw new Error("Supabase configuration is incomplete");
  }
  const url = new URL(env.SUPABASE_URL);
  const local =
    url.protocol === "http:" &&
    ["localhost", "127.0.0.1"].includes(url.hostname);
  if (
    (!local && url.protocol !== "https:") ||
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/"
  ) {
    throw new Error(
      "Supabase URL must be an HTTPS origin or local development origin",
    );
  }
  const jwksUrl = `${url.origin}/auth/v1/.well-known/jwks.json`;
  if (env.SUPABASE_JWKS_URL !== jwksUrl)
    throw new Error("Supabase JWKS URL does not match the Auth issuer");
  return {
    url: url.origin,
    publishableKey: env.SUPABASE_PUBLISHABLE_KEY,
    jwksUrl,
  };
}

export function createTokenVerifier(
  config: SupabaseConfig,
  fetcher: typeof fetch = fetch,
) {
  const jwks = createRemoteJWKSet(new URL(config.jwksUrl), {
    [customFetch]: fetcher,
    timeoutDuration: 5000,
  });
  return async (token: string) => {
    const { payload } = await jwtVerify(token, jwks, {
      issuer: `${config.url}/auth/v1`,
      audience: "authenticated",
      algorithms: ["ES256", "RS256"],
      requiredClaims: ["sub", "exp", "role"],
    });
    if (
      payload.role !== "authenticated" ||
      typeof payload.sub !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        payload.sub,
      )
    ) {
      throw new errors.JWTClaimValidationFailed(
        "Invalid user identity",
        payload,
        "sub",
        "invalid",
      );
    }
    return { userId: payload.sub };
  };
}

/** Use only after bearer verification. The user's JWT keeps RLS active. */
export function createUserClient(
  config: SupabaseConfig,
  accessToken: string,
  fetcher: typeof fetch = fetch,
) {
  return createClient<Database>(config.url, config.publishableKey, {
    accessToken: async () => accessToken,
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: fetcher },
  });
}

export function createServiceClient(
  env: SupabaseBindings,
  fetcher: typeof fetch = fetch,
) {
  const config = readSupabaseConfig(env);
  if (!env.SUPABASE_SECRET_KEY)
    throw new Error("Supabase secret key is required for service operations");
  return createClient<Database>(config.url, env.SUPABASE_SECRET_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: fetcher },
  });
}
