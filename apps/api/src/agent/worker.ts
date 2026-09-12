import { DurableObject } from "cloudflare:workers";
import { sendWhatsappText } from "../lib/kapso";
import {
  type AgentBindings,
  AgentConfigurationError,
  conversationName,
  readAgentConfig,
} from "./config";
import { AdmissionError, Conversation } from "./conversation";
import type { InboundMessage } from "./inbound";
import { createOpenRouterModel } from "./model";
import { runAgent } from "./runner";
import { createAgentTools } from "./tools";

export class WhatsAppConversation extends DurableObject<AgentBindings> {
  #conversation: Conversation;
  #objectName: string | undefined;
  constructor(ctx: DurableObjectState, env: AgentBindings) {
    super(ctx, env);
    this.#objectName = ctx.id.name;
    this.#conversation = new Conversation({
      store: ctx.storage,
      run: async (input) => {
        await this.#authorizeMessages(input.ownerId, [input.message]);
        return runAgent({
          text: input.message.text,
          history: input.history,
          tools: createAgentTools({ env: this.env, ownerId: input.ownerId }),
          model: createOpenRouterModel(this.env),
        });
      },
      send: async (input) => {
        const config = await this.#authorizeMessages(input.ownerId, [
          input.message,
        ]);
        return sendWhatsappText(config.kapso, {
          to: input.message.sender,
          text: input.reply,
        });
      },
    });
  }

  async #authorizeIdentity(ownerId: string, sender: string) {
    const config = readAgentConfig(this.env);
    if (
      ownerId !== config.ownerId ||
      !this.#objectName ||
      (await conversationName({ ...config, sender })) !== this.#objectName
    )
      throw new AgentConfigurationError();
    return config;
  }

  async #authorizeMessages(ownerId: string, messages: InboundMessage[]) {
    const sender = messages[0]?.sender;
    if (!sender || messages.some((message) => message.sender !== sender))
      throw new AgentConfigurationError();
    const config = await this.#authorizeIdentity(ownerId, sender);
    if (
      messages.some((message) => message.phoneNumberId !== config.phoneNumberId)
    )
      throw new AgentConfigurationError();
    return config;
  }

  // The Worker validates the signed payload before making this internal RPC call.
  async enqueue(messages: InboundMessage[], ownerId: string) {
    try {
      await this.#authorizeMessages(ownerId, messages);
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

  async status(messageId: string, ownerId: string, sender: string) {
    try {
      await this.#authorizeIdentity(ownerId, sender);
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
