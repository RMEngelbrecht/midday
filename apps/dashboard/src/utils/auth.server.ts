import "server-only";

import { cookies } from "next/headers";
import { cache } from "react";
import { ENV } from "@/env";
import { fetchAuthSession } from "./auth-session";

/**
 * The signed-in user for this request, resolved by the API's better-auth
 * (`get-session`) from the request cookies. Cached per request; includes a
 * short-lived JWT for server-side API calls.
 */
export const getServerSession = cache(async () => {
  const cookieStore = await cookies();
  const { session } = await fetchAuthSession(
    ENV.API_INTERNAL_URL,
    cookieStore.toString(),
  );
  return session;
});

/** Forwards the request cookies to an API auth endpoint. */
export async function callAuthApi(
  path: string,
  init: { method?: "GET" | "POST"; body?: unknown } = {},
) {
  const cookieStore = await cookies();
  return fetch(`${ENV.API_INTERNAL_URL}/auth${path}`, {
    method: init.method ?? "GET",
    headers: {
      cookie: cookieStore.toString(),
      origin: ENV.APP_URL,
      ...(init.body ? { "content-type": "application/json" } : {}),
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
}
