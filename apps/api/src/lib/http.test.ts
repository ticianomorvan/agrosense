import { afterEach, expect, it, vi } from "vitest";
import { boundedFetch, ProviderTimeoutError } from "./http";

afterEach(() => vi.useRealTimers());

it.each(["deadline", "caller"])(
  "cancels a stalled body on %s abort",
  async (abort) => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const reason = new Error("Caller stopped");
    const cancel = vi.fn();
    const fetcher = vi.fn<typeof fetch>(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(new TextEncoder().encode("partial"));
            },
            cancel,
          }),
        ),
    );
    const pending = boundedFetch(
      "https://provider.example",
      {},
      { fetcher, signal: controller.signal, timeoutMs: 100, maxBytes: 1024 },
    );
    const rejected = expect(pending).rejects.toEqual(
      abort === "deadline" ? expect.any(ProviderTimeoutError) : reason,
    );
    if (abort === "caller") controller.abort(reason);
    await vi.advanceTimersByTimeAsync(100);
    await rejected;
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledTimes(1);
  },
);

it("cancels a successful stream once its accumulated bytes exceed the limit", async () => {
  const cancel = vi.fn();
  const fetcher = vi.fn<typeof fetch>(
    async () =>
      new Response(
        new ReadableStream({
          pull(controller) {
            controller.enqueue(new Uint8Array(8));
          },
          cancel,
        }),
      ),
  );
  await expect(
    boundedFetch(
      "https://provider.example",
      {},
      { fetcher, timeoutMs: 1000, maxBytes: 12 },
    ),
  ).rejects.toThrow("Provider response limit exceeded");
  expect(cancel).toHaveBeenCalledTimes(1);
});

it("discards error bodies without waiting for them and retains the status", async () => {
  const cancel = vi.fn();
  const fetcher = vi.fn<typeof fetch>(
    async () => new Response(new ReadableStream({ cancel }), { status: 429 }),
  );
  const response = await boundedFetch(
    "https://provider.example",
    {},
    { fetcher, timeoutMs: 1000, maxBytes: 12 },
  );
  expect(response.status).toBe(429);
  expect(cancel).toHaveBeenCalledTimes(1);
});
