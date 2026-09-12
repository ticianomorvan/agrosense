/** A deadline covers headers and body; provider bodies cannot grow without bound. */
export async function boundedFetch(
  input: RequestInfo | URL,
  init: RequestInit,
  options: {
    fetcher: typeof fetch;
    signal: AbortSignal;
    timeoutMs: number;
    maxBytes: number;
  },
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);
  const signal = AbortSignal.any([options.signal, controller.signal]);
  try {
    signal.throwIfAborted();
    const response = await options.fetcher(input, {
      ...init,
      signal,
      redirect: "error",
    });
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
  } finally {
    clearTimeout(timer);
  }
}
