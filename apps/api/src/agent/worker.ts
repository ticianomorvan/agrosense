import { DurableObject } from "cloudflare:workers";
import { sendWhatsappText } from "../lib/kapso";
import {
  type AgentBindings,
  AgentConfigurationError,
  readAgentConfig,
} from "./config";
import { AdmissionError, Conversation } from "./conversation";
import type { InboundMessage } from "./inbound";
import { createOpenRouterModel } from "./model";
import { runAgent } from "./runner";
import { createAgentTools } from "./tools";

export class WhatsAppConversation extends DurableObject<AgentBindings> {
  #conversation: Conversation;
  constructor(ctx: DurableObjectState, env: AgentBindings) {
    super(ctx, env);
    this.#conversation = new Conversation({
      store: ctx.storage,
      run: async (input) => {
        this.#authorize(input.ownerId, [input.message]);
        return runAgent({
          text: input.message.text,
          history: input.history,
          tools: createAgentTools({ env: this.env, ownerId: input.ownerId }),
          model: createOpenRouterModel(this.env),
        });
      },
      send: async (input) => {
        const config = this.#authorize(input.ownerId, [input.message]);
        return sendWhatsappText(config.kapso, {
          to: input.message.sender,
          text: input.reply,
        });
      },
    });
  }

  #authorize(ownerId: string, messages: InboundMessage[]) {
    const config = readAgentConfig(this.env);
    if (
      ownerId !== config.ownerId ||
      messages.some(
        (message) =>
          message.sender !== config.sender ||
          message.phoneNumberId !== config.phoneNumberId,
      )
    )
      throw new AgentConfigurationError();
    return config;
  }

  // The Worker validates the signed payload before making this internal RPC call.
  async enqueue(messages: InboundMessage[], ownerId: string) {
    try {
      this.#authorize(ownerId, messages);
      return await this.#conversation.enqueue(messages, ownerId);
    } catch (error) {
      if (error instanceof AdmissionError)
        return {
          status: error.status,
          error: {
            code: error.status === 409 ? "MESSAGE_CONFLICT" : "RATE_LIMITED",
            message: error.message,
          },
        };
      throw new Error("Conversation is temporarily unavailable");
    }
  }

  async status(messageId: string) {
    try {
      return await this.#conversation.status(messageId);
    } catch {
      throw new Error("Conversation is temporarily unavailable");
    }
  }

  async alarm(): Promise<void> {
    try {
      await this.#conversation.processNext();
    } catch {
      // Keep payloads and provider errors out of Worker logs; the alarm will recover.
      console.error("whatsapp_agent_processing_failed");
      throw new Error("Conversation processing failed");
    }
  }
}
