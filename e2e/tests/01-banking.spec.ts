import { expect, test } from "./fixtures";
import { fixture, hydrated } from "./helpers";

const stamp = Date.now();
const CSV_ACCOUNT = `E2E CSV ${stamp}`;
const OFX_ACCOUNT = `E2E OFX ${stamp}`;

async function openImport(page: import("@playwright/test").Page) {
  await page.goto("/transactions?step=import&hide=true");
  await hydrated(page);
  await expect(page.getByText("Drop your file here")).toBeVisible();
}

// The statement/CSV dialog has two file inputs on the page (receipts too).
const statementInput = (page: import("@playwright/test").Page) =>
  page.locator('input[type="file"]:not(#upload-transaction-files)');

async function createAccountInDialog(
  page: import("@playwright/test").Page,
  name: string,
) {
  await page.getByText("Select account").first().click();
  await page.getByPlaceholder("Select or create account").fill(name);
  await page
    .getByText(new RegExp(`Create .*${name}`))
    .first()
    .click();
}

test.describe("bank accounts and file import", () => {
  test("creates a manual account while importing a CSV", async ({ page }) => {
    await openImport(page);
    await statementInput(page).setInputFiles(fixture("transactions.csv"));

    // Column mapping is detected from the header row.
    await expect(
      page.getByRole("button", { name: "Confirm import" }),
    ).toBeVisible();
    await createAccountInDialog(page, CSV_ACCOUNT);
    await page.getByRole("button", { name: "Confirm import" }).click();

    await expect(page).toHaveURL(/\/transactions/);
    await expect(page.getByText("Coffee Shop Berlin").first()).toBeVisible();
    await expect(page.getByText("Cloud Hosting").first()).toBeVisible();
    await expect(
      page.getByText(/Client Payment Inv 1001/).first(),
    ).toBeVisible();
  });

  test("imports an OFX statement into a new account", async ({ page }) => {
    await openImport(page);
    await statementInput(page).setInputFiles(fixture("statement.ofx"));

    await expect(page.getByText(/Account in file/)).toBeVisible();
    await createAccountInDialog(page, OFX_ACCOUNT);
    await page.getByRole("button", { name: "Confirm import" }).click();

    await expect(page.getByText("Train ticket").first()).toBeVisible();
    await expect(page.getByText("Consulting retainer").first()).toBeVisible();
  });

  test("lists both accounts under Bank Connections", async ({ page }) => {
    await page.goto("/settings/accounts");
    await expect(page.getByText(CSV_ACCOUNT)).toBeVisible();
    await expect(page.getByText(OFX_ACCOUNT)).toBeVisible();
  });

  test("no AI: transactions are not stuck in an 'Analyzing' state", async ({
    page,
  }) => {
    test.skip(!!process.env.E2E_AI, "AI enabled: enrichment is expected");
    await page.goto("/transactions");
    await expect(page.getByText("Coffee Shop Berlin").first()).toBeVisible();
    await expect(page.getByText("Analyzing")).toHaveCount(0);
  });
});
