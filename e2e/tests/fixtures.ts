import { test as base, expect } from "@playwright/test";
import { API_URL } from "./helpers";

const APP_URL = process.env.E2E_APP_URL ?? "http://app.lvh.me:18080";
const allowed = new Set(
  [APP_URL, API_URL, process.env.E2E_MAILPIT_URL]
    .filter((url): url is string => !!url)
    .map((url) => new URL(url).host),
);

/**
 * `test` with a guard for the zero-config promise: the browser must only talk
 * to the deployment itself (no CDNs, fonts, analytics). Server-side calls,
 * such as exchange rates, are not visible here.
 */
export const test = base.extend<{ onlyOwnHosts: undefined }>({
  onlyOwnHosts: [
    async ({ context }, use) => {
      const external = new Set<string>();
      context.on("request", (request) => {
        const url = new URL(request.url());
        if (/^https?:$/.test(url.protocol) && !allowed.has(url.host)) {
          external.add(`${url.host}${url.pathname}`);
        }
      });
      await use(undefined);
      expect([...external], "browser requests to other hosts").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
