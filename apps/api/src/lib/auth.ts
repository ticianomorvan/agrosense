import { createMiddleware } from "hono/factory";
import { errors } from "jose";
import type { AgentBindings } from "../agent/config";
import {
  createTokenVerifier,
  createUserClient,
  readSupabaseConfig,
} from "./supabase";

export type ApiEnv = {
  Bindings: AgentBindings;
  Variables: { userId: string; supabase: ReturnType<typeof createUserClient> };
};

// Reuse public JWKS within a Worker isolate; user clients remain request-scoped.
let cachedVerifier:
  | { url: string; verify: ReturnType<typeof createTokenVerifier> }
  | undefined;

export const requireAuth = createMiddleware<ApiEnv>(async (c, next) => {
  c.header("Cache-Control", "no-store");
  const token = /^Bearer ([^\s]+)$/i.exec(
    c.req.header("Authorization") ?? "",
  )?.[1];
  const unauthorized = () => {
    c.header("WWW-Authenticate", "Bearer");
    return c.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "A valid access token is required",
        },
      },
      401,
    );
  };
  if (!token) return unauthorized();
  try {
    const config = readSupabaseConfig(c.env);
    if (cachedVerifier?.url !== config.url)
      cachedVerifier = { url: config.url, verify: createTokenVerifier(config) };
    const { userId } = await cachedVerifier.verify(token);
    c.set("userId", userId);
    c.set("supabase", createUserClient(config, token));
  } catch (error) {
    if (
      error instanceof errors.JWTInvalid ||
      error instanceof errors.JWTExpired ||
      error instanceof errors.JWTClaimValidationFailed ||
      error instanceof errors.JWSInvalid ||
      error instanceof errors.JWSSignatureVerificationFailed ||
      error instanceof errors.JWKSNoMatchingKey ||
      error instanceof errors.JOSEAlgNotAllowed
    )
      return unauthorized();
    // Configuration and JWKS outages are availability failures, never authentication success.
    return c.json(
      {
        error: {
          code: "AUTH_UNAVAILABLE",
          message: "Authentication is temporarily unavailable",
        },
      },
      503,
    );
  }
  await next();
});
