import { APICallError } from "ai";

/** Longest wait we accept. Longer hints mean a daily quota is spent. */
export const MAX_RATE_LIMIT_WAIT_MS = 90_000;
export const MAX_RATE_LIMIT_RETRIES = 5;

/**
 * How long a 429 asks us to wait, in ms, or null when the error is not a
 * rate limit or gives no hint. Gemini puts the hint in the RetryInfo detail
 * of the body ("retryDelay": "49s") and repeats it in the message
 * ("Please retry in 49.026103941s.").
 */
export function rateLimitRetryDelayMs(error: unknown): number | null {
  if (!APICallError.isInstance(error) || error.statusCode !== 429) return null;

  try {
    const details = JSON.parse(error.responseBody ?? "")?.error?.details;
    for (const detail of Array.isArray(details) ? details : []) {
      const match = /^([\d.]+)s$/.exec(detail?.retryDelay ?? "");
      if (match) return Math.ceil(Number(match[1]) * 1000);
    }
  } catch {
    // Not JSON; fall back to the message.
  }

  const match = /retry in ([\d.]+)\s*s/i.exec(error.message);
  return match ? Math.ceil(Number(match[1]) * 1000) : null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `call`, waiting out per-minute rate limits (as on Gemini's free tier)
 * instead of failing. Gives up when the hint is missing or too long, so a
 * spent daily quota still fails fast.
 */
export async function withRateLimitRetry<T>(
  call: () => PromiseLike<T>,
  options: { wait?: (ms: number) => Promise<unknown> } = {},
): Promise<T> {
  const wait = options.wait ?? sleep;
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (error) {
      const delay = rateLimitRetryDelayMs(error);
      if (
        delay === null ||
        delay > MAX_RATE_LIMIT_WAIT_MS ||
        attempt >= MAX_RATE_LIMIT_RETRIES
      ) {
        throw error;
      }
      // A second of slack so the window has really reset.
      await wait(delay + 1000);
    }
  }
}
