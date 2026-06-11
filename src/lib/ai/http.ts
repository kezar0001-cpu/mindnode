import "server-only";

// Shared HTTP policy for AI provider calls (chat completions, embeddings):
// each attempt is bounded by a timeout, and transient failures — network
// errors, HTTP 429 and 5xx — are retried up to MAX_ATTEMPTS with exponential
// backoff. Other 4xx responses are returned to the caller immediately, since
// retrying a bad request just wastes tokens.

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;
const BASE_BACKOFF_MS = 1_000;

export type FetchResult =
  | { ok: true; response: Response }
  | { ok: false; error: string };

function requestTimeoutMs(): number {
  const raw = Number(process.env.AI_REQUEST_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit,
): Promise<FetchResult> {
  const timeoutMs = requestTimeoutMs();
  let lastError = "AI provider unreachable.";

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      lastError =
        err instanceof Error && err.name === "TimeoutError"
          ? `AI request timed out after ${Math.round(timeoutMs / 1000)}s.`
          : `Network error: ${err instanceof Error ? err.message : "unknown"}`;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
      }
      continue;
    }

    if (response.status === 429 || response.status >= 500) {
      lastError = `AI provider error (${response.status}).`;
      if (attempt < MAX_ATTEMPTS) {
        await sleep(BASE_BACKOFF_MS * 2 ** (attempt - 1));
      }
      continue;
    }

    return { ok: true, response };
  }

  return { ok: false, error: lastError };
}
