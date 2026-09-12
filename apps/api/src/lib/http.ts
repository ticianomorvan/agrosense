import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

export function jsonError(
  c: Context,
  status: ContentfulStatusCode,
  code: string,
  message: string,
) {
  return c.json({ error: { code, message } }, status);
}

export class ProviderTimeoutError extends Error {
  constructor() {
    super("Provider deadline exceeded");
  }
}

/** A deadline covers headers and body; only successful response bodies are retained. */
export async function boundedFetch(
  input: RequestInfo | URL,
  init: RequestInit,
  options: {
    fetcher: typeof fetch;
    signal?: AbortSignal;
    timeoutMs: number;
    maxBytes: number;
  },
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const signal = options.signal
    ? AbortSignal.any([options.signal, controller.signal])
    : controller.signal;
  try {
    signal.throwIfAborted();
    const response = await options.fetcher.call(globalThis, input, {
      ...init,
      signal,
      redirect: "manual",
    });
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      throw new Error("Provider redirect rejected");
    }
    if (!response.ok) {
      await response.body?.cancel();
      return response;
    }
    if (!response.body) return response;
    let size = 0;
    const limited = response.body.pipeThrough(
      new TransformStream<Uint8Array, Uint8Array>({
        transform(chunk, controller) {
          size += chunk.byteLength;
          if (size > options.maxBytes)
            throw new Error("Provider response limit exceeded");
          controller.enqueue(chunk);
        },
      }),
    );
    const body = await new Response(limited).arrayBuffer();
    signal.throwIfAborted();
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  } catch (error) {
    if (controller.signal.aborted) throw new ProviderTimeoutError();
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
