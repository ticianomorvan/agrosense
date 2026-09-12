import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import { z } from "zod";
import { boundedFetch } from "../lib/http";

export type ModelBindings = {
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_REASONING_EFFORT?: string;
};
const configSchema = z.object({
  OPENROUTER_API_KEY: z
    .string()
    .min(1)
    .max(4096)
    .regex(/^[\x21-\x7e]+$/),
  OPENROUTER_MODEL: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[\w.-]+\/[\w.:-]+$/)
    .default("deepseek/deepseek-v4.1-flash"),
  OPENROUTER_REASONING_EFFORT: z
    .enum(["low", "medium", "high"])
    .default("medium"),
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
export function createOpenRouterModel(
  env: ModelBindings,
  fetcher: typeof fetch = fetch,
) {
  const config = readModelConfig(env);
  const openrouter = createOpenRouter({
    apiKey: config.OPENROUTER_API_KEY,
    fetch: (input, init) =>
      boundedFetch(input, init ?? {}, {
        fetcher,
        signal: init?.signal ?? undefined,
        timeoutMs: 20000,
        maxBytes: 1024 * 1024,
      }),
  });
  return openrouter.chat(config.OPENROUTER_MODEL, {
    reasoning: { effort: config.OPENROUTER_REASONING_EFFORT },
    provider: { require_parameters: true, allow_fallbacks: false },
  });
}
