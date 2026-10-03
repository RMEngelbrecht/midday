import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, type Locator, type Page } from "@playwright/test";

export const OWNER = {
  name: "E2E Owner",
  email: process.env.E2E_EMAIL ?? "e2e-owner@example.com",
  password: process.env.E2E_PASSWORD ?? "correct-horse-battery-1",
};

export const API_URL = process.env.E2E_API_URL ?? "http://api.lvh.me:18080";
export const MAILPIT_URL = process.env.E2E_MAILPIT_URL;

export function fixture(name: string) {
  return join(__dirname, "..", "fixtures", name);
}

/** A fixture as an in-memory upload with a per-run unique name. */
export function uniqueUpload(fixtureName: string, prefix: string) {
  const ext = fixtureName.split(".").pop();
  return {
    name: `${prefix}-${Date.now()}.${ext}`,
    mimeType: ext === "pdf" ? "application/pdf" : "application/octet-stream",
    buffer: readFileSync(fixture(fixtureName)),
  };
}

/**
 * Wait until React has hydrated so clicks and file inputs are live. There is
 * no "network idle" here: the realtime SSE stream stays open on every page.
 */
export async function hydrated(page: Page) {
  await page.waitForLoadState("load");
  await page.waitForTimeout(1_500);
}

/** Sign in with email + password on the login page. */
export async function signIn(page: Page) {
  await page.goto("/login");
  await page.getByPlaceholder("Email address").fill(OWNER.email);
  await page.getByPlaceholder("Password").fill(OWNER.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s), as used by authenticator apps. */
export function totp(secretBase32: string, at = Date.now()) {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secretBase32.replace(/=+$/, "").toUpperCase()) {
    bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  }
  const bytes = Buffer.from(
    bits.match(/.{8}/g)?.map((b) => Number.parseInt(b, 2)) ?? [],
  );
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const hmac = createHmac("sha1", bytes).update(counter).digest();
  const offset = hmac[hmac.length - 1]! & 0xf;
  const code =
    (((hmac[offset]! & 0x7f) << 24) |
      (hmac[offset + 1]! << 16) |
      (hmac[offset + 2]! << 8) |
      hmac[offset + 3]!) %
    1_000_000;
  return code.toString().padStart(6, "0");
}

export async function expectDashboard(page: Page) {
  await expect(page).not.toHaveURL(/\/(login|onboarding|mfa)/);
  await expect(page.getByText("Find anything...").first()).toBeVisible();
}

/** True when the locator becomes visible within `ms` (isVisible() does not wait). */
export async function appears(locator: Locator, ms = 5_000) {
  return locator
    .waitFor({ state: "visible", timeout: ms })
    .then(() => true)
    .catch(() => false);
}
