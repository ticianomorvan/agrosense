import { describe, expect, it, vi } from "vitest";
import { createOpenRouterModel, readModelConfig } from "./model";

describe("OpenRouter model boundary", () => {
  it("requires an OpenRouter key and accepts provider-qualified model IDs", () => {
    expect(
      readModelConfig({ OPENROUTER_API_KEY: "router_test" }),
    ).toMatchObject({
      OPENROUTER_MODEL: "deepseek/deepseek-v4.1-flash",
      OPENROUTER_REASONING_EFFORT: "medium",
    });
    expect(
      readModelConfig({
        OPENROUTER_API_KEY: "router_test",
        OPENROUTER_MODEL: "anthropic/claude-sonnet-4.6",
      }).OPENROUTER_MODEL,
    ).toBe("anthropic/claude-sonnet-4.6");
    expect(() => readModelConfig({})).toThrow("MODEL_UNAVAILABLE");
    expect(() =>
      readModelConfig({
        OPENROUTER_API_KEY: "router_test",
        OPENROUTER_MODEL: "https://other.example/model",
      }),
    ).toThrow("MODEL_UNAVAILABLE");
  });

  it("preserves provider reasoning fields and accepts a final message without phase", async () => {
    const output = [
      {
        type: "reasoning",
        id: "rs_test",
        encrypted_content: null,
        content: [{ type: "reasoning_text", text: "private reasoning" }],
        summary: [],
        signature: "opaque-signature",
      },
      {
        type: "message",
        role: "assistant",
        content: [{ type: "output_text", text: "Which plot?" }],
      },
    ];
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(Response.json({ status: "completed", output }));
    const model = createOpenRouterModel(
      { OPENROUTER_API_KEY: "router_test" },
      fetcher,
    );
    expect(
      await model.respond([], [], "Instructions", new AbortController().signal),
    ).toEqual(output);
  });

  it.each([401, 402, 429, 503])(
    "does not retry OpenRouter HTTP %i or expose its body",
    async (status) => {
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          Response.json(
            { error: { message: "private upstream error" } },
            { status },
          ),
        );
      const model = createOpenRouterModel(
        { OPENROUTER_API_KEY: "router_test" },
        fetcher,
      );
      await expect(
        model.respond([], [], "Instructions", new AbortController().signal),
      ).rejects.toThrow("MODEL_UNAVAILABLE");
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );
});
