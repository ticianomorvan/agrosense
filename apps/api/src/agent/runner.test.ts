import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenRouterModel } from "./model";
import { runAgent } from "./runner";
import type { AgentTools } from "./tools";

const now = () => new Date("2026-09-12T12:00:00Z");
const modelEnv = {
  OPENROUTER_API_KEY: "test_model_key",
  OPENROUTER_MODEL: "deepseek/deepseek-v4.1-flash",
};
const call = (name: string, args = "{}", id = "call_1") => ({
  type: "function_call",
  call_id: id,
  name,
  arguments: args,
});
const answer = (text: string) => ({
  type: "message",
  role: "assistant",
  phase: "final_answer",
  content: [{ type: "output_text", text }],
});
const response = (output: unknown[], status = "completed") =>
  Response.json({ status, output });
const tools = (): AgentTools => ({
  definitions: [],
  execute: vi.fn(async () => ({
    ok: true as const,
    data: { result: "available" },
  })),
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("reasoning and tool loop", () => {
  it("executes multiple returned tool calls in order and returns every result before answering", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response([call("list_farms"), call("list_plots", "{}", "call_2")]),
      )
      .mockResolvedValueOnce(response([answer("Which plot?")]));
    let completedFirst = false;
    const registry = tools();
    registry.execute = vi.fn<AgentTools["execute"]>(async (name) => {
      if (name === "list_farms") {
        await Promise.resolve();
        completedFirst = true;
      } else expect(completedFirst).toBe(true);
      return { ok: true, data: {} };
    });
    const result = await runAgent({
      text: "Check my farm",
      history: [],
      tools: registry,
      model: createOpenRouterModel(modelEnv, fetcher),
      now,
    });
    expect(result.trace.map((item) => item.tool)).toEqual([
      "list_farms",
      "list_plots",
    ]);
    const input = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)).input;
    expect(
      input
        .filter(
          (item: { type: string }) => item.type === "function_call_output",
        )
        .map((item: { call_id: string }) => item.call_id),
    ).toEqual(["call_1", "call_2"]);
  });

  it("discovers farms and plots, gets three-day weather, then answers using returned evidence", async () => {
    const reasoning = {
      type: "reasoning",
      id: "rs_1",
      summary: [],
      encrypted_content: "opaque_reasoning",
    };
    const requests: Record<string, unknown>[] = [];
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      expect(String(url)).toBe("https://openrouter.ai/api/v1/responses");
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        `Bearer ${modelEnv.OPENROUTER_API_KEY}`,
      );
      requests.push(JSON.parse(String(init?.body)));
      if (requests.length === 1)
        return response([reasoning, call("list_farms")]);
      if (requests.length === 2)
        return response([call("list_plots", '{"farmId":"farm"}', "call_2")]);
      if (requests.length === 3)
        return response([
          call("get_forecast", '{"plotId":"plot","days":3}', "call_3"),
        ]);
      return response([
        answer(
          "For the next three days, the forecast shows lows of 3, 2 and 4°C. Source: Open-Meteo.",
        ),
      ]);
    });
    const registry = tools();
    const result = await runAgent({
      text: "How is the forecast for the next three days?",
      history: [],
      tools: registry,
      model: createOpenRouterModel(modelEnv, fetcher),
      now,
    });
    expect(result.modelSteps).toBe(4);
    expect(result.trace.map((entry) => entry.tool)).toEqual([
      "list_farms",
      "list_plots",
      "get_forecast",
    ]);
    expect(result.reply).toContain("Open-Meteo");
    expect(requests[1]?.input).toContainEqual(reasoning);
    expect(requests[1]?.input).toContainEqual({
      type: "function_call_output",
      call_id: "call_1",
      output: JSON.stringify({ ok: true, data: { result: "available" } }),
    });
    for (const request of requests) {
      expect(request.store).toBe(false);
      expect(request.model).toBe("deepseek/deepseek-v4.1-flash");
      expect(request.provider).toEqual({
        require_parameters: true,
        allow_fallbacks: false,
      });
      expect(request.include).toEqual(["reasoning.encrypted_content"]);
      expect(request.reasoning).toEqual({ effort: "medium" });
      expect(request).not.toHaveProperty("parallel_tool_calls");
      expect(request.max_output_tokens).toBe(4096);
    }
    expect(JSON.stringify(result)).not.toContain("opaque_reasoning");
    expect(JSON.stringify(result)).not.toContain(modelEnv.OPENROUTER_API_KEY);
  });

  it("returns tool errors to the model so it can recover", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response([call("list_farms", '{"ownerId":"other"}')]),
      )
      .mockResolvedValueOnce(response([call("list_farms", "{}", "call_2")]))
      .mockResolvedValueOnce(response([answer("Which farm do you mean?")]));
    const registry = tools();
    registry.execute = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        error: { code: "INVALID_ARGUMENTS", message: "No ownerId allowed" },
      })
      .mockResolvedValueOnce({ ok: true, data: { farms: [] } });
    const result = await runAgent({
      text: "My farm?",
      history: [],
      tools: registry,
      model: createOpenRouterModel(modelEnv, fetcher),
      now,
    });
    const secondInput = JSON.parse(
      String(fetcher.mock.calls[1]?.[1]?.body),
    ).input;
    expect(secondInput).toContainEqual(
      expect.objectContaining({
        type: "function_call_output",
        output: expect.stringContaining("INVALID_ARGUMENTS"),
      }),
    );
    expect(result.trace[0]).toMatchObject({
      tool: "list_farms",
      ok: false,
      errorCode: "INVALID_ARGUMENTS",
    });
    expect(result.modelSteps).toBe(3);
  });

  it("includes recent conversation turns for follow-up questions", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response([answer("Which plot?")]));
    const history = [
      { role: "user" as const, content: "Tell me about North farm" },
      { role: "assistant" as const, content: "What would you like to know?" },
    ];
    await runAgent({
      text: "And tomorrow?",
      history,
      tools: tools(),
      model: createOpenRouterModel(modelEnv, fetcher),
      now,
    });
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body)).input).toEqual([
      ...history,
      { role: "user", content: "And tomorrow?" },
    ]);
  });

  it("stops a tool loop at the configured budget", async () => {
    let index = 0;
    const fetcher = vi.fn<typeof fetch>(async () =>
      response([call("list_farms", "{}", `call_${++index}`)]),
    );
    await expect(
      runAgent({
        text: "Check",
        history: [],
        tools: tools(),
        model: createOpenRouterModel(modelEnv, fetcher),
        now,
      }),
    ).rejects.toMatchObject({ code: "AGENT_BUDGET_EXCEEDED" });
    expect(fetcher).toHaveBeenCalledTimes(8);
  });

  it("ignores commentary as a final answer and never replies before executing requested tools", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        response([
          { ...answer("Checking now"), phase: "commentary" },
          call("list_farms"),
        ]),
      )
      .mockResolvedValueOnce(response([answer("No farm is available.")]));
    const result = await runAgent({
      text: "Check",
      history: [],
      tools: tools(),
      model: createOpenRouterModel(modelEnv, fetcher),
      now,
    });
    expect(result.reply).toBe("No farm is available.");
    const next = JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body)).input;
    expect(next).toContainEqual(
      expect.objectContaining({ phase: "commentary" }),
    );
  });

  it.each([
    response([call("list_farms")], "incomplete"),
    response([{ type: "function_call", name: "list_farms" }]),
    response([answer("a".repeat(4097))]),
    new Response("not json"),
    Response.json(
      { error: { message: "private upstream details" } },
      { status: 401 },
    ),
  ])(
    "rejects incomplete or malformed model output safely (case %#)",
    async (providerResponse) => {
      const registry = tools();
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(providerResponse);
      await expect(
        runAgent({
          text: "Check",
          history: [],
          tools: registry,
          model: createOpenRouterModel(modelEnv, fetcher),
          now,
        }),
      ).rejects.toMatchObject({ code: "MODEL_UNAVAILABLE" });
      expect(registry.execute).not.toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it("bounds model requests and does not retry stalled calls", async () => {
    vi.useFakeTimers();
    let started!: () => void;
    const pending = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fetcher = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new Error("aborted")),
            { once: true },
          );
          started();
        }),
    );
    const task = runAgent({
      text: "Check",
      history: [],
      tools: tools(),
      model: createOpenRouterModel(modelEnv, fetcher),
      now,
    });
    const assertion = expect(task).rejects.toMatchObject({
      code: "MODEL_UNAVAILABLE",
    });
    await pending;
    await vi.advanceTimersByTimeAsync(20000);
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
