import type { DurableObjectState } from "@cloudflare/workers-types";
import { z } from "zod";
import { sendWhatsappText } from "../lib/kapso";
import {
  type AgentBindings,
  AgentConfigurationError,
  readAgentConfig,
} from "./config";
import { AdmissionError, Conversation, type RunInput } from "./conversation";
import { inboundMessageSchema } from "./inbound";
import { createOpenAIModel } from "./model";
import { runAgent } from "./runner";
import { createAgentTools } from "./tools";

const admissionSchema = z.strictObject({
  ownerId: z.uuid(),
  messages: z.array(inboundMessageSchema).min(1).max(20),
});

export class WhatsAppConversation {
  private readonly conversation: Conversation;
  constructor(
    ctx: DurableObjectState,
    private readonly env: AgentBindings,
  ) {
    const authorize = (input: Pick<RunInput, "message" | "ownerId">) => {
      const config = readAgentConfig(this.env);
      if (
        input.ownerId !== config.ownerId ||
        input.message.sender !== config.sender ||
        input.message.phoneNumberId !== config.phoneNumberId
      )
        throw new AgentConfigurationError();
      return config;
    };
    this.conversation = new Conversation({
      store: ctx.storage,
      run: async (input) => {
        authorize(input);
        return runAgent({
          text: input.message.text,
          history: input.history,
          tools: createAgentTools({ env: this.env, ownerId: input.ownerId }),
          model: createOpenAIModel(this.env),
        });
      },
      send: async (input) => {
        const config = authorize(input);
        return sendWhatsappText(config.kapso, {
          to: input.message.sender,
          text: input.reply,
        });
      },
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (request.method === "POST" && url.pathname === "/enqueue") {
        const config = readAgentConfig(this.env);
        const input = admissionSchema.parse(await request.json());
        if (
          input.ownerId !== config.ownerId ||
          input.messages.some(
            (message) =>
              message.sender !== config.sender ||
              message.phoneNumberId !== config.phoneNumberId,
          )
        )
          return Response.json(
            {
              error: {
                code: "FORBIDDEN",
                message: "Conversation identity mismatch",
              },
            },
            { status: 403 },
          );
        return Response.json(
          await this.conversation.enqueue(input.messages, input.ownerId),
        );
      }
      if (request.method === "GET" && url.pathname === "/run") {
        const messageId = z
          .string()
          .min(1)
          .max(512)
          .parse(url.searchParams.get("messageId"));
        const status = await this.conversation.status(messageId);
        return status
          ? Response.json(status)
          : Response.json(
              { error: { code: "NOT_FOUND", message: "Run not found" } },
              { status: 404 },
            );
      }
      return Response.json(
        { error: { code: "NOT_FOUND", message: "Route not found" } },
        { status: 404 },
      );
    } catch (error) {
      if (error instanceof AdmissionError)
        return Response.json(
          {
            error: {
              code: error.status === 409 ? "MESSAGE_CONFLICT" : "RATE_LIMITED",
              message: error.message,
            },
          },
          { status: error.status },
        );
      if (error instanceof z.ZodError || error instanceof SyntaxError)
        return Response.json(
          {
            error: {
              code: "BAD_REQUEST",
              message: "Invalid conversation request",
            },
          },
          { status: 400 },
        );
      return Response.json(
        {
          error: {
            code: "AGENT_UNAVAILABLE",
            message: "Conversation is temporarily unavailable",
          },
        },
        { status: 503 },
      );
    }
  }

  async alarm(): Promise<void> {
    try {
      await this.conversation.processNext();
    } catch {
      // Keep payloads and provider errors out of Worker logs; the alarm will recover.
      console.error("whatsapp_agent_processing_failed");
      throw new Error("Conversation processing failed");
    }
  }
}
