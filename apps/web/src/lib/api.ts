export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 0,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Schema<T> = { parse: (data: unknown) => T };
type RequestOptions = {
  signal?: AbortSignal;
  accessToken?: string;
  body?: unknown;
  method?: "GET" | "POST";
};

export async function getJson<T>(
  path: `/api/${string}`,
  schema: Schema<T>,
  options: RequestOptions = {},
): Promise<T> {
  const headers = new Headers({ Accept: "application/json" });
  if (options.body !== undefined)
    headers.set("Content-Type", "application/json");
  if (options.accessToken)
    headers.set("Authorization", `Bearer ${options.accessToken}`);
  const response = await fetch(path, {
    headers,
    signal: options.signal,
    cache: "no-store",
    method: options.method ?? "GET",
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  if (!response.ok)
    throw new ApiError(
      "HTTP_ERROR",
      response.status === 401
        ? "Sign in to load your farm."
        : "This information could not be loaded. Please try again.",
      response.status,
    );
  try {
    return schema.parse(await response.json());
  } catch (error) {
    if (options.signal?.aborted) throw error;
    throw new ApiError(
      "INVALID_RESPONSE",
      "The server returned incomplete information. Please try again.",
    );
  }
}

export function shouldRetry(failureCount: number, error: Error) {
  return (
    failureCount < 1 &&
    error.name !== "AbortError" &&
    (!(error instanceof ApiError) || error.status >= 500)
  );
}

export function postJson<T>(
  path: `/api/${string}`,
  body: unknown,
  schema: Schema<T>,
  options: RequestOptions = {},
) {
  return getJson(path, schema, { ...options, method: "POST", body });
}
