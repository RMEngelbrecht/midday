import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end smoke suite for a running Midday deployment (docker compose).
 *
 *   E2E_APP_URL   dashboard URL            (default http://app.lvh.me:18080)
 *   E2E_API_URL   API URL                  (default http://api.lvh.me:18080)
 *   E2E_MAILPIT_URL  Mailpit base URL, when the `dev` profile is up; enables
 *                    the "invoice email arrives" assertion
 *   E2E_EMAIL / E2E_PASSWORD   owner account; created on first run, reused
 *                    afterwards, so the suite can be re-run against one stack
 *
 * APP_URL and API_URL must share a parent domain (see docs/self-hosting.md),
 * hence lvh.me, which resolves to 127.0.0.1.
 */
const APP_URL = process.env.E2E_APP_URL ?? "http://app.lvh.me:18080";

export default defineConfig({
  testDir: "./tests",
  // The specs build on each other's data (account -> transactions -> inbox
  // match), so run them in file order on one worker.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 120_000,
  expect: { timeout: 20_000 },
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never" }]]
    : [["list"]],
  use: {
    baseURL: APP_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    ...devices["Desktop Chrome"],
    viewport: { width: 1400, height: 900 },
    // Full Chromium (new headless mode); also present after `playwright install chromium`.
    channel: "chromium",
  },
  projects: [
    { name: "setup", testMatch: /auth\.setup\.ts/ },
    {
      name: "smoke",
      testMatch: /\d\d-.*\.spec\.ts/,
      dependencies: ["setup"],
      use: { storageState: ".auth/owner.json" },
    },
  ],
});
