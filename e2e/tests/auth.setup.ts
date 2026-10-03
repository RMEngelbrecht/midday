import { expect, test as setup } from "@playwright/test";
import { expectDashboard, hydrated, OWNER, signIn } from "./helpers";

const COMPANY = "E2E Company";

setup("sign up the first user and create the team", async ({ page }) => {
  // First run: "Create account" works because ALLOW_SIGNUP=first-user lets
  // the first user in. Later runs against the same stack sign in instead.
  await page.goto("/login");
  await hydrated(page);
  await page.getByRole("button", { name: /Create an account/ }).click();
  await page.getByPlaceholder("Full name").fill(OWNER.name);
  await page.getByPlaceholder("Email address").fill(OWNER.email);
  await page.getByPlaceholder("Password").fill(OWNER.password);
  await page.getByRole("button", { name: "Create account" }).click();

  const exists = page.getByText(/already exists/i);
  const landed = page.waitForURL((url) => !url.pathname.startsWith("/login"));
  await Promise.race([exists.waitFor(), landed]);
  if (await exists.isVisible()) await signIn(page);
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));

  // Onboarding: create the team, then skip the optional steps.
  if (page.url().includes("/onboarding")) {
    await hydrated(page);
    await page.getByPlaceholder(/Acme Marketing/).fill(COMPANY);
    for (const choice of ["Freelancer / Consultant", "GitHub"]) {
      await page.getByText("Select one").first().click();
      await page.getByRole("option", { name: choice }).click();
    }
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText("Connect your bank").first()).toBeVisible();

    for (let i = 0; i < 8 && page.url().includes("/onboarding"); i++) {
      const next = page
        .getByRole("button", { name: /^(Skip for now|Next|Finish)$/ })
        .first();
      await next.click();
      await page.waitForTimeout(1_000);
    }
  }

  await expectDashboard(page);
  await page.context().storageState({ path: ".auth/owner.json" });
});
