import { expect, test } from "./fixtures";
import {
  appears,
  expectDashboard,
  hydrated,
  OWNER,
  signIn,
  totp,
} from "./helpers";

test("enables TOTP and signs in again with a code", async ({
  page,
  browser,
}) => {
  // Capture the shared secret from the enrollment response (what the QR encodes).
  let secret = "";
  page.on("response", async (response) => {
    if (!response.url().includes("/auth/two-factor/enable")) return;
    const uri = (await response.json().catch(() => null))?.totpURI;
    if (uri) secret = new URL(uri).searchParams.get("secret") ?? secret;
  });

  await page.goto("/account/security");
  await hydrated(page);
  await page.getByRole("button", { name: "Enable MFA" }).click();

  // Password accounts confirm the password first.
  const password = page.getByPlaceholder("Password");
  if (await appears(password, 10_000)) {
    await password.fill(OWNER.password);
    await page.getByRole("button", { name: "Continue" }).click();
  }
  await expect.poll(() => secret, { timeout: 15_000 }).not.toBe("");
  await expect(page.getByRole("img", { name: "qr" })).toBeVisible();

  await page.keyboard.type(totp(secret));
  await expect(page.getByText("Authenticator app")).toBeVisible();
  await expect(page.getByText("Verified", { exact: true })).toBeVisible();

  // A new browser context has no session: password first, then the TOTP challenge.
  const fresh = await browser.newContext({ storageState: undefined });
  const login = await fresh.newPage();
  await signIn(login);
  await expect(login).toHaveURL(/\/mfa\/verify/);
  await hydrated(login);
  // Codes are single-use per 30 s window in some setups; use the next window if needed.
  await login.keyboard.type(totp(secret, Date.now() + 30_000));
  await expect(login).not.toHaveURL(/\/(login|mfa)/, { timeout: 30_000 });
  await expectDashboard(login);
  await fresh.close();
});
