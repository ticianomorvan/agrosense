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
    const reader = response.body?.getReader();
    if (!reader) return response;
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > options.maxBytes)
          throw new Error("Provider response limit exceeded");
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      throw error;
    } finally {
      reader.releaseLock();
    }
    signal.throwIfAborted();
    const body = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
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
