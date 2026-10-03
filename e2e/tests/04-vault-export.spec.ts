import { expect, test } from "./fixtures";
import { hydrated, uniqueUpload } from "./helpers";

test.describe("vault and export", () => {
  test("uploaded files show in the vault and download", async ({ page }) => {
    const file = uniqueUpload("receipt.pdf", "vault");
    await page.goto("/vault");
    await hydrated(page);
    await page.locator('input[type="file"]').first().setInputFiles(file);
    await expect(page.getByText(file.name).first()).toBeVisible();

    // Open the document and download it through the API's file route.
    await page.getByText(file.name).first().click();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download" }).first().click();
    const saved = await download;
    expect(saved.suggestedFilename()).toContain(".pdf");
    const stream = await saved.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    expect(Buffer.concat(chunks).subarray(0, 4).toString()).toBe("%PDF");
  });

  test("an export of all data completes and can be downloaded", async ({
    page,
  }) => {
    await page.goto("/settings");
    await hydrated(page);
    await page.getByRole("button", { name: "Export", exact: true }).click();

    // The worker builds the ZIP; a toast offers the download when it is done.
    const done = page.getByRole("button", { name: "Download" }).first();
    await expect(done).toBeVisible({ timeout: 90_000 });
    const download = page.waitForEvent("download");
    await done.click();
    const saved = await download;
    expect(saved.suggestedFilename()).toMatch(/\.zip$/);
  });
});
