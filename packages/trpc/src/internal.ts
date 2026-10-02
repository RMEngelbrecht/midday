import type { AppRouter } from "@midday/api/trpc/routers/_app";
import { createTRPCClient, httpBatchLink } from "@trpc/client";
import superjson from "superjson";
import { ENV } from "./env";
import { fetchWithRetry } from "./fetch-with-retry";

/**
 * Create a tRPC client for internal service-to-service calls.
 * Authenticates via INTERNAL_API_KEY header.
 */
export function createInternalClient() {
  const apiUrl = ENV.API_INTERNAL_URL ?? ENV.API_URL;

  const internalApiKey = ENV.INTERNAL_API_KEY;

  if (!internalApiKey) {
    throw new Error(
      "INTERNAL_API_KEY environment variable is required for internal tRPC client",
    );
  }

  const trpcUrl = `${apiUrl}/trpc`;

  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: trpcUrl,
        transformer: superjson,
        // @ts-expect-error -- native Response.body (ReadableStream<any>) is not structurally
        // compatible with tRPC's ResponseEsque (ReadableStream<Uint8Array>) due to getReader() generics
        fetch: fetchWithRetry,
        headers() {
          return {
            "x-internal-key": internalApiKey,
          };
        },
      }),
    ],
  });
}

/**
 * Pre-configured internal tRPC client singleton.
 * Import this directly in jobs and workers.
 */
let _client: ReturnType<typeof createInternalClient> | null = null;

export function getInternalClient() {
  if (!_client) {
    _client = createInternalClient();
  }
  return _client;
}
