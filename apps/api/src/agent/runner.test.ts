import { afterEach, describe, expect, it, vi } from "vitest";
import { createOpenRouterModel } from "./model";
import { formatForWhatsapp, runAgent } from "./runner";
import { call, chatResponse, testTools } from "./test-helpers";

const now = () => new Date("2026-09-12T12:00:00Z");
const modelEnv = {
  OPENROUTER_API_KEY: "test_model_key",
  OPENROUTER_MODEL: "deepseek/deepseek-v4.1-flash",
};
const body = (fetcher: ReturnType<typeof vi.fn<typeof fetch>>, index: number) =>
  JSON.parse(String(fetcher.mock.calls[index]?.[1]?.body));
const run = (fetcher: typeof fetch, tools = testTools().tools) =>
  runAgent({
    text: "Check my farm",
    history: [],
    tools,
    model: createOpenRouterModel(modelEnv, fetcher),
    now,
  });
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("AI SDK agent through OpenRouter", () => {
  it("executes a returned batch sequentially and sends every result before answering", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        chatResponse("Checking now", [
          call("list_farms"),
          call("list_plots", '{"farmId":"farm"}', "call_2"),
        ]),
      )
      .mockResolvedValueOnce(chatResponse("Which plot?"));
    const { tools } = testTools();
    let firstFinished = false;
    tools.list_farms.execute = vi.fn(async () => {
      await Promise.resolve();
      firstFinished = true;
      return { ok: true as const, data: { result: "available" } };
    });
    tools.list_plots.execute = vi.fn(async () => {
      expect(firstFinished).toBe(true);
      return { ok: true as const, data: { result: "available" } };
    });
    const result = await run(fetcher, tools);
    expect(result.reply).toBe("Which plot?");
    expect(result.trace.map((item) => item.tool)).toEqual([
      "list_farms",
      "list_plots",
    ]);
    expect(
      body(fetcher, 1)
        .messages.filter((item: { role: string }) => item.role === "tool")
        .map((item: { tool_call_id: string }) => item.tool_call_id),
    ).toEqual(["call_1", "call_2"]);
  });

  it("discovers farms, plots and weather while preserving provider reasoning between steps", async () => {
    const reasoning = [
      {
        type: "reasoning.text",
        text: "private_reasoning",
        signature: "opaque_signature",
        id: "rs_1",
        format: "unknown",
        index: 0,
      },
    ];
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        chatResponse(null, [call("list_farms")], "tool_calls", reasoning),
      )
      .mockResolvedValueOnce(
        chatResponse(null, [call("list_plots", '{"farmId":"farm"}', "call_2")]),
      )
      .mockResolvedValueOnce(
        chatResponse(null, [
          call("get_forecast", '{"plotId":"plot","days":3}', "call_3"),
        ]),
      )
      .mockResolvedValueOnce(
        chatResponse("Lows of 3, 2 and 4°C. Source: Open-Meteo."),
      );
    const result = await run(fetcher);
    expect(result.modelSteps).toBe(4);
    expect(result.trace.map((entry) => entry.tool)).toEqual([
      "list_farms",
      "list_plots",
      "get_forecast",
    ]);
    expect(result.reply).toContain("Open-Meteo");
    expect(body(fetcher, 1).messages).toContainEqual(
      expect.objectContaining({
        role: "assistant",
        reasoning_details: reasoning,
      }),
    );
    expect(body(fetcher, 1).messages).toContainEqual({
      role: "tool",
      name: "list_farms",
      tool_call_id: "call_1",
      content: JSON.stringify({ ok: true, data: { result: "available" } }),
    });
    for (const [url, init] of fetcher.mock.calls) {
      expect(String(url)).toBe("https://openrouter.ai/api/v1/chat/completions");
      expect(new Headers(init?.headers).get("Authorization")).toBe(
        `Bearer ${modelEnv.OPENROUTER_API_KEY}`,
      );
      const request = JSON.parse(String(init?.body));
      expect(request.model).toBe(modelEnv.OPENROUTER_MODEL);
      expect(request.provider).toEqual({
        require_parameters: true,
        allow_fallbacks: false,
        sort: "throughput",
      });
      expect(request.reasoning).toEqual({ effort: "medium" });
      expect(request).not.toHaveProperty("parallel_tool_calls");
      expect(request.max_tokens).toBe(4096);
    }
    expect(JSON.stringify(result)).not.toMatch(
      /private_reasoning|opaque_signature|test_model_key/,
    );
  });

  it("returns schema errors to the model for correction without executing invalid calls", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        chatResponse(null, [call("list_farms", '{"ownerId":"other"}')]),
      )
      .mockResolvedValueOnce(
        chatResponse(null, [call("list_farms", "{}", "call_2")]),
      )
      .mockResolvedValueOnce(chatResponse("Which farm?"));
    const { tools, execute } = testTools();
    const result = await run(fetcher, tools);
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.trace[0]).toMatchObject({
      tool: "list_farms",
      ok: false,
      errorCode: "INVALID_ARGUMENTS",
    });
    expect(body(fetcher, 1).messages).toContainEqual(
      expect.objectContaining({ role: "tool", tool_call_id: "call_1" }),
    );
    expect(result.modelSteps).toBe(3);
  });

  it("includes recent turns and the current local date", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(chatResponse("Which plot?"));
    const history = [
      { role: "user" as const, content: "Tell me about North" },
      { role: "assistant" as const, content: "What would you like to know?" },
    ];
    await runAgent({
      text: "And tomorrow?",
      history,
      tools: testTools().tools,
      model: createOpenRouterModel(modelEnv, fetcher),
      now,
    });
    expect(body(fetcher, 0).messages.slice(1)).toEqual([
      ...history,
      { role: "user", content: "And tomorrow?" },
    ]);
    expect(body(fetcher, 0).messages[0].content[0].text).toContain(
      "Current date: 2026-09-12",
    );
  });

  it("stops after eight model steps", async () => {
    let index = 0;
    const fetcher = vi.fn<typeof fetch>(async () =>
      chatResponse(null, [call("list_farms", "{}", `call_${++index}`)]),
    );
    await expect(run(fetcher)).rejects.toMatchObject({
      code: "AGENT_BUDGET_EXCEEDED",
      modelSteps: 8,
    });
    expect(fetcher).toHaveBeenCalledTimes(8);
  });

  it.each([9, 20])(
    "rejects an oversized batch of %i calls before executing any",
    async (count) => {
      const fetcher = vi.fn<typeof fetch>(async () =>
        chatResponse(
          null,
          Array.from({ length: count }, (_, i) =>
            call("list_farms", "{}", `call_${i}`),
          ),
        ),
      );
      const { tools, execute } = testTools();
      await expect(run(fetcher, tools)).rejects.toMatchObject({
        code: "AGENT_BUDGET_EXCEEDED",
        trace: [],
      });
      expect(execute).not.toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it("enforces the total tool budget across batches", async () => {
    let index = 0;
    const fetcher = vi.fn<typeof fetch>(async () =>
      chatResponse(
        null,
        Array.from({ length: 3 }, () =>
          call("list_farms", "{}", `call_${++index}`),
        ),
      ),
    );
    const { tools, execute } = testTools();
    await expect(run(fetcher, tools)).rejects.toMatchObject({
      code: "AGENT_BUDGET_EXCEEDED",
      modelSteps: 3,
    });
    expect(execute).toHaveBeenCalledTimes(6);
  });

  it("rejects a repeated call ID before re-execution", async () => {
    const fetcher = vi.fn<typeof fetch>(async () =>
      chatResponse(null, [call("list_farms")]),
    );
    const { tools, execute } = testTools();
    await expect(run(fetcher, tools)).rejects.toMatchObject({
      code: "MODEL_UNAVAILABLE",
      modelSteps: 2,
    });
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("returns a bounded error when a tool result is too large", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(chatResponse(null, [call("list_farms")]))
      .mockResolvedValueOnce(chatResponse("Please narrow the query."));
    const { tools, execute } = testTools();
    execute.mockResolvedValue({
      ok: true,
      data: { result: "x".repeat(33000) },
    });
    const result = await run(fetcher, tools);
    expect(result.trace[0]?.errorCode).toBe("TOOL_RESULT_TOO_LARGE");
    expect(JSON.stringify(body(fetcher, 1))).not.toContain("x".repeat(33000));
  });

  it.each([
    () => chatResponse(null, [call("list_farms")], "length"),
    () => chatResponse(null),
    () => chatResponse("a".repeat(4097)),
    () => Response.json({ choices: [{ message: { role: "assistant" } }] }),
    () => new Response("not json"),
    () =>
      Response.json(
        { error: { message: "private upstream details" } },
        { status: 401 },
      ),
  ])(
    "rejects incomplete or malformed model output safely (case %#)",
    async (response) => {
      const { tools, execute } = testTools();
      const fetcher = vi.fn<typeof fetch>(async () => response());
      await expect(run(fetcher, tools)).rejects.toMatchObject({
        code: "MODEL_UNAVAILABLE",
      });
      expect(execute).not.toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it("logs only a stable code when the model provider exposes private details", async () => {
    const errorLog = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const fetcher = vi.fn<typeof fetch>(async () =>
      Response.json(
        { error: { message: "private upstream details" } },
        { status: 401 },
      ),
    );
    const { tools } = testTools();

    await expect(run(fetcher, tools)).rejects.toMatchObject({
      code: "MODEL_UNAVAILABLE",
    });

    expect(errorLog).toHaveBeenCalledWith(
      JSON.stringify({
        event: "whatsapp_agent_run_failed",
        code: "MODEL_UNAVAILABLE",
      }),
    );
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain(
      "private upstream details",
    );
  });

  it("bounds stalled requests and never retries them", async () => {
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
    const assertion = expect(run(fetcher)).rejects.toMatchObject({
      code: "MODEL_UNAVAILABLE",
    });
    await pending;
    await vi.advanceTimersByTimeAsync(20000);
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("cancels the whole run after 60 seconds across successful requests", async () => {
    vi.useFakeTimers();
    let index = 0;
    const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
      await new Promise<void>((resolve, reject) => {
        setTimeout(resolve, 15000);
        init?.signal?.addEventListener(
          "abort",
          () => reject(new Error("aborted")),
          { once: true },
        );
      });
      return chatResponse(null, [call("list_farms", "{}", `call_${++index}`)]);
    });
    const assertion = expect(run(fetcher)).rejects.toMatchObject({
      code: "AGENT_TIMEOUT",
      modelSteps: 4,
    });
    await vi.advanceTimersByTimeAsync(60000);
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  describe("formatForWhatsapp", () => {
    it("converts double asterisks markdown bold to single asterisk WhatsApp bold", () => {
      const input = "El pronóstico para **Lote Norte** tiene riesgo **alto**.";
      expect(formatForWhatsapp(input)).toBe(
        "El pronóstico para *Lote Norte* tiene riesgo *alto*.",
      );
    });

    it("converts markdown headings to bold labels", () => {
      const input = "### Pronóstico próximos 3 días\nTemperatura: 22°C";
      expect(formatForWhatsapp(input)).toBe(
        "*Pronóstico próximos 3 días*\nTemperatura: 22°C",
      );
    });

    it("strips markdown table divider rows and trims whitespace", () => {
      const input = "Día | Temp\n|---|---|\n12/09 | 20°C\n\n\nFin";
      expect(formatForWhatsapp(input)).toBe(
        "Día | Temp\n\n12/09 | 20°C\n\nFin",
      );
    });
  });
});
