import { z } from "zod";
import {
  type KapsoBindings,
  readKapsoConfig,
  readKapsoWebhookConfig,
} from "../lib/kapso";
import { readSupabaseConfig, type SupabaseBindings } from "../lib/supabase";
import type { ForecastBindings } from "./forecast";
import { hashIdentity } from "./identity";
import { type ModelBindings, readModelConfig } from "./model";
import type { WhatsAppConversation } from "./worker";

export type AgentBindings = KapsoBindings &
  SupabaseBindings &
  ForecastBindings &
  ModelBindings & {
    WHATSAPP_AGENT_ENABLED?: string;
    WHATSAPP_CONVERSATIONS?: DurableObjectNamespace<WhatsAppConversation>;
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
    readModelConfig(env);
    readSupabaseConfig(env);
    z.string()
      .min(1)
      .max(4096)
      .regex(/^[\x21-\x7e]+$/)
      .parse(env.SUPABASE_SECRET_KEY);
    return {
      kapso,
      ...readKapsoWebhookConfig(env),
      ownerId: kapso.KAPSO_ALLOWED_USER_ID,
    };
  } catch {
    throw new AgentConfigurationError();
  }
}

export function conversationName(config: {
  ownerId: string;
  phoneNumberId: string;
  sender: string;
}): Promise<string> {
  return hashIdentity([config.ownerId, config.phoneNumberId, config.sender]);
}
