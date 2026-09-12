import { tool } from "ai";
import { vi } from "vitest";
import { z } from "zod";

export const call = (name: string, args = "{}", id = "call_1") => ({
  id,
  type: "function" as const,
  function: { name, arguments: args },
});
export const chatResponse = (
  content: string | null,
  calls?: ReturnType<typeof call>[],
  finishReason = calls?.length ? "tool_calls" : "stop",
  reasoning?: unknown[],
) =>
  Response.json({
    id: "gen_test",
    object: "chat.completion",
    created: 1789214400,
    model: "deepseek/deepseek-v4.1-flash",
    choices: [
      {
        index: 0,
        finish_reason: finishReason,
        message: {
          role: "assistant",
          content,
          ...(calls ? { tool_calls: calls } : {}),
          ...(reasoning ? { reasoning_details: reasoning } : {}),
        },
      },
    ],
    usage: { prompt_tokens: 100, completion_tokens: 30, total_tokens: 130 },
  });
export function testTools() {
  const execute = vi.fn(async () => ({
    ok: true as const,
    data: { result: "available" },
  }));
  const tools = {
    list_farms: tool({ inputSchema: z.strictObject({}), execute }),
    list_plots: tool({
      inputSchema: z.strictObject({ farmId: z.string() }),
      execute,
    }),
    get_forecast: tool({
      inputSchema: z.strictObject({ plotId: z.string(), days: z.number() }),
      execute,
    }),
  };
  return { tools, execute };
}
