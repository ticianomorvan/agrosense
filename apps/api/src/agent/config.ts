import type { DurableObjectNamespace } from "@cloudflare/workers-types";
import { z } from "zod";
import { type KapsoBindings, readKapsoConfig } from "../lib/kapso";
import { readSupabaseConfig, type SupabaseBindings } from "../lib/supabase";
import { phoneSchema } from "./inbound";
import { type ModelBindings, readModelConfig } from "./model";

export type AgentBindings = KapsoBindings &
  SupabaseBindings &
  ModelBindings & {
    WHATSAPP_AGENT_ENABLED?: string;
    WHATSAPP_AGENT_PHONE_NUMBER?: string;
    KAPSO_WEBHOOK_SECRET?: string;
    WHATSAPP_CONVERSATIONS?: DurableObjectNamespace;
  };
export class AgentConfigurationError extends Error {
  constructor() {
    super("WhatsApp agent is not configured");
  }
}
export function readAgentConfig(env: AgentBindings) {
  try {
    if (env.WHATSAPP_AGENT_ENABLED !== "true") throw new Error("Disabled");
    const kapso = readKapsoConfig(env);
    const model = readModelConfig(env);
    readSupabaseConfig(env);
    z.string()
      .min(1)
      .max(4096)
      .regex(/^[\x21-\x7e]+$/)
      .parse(env.SUPABASE_SECRET_KEY);
    return {
      kapso,
      model,
      sender: phoneSchema.parse(env.WHATSAPP_AGENT_PHONE_NUMBER),
      webhookSecret: z
        .string()
        .min(16)
        .max(4096)
        .parse(env.KAPSO_WEBHOOK_SECRET),
      ownerId: kapso.KAPSO_ALLOWED_USER_ID,
      phoneNumberId: kapso.KAPSO_PHONE_NUMBER_ID,
    };
  } catch {
    throw new AgentConfigurationError();
  }
}

export async function conversationName(config: {
  ownerId: string;
  phoneNumberId: string;
  sender: string;
}): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(
      JSON.stringify([config.ownerId, config.phoneNumberId, config.sender]),
    ),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
