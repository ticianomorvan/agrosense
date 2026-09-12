import { z } from "zod";
import { boundedFetch } from "./http";
import type { AgentTools } from "./tools";

export type ModelBindings = {
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  OPENAI_REASONING_EFFORT?: string;
};
const configSchema = z.object({
  OPENAI_API_KEY: z
    .string()
    .min(1)
    .max(4096)
    .regex(/^[\x21-\x7e]+$/),
  OPENAI_MODEL: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[\w.-]+$/)
    .default("gpt-5.6-terra"),
  OPENAI_REASONING_EFFORT: z.enum(["low", "medium", "high"]).default("medium"),
});
export class AgentError extends Error {
  constructor(
    readonly code:
      | "MODEL_UNAVAILABLE"
      | "AGENT_BUDGET_EXCEEDED"
      | "AGENT_TIMEOUT",
  ) {
    super(code);
  }
}
export function readModelConfig(env: ModelBindings) {
  const result = configSchema.safeParse(env);
  if (!result.success) throw new AgentError("MODEL_UNAVAILABLE");
  return result.data;
}
const outputSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("function_call"),
      call_id: z.string().min(1).max(200),
      name: z.string().min(1).max(100),
      arguments: z.string().max(16384),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("reasoning"),
      encrypted_content: z
        .string()
        .max(512 * 1024)
        .optional(),
    })
    .passthrough(),
  z
    .object({
      type: z.literal("message"),
      role: z.literal("assistant"),
      phase: z.enum(["commentary", "final_answer"]).optional(),
      content: z
        .array(
          z
            .object({
              type: z.literal("output_text"),
              text: z.string().min(1).max(4096),
            })
            .passthrough(),
        )
        .min(1)
        .max(8),
    })
    .passthrough(),
]);
const responseSchema = z.object({
  status: z.literal("completed"),
  output: z.array(outputSchema).min(1).max(32),
});
export type ModelOutput = z.infer<typeof outputSchema>;
export type ModelInput = Record<string, unknown>;
export type ReasoningModel = {
  respond(
    input: ModelInput[],
    definitions: AgentTools["definitions"],
    instructions: string,
    signal: AbortSignal,
  ): Promise<ModelOutput[]>;
};

export function createOpenAIModel(
  env: ModelBindings,
  fetcher: typeof fetch = fetch,
): ReasoningModel {
  return {
    async respond(input, definitions, instructions, signal) {
      const config = readModelConfig(env);
      try {
        const response = await boundedFetch(
          "https://api.openai.com/v1/responses",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.OPENAI_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: config.OPENAI_MODEL,
              reasoning: { effort: config.OPENAI_REASONING_EFFORT },
              store: false,
              input,
              instructions,
              tools: definitions,
              tool_choice: "auto",
              parallel_tool_calls: false,
              max_output_tokens: 4096,
            }),
          },
          { fetcher, signal, timeoutMs: 20000, maxBytes: 1024 * 1024 },
        );
        if (!response.ok) throw new Error("Model request failed");
        return responseSchema.parse(await response.json()).output;
      } catch {
        throw new AgentError("MODEL_UNAVAILABLE");
      }
    },
  };
}
