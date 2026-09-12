import { whatsappPhoneSchema } from "@agrosense/contracts";
import { z } from "zod";
import { type KapsoBindings, readKapsoConfig } from "../lib/kapso";
import { readSupabaseConfig, type SupabaseBindings } from "../lib/supabase";
import { hashIdentity } from "./identity";
import { type ModelBindings, readModelConfig } from "./model";
import type { WhatsAppConversation } from "./worker";

export type AgentBindings = KapsoBindings &
  SupabaseBindings &
  ModelBindings & {
    WHATSAPP_AGENT_ENABLED?: string;
    WHATSAPP_AGENT_PHONE_NUMBER?: string;
    KAPSO_WEBHOOK_SECRET?: string;
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
      sender: whatsappPhoneSchema.parse(env.WHATSAPP_AGENT_PHONE_NUMBER),
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

export function conversationName(config: {
  ownerId: string;
  phoneNumberId: string;
  sender: string;
}): Promise<string> {
  return hashIdentity([config.ownerId, config.phoneNumberId, config.sender]);
}
