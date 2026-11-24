import { describe, expect, test } from "bun:test";
import { APICallError } from "ai";
import { rateLimitRetryDelayMs, withRateLimitRetry } from "./rate-limit";

function apiError(statusCode: number, message: string, body?: unknown) {
  return new APICallError({
    message,
    url: "https://generativelanguage.googleapis.com",
    requestBodyValues: {},
    statusCode,
    responseBody: body === undefined ? undefined : JSON.stringify(body),
  });
}

const geminiQuota = (delay: string) =>
  apiError(429, `Quota exceeded. Please retry in ${delay}.`, {
    error: {
      code: 429,
      status: "RESOURCE_EXHAUSTED",
      details: [
        { "@type": "type.googleapis.com/google.rpc.QuotaFailure" },
        {
          "@type": "type.googleapis.com/google.rpc.RetryInfo",
          retryDelay: "49s",
        },
      ],
    },
  });

describe("rateLimitRetryDelayMs", () => {
  test("reads Gemini's RetryInfo", () => {
    expect(rateLimitRetryDelayMs(geminiQuota("49.026103941s"))).toBe(49_000);
  });

  test("falls back to the message", () => {
    expect(rateLimitRetryDelayMs(apiError(429, "Please retry in 12.5s."))).toBe(
      12_500,
    );
  });

  test("ignores other errors", () => {
    expect(rateLimitRetryDelayMs(apiError(400, "retry in 5s"))).toBeNull();
    expect(rateLimitRetryDelayMs(apiError(429, "slow down"))).toBeNull();
    expect(rateLimitRetryDelayMs(new Error("retry in 5s"))).toBeNull();
  });
});

describe("withRateLimitRetry", () => {
  test("waits out a per-minute limit and retries", async () => {
    const waits: number[] = [];
    let calls = 0;
    const result = await withRateLimitRetry(
      async () => {
        if (++calls < 3) throw geminiQuota("49s");
        return "ok";
      },
      { wait: async (ms) => waits.push(ms) },
    );
    expect(result).toBe("ok");
    expect(waits).toEqual([50_000, 50_000]);
  });

  test("fails fast on a long (daily) wait or a non-rate-limit error", async () => {
    const daily = apiError(429, "Please retry in 3600s.");
    await expect(
      withRateLimitRetry(() => Promise.reject(daily), { wait: async () => {} }),
    ).rejects.toBe(daily);

    const bad = apiError(400, "bad request");
    await expect(
      withRateLimitRetry(() => Promise.reject(bad), { wait: async () => {} }),
    ).rejects.toBe(bad);
  });

  test("gives up after the retry limit", async () => {
    let calls = 0;
    await expect(
      withRateLimitRetry(
        async () => {
          calls++;
          throw geminiQuota("1s");
        },
        { wait: async () => {} },
      ),
    ).rejects.toBeInstanceOf(APICallError);
    expect(calls).toBe(6);
  });
});
