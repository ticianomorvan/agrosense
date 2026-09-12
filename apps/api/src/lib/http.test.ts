import { afterEach, expect, it, vi } from "vitest";
import { boundedFetch, ProviderTimeoutError } from "./http";

afterEach(() => vi.useRealTimers());

it("keeps the provider deadline active while reading a stalled body", async () => {
  vi.useFakeTimers();
  const fetcher = vi.fn<typeof fetch>(
    async (_input, init) =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode("partial"));
            init?.signal?.addEventListener(
              "abort",
              () => controller.error(new Error("aborted")),
              { once: true },
            );
          },
        }),
      ),
  );
  const pending = boundedFetch(
    "https://provider.example",
    {},
    { fetcher, timeoutMs: 100, maxBytes: 1024 },
  );
  const rejected = expect(pending).rejects.toBeInstanceOf(ProviderTimeoutError);
  await vi.advanceTimersByTimeAsync(100);
  await rejected;
  expect(fetcher).toHaveBeenCalledTimes(1);
});

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
