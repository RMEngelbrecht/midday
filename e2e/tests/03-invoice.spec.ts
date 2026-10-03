import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures";
import { appears, hydrated, MAILPIT_URL } from "./helpers";

const customerEmail = `customer-${Date.now()}@example.com`;
const customerName = `E2E Customer ${Date.now()}`;

/**
 * Fill a field that sits under a label. The rich-text editors have no
 * accessible name, so click just below the label and replace what is there
 * (the sheet pre-fills "From" from the previous invoice).
 */
async function typeBelow(page: Page, label: string, text: string) {
  const box = await page
    .getByText(label, { exact: true })
    .first()
    .boundingBox();
  if (!box) throw new Error(`label "${label}" not visible`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height + 16);
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type(text);
}

test.describe("invoices", () => {
  let invoiceLink = "";
  let invoiceNumber = "";

  test("creates and sends an invoice", async ({ page }) => {
    await page.goto("/invoices?invoiceType=create");
    await hydrated(page);

    // Customer: created inline from the invoice sheet.
    await page.getByText("Select customer").click();
    // With no customers yet the create form opens straight away; otherwise
    // the picker lists them with a "Create customer" action.
    const create = page.getByText(/^Create customer$/i);
    if (await appears(create, 3_000)) {
      await create.click();
    }
    await page.getByPlaceholder("Acme Inc").fill(customerName);
    await page.getByPlaceholder("acme@example.com").fill(customerEmail);
    await page
      .getByRole("button", { name: "Create", exact: true })
      .last()
      .click();
    await expect(page.getByText(customerEmail).first()).toBeVisible();

    await typeBelow(page, "From", "E2E Studio");
    await typeBelow(page, "Description", "Consulting services");
    await typeBelow(page, "Quantity", "2");
    const draftSaved = page.waitForResponse(
      (r) => r.url().includes("invoice.draft") && r.ok(),
    );
    await typeBelow(page, "Price", "150");
    // The sheet autosaves the draft; submitting before that lands would fail
    // with "Invoice not found" because the invoice does not exist yet.
    await draftSaved;
    await expect(page.getByText("Saved", { exact: true })).toBeVisible();
    await expect(page.getByText(/300\.00/).first()).toBeVisible();

    invoiceNumber =
      (
        await page
          .getByText(/^INV-\d+$/)
          .first()
          .textContent()
      )?.trim() ?? "";
    expect(invoiceNumber).toMatch(/^INV-\d+$/);

    // The split button remembers the last choice; make sure it is "Create & Send".
    const submit = page.getByRole("button", { name: /^Create( & Send)?$/ });
    if ((await submit.textContent())?.trim() !== "Create & Send") {
      await submit.locator("xpath=following-sibling::button").click();
      await page.getByRole("menu").getByText("Create & Send").click();
    }
    await page.getByRole("button", { name: "Create & Send" }).click();

    await expect(page.getByText(/sent|created/i).first()).toBeVisible();
    await page.goto("/invoices");
    const row = page.getByRole("row").filter({ hasText: invoiceNumber });
    await expect(row).toBeVisible();
    await expect(row.getByText(/Unpaid|Sent|Draft/)).toBeVisible();
  });

  test("the invoice email reaches the SMTP sink", async ({ request }) => {
    test.skip(!MAILPIT_URL, "set E2E_MAILPIT_URL (compose profile `dev`)");
    await expect
      .poll(
        async () => {
          const res = await request.get(
            `${MAILPIT_URL}/api/v1/search?query=${encodeURIComponent(`to:${customerEmail}`)}`,
          );
          return (await res.json()).messages_count as number;
        },
        { timeout: 60_000, message: "invoice email in Mailpit" },
      )
      .toBeGreaterThan(0);
  });

  test("the public invoice link opens without signing in", async ({
    page,
    browser,
  }) => {
    await page.goto("/invoices");
    await hydrated(page);
    await page.getByText(invoiceNumber, { exact: true }).first().click();
    const link = page.getByText(/\/i\/ey[\w.-]+/).first();
    await expect(link).toBeVisible();
    invoiceLink = (await link.textContent())?.trim() ?? "";
    expect(invoiceLink).toContain("/i/");

    // A fresh context has no session: this is what the customer sees.
    const anonymous = await browser.newContext({ storageState: undefined });
    const publicPage = await anonymous.newPage();
    await publicPage.goto(invoiceLink);
    await expect(publicPage.getByText(invoiceNumber).first()).toBeVisible();
    await expect(publicPage.getByText("Consulting services")).toBeVisible();
    await expect(publicPage.getByText("E2E Studio")).toBeVisible();
    await anonymous.close();
  });
});
