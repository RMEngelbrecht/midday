import { expect, test } from "./fixtures";
import { hydrated, uniqueUpload } from "./helpers";

test.describe("inbox", () => {
  test("a receipt uploaded in one tab appears in another without a reload (realtime)", async ({
    context,
  }) => {
    const watcher = await context.newPage();
    const uploader = await context.newPage();
    const receipt = uniqueUpload("receipt.pdf", "receipt");

    await watcher.goto("/inbox");
    await hydrated(watcher);
    // Proves the page is not reloaded later: the marker lives in this document.
    await watcher.evaluate(() => {
      (window as unknown as { __e2e: number }).__e2e = 1;
    });

    await uploader.goto("/inbox");
    await hydrated(uploader);
    await uploader.locator('input[type="file"]').first().setInputFiles(receipt);

    // SSE (/realtime) pushes the new row into the other tab's list.
    await expect(watcher.getByText(receipt.name).first()).toBeVisible({
      timeout: 30_000,
    });
    expect(
      await watcher.evaluate(
        () => (window as unknown as { __e2e?: number }).__e2e,
      ),
    ).toBe(1);

    await watcher.close();
    await uploader.close();
  });

  test("a receipt can be matched to a transaction by hand (no AI needed)", async ({
    page,
  }) => {
    const receipt = uniqueUpload("receipt.pdf", "match");
    await page.goto("/inbox");
    await hydrated(page);
    await page.locator('input[type="file"]').first().setInputFiles(receipt);
    await page.getByText(receipt.name).first().click();

    const search = page.getByPlaceholder("Select a transaction");
    await expect(search).toBeVisible();
    await search.click();
    await search.fill("Coffee Shop");
    await page.getByText("Coffee Shop Berlin").last().click();

    // The receipt is now attached to the transaction.
    await page.goto("/transactions");
    await hydrated(page);
    // Re-runs against one stack leave older duplicates behind, so look for
    // any "Coffee Shop Berlin" row that now has a receipt.
    const rows = page
      .getByRole("row")
      .filter({ hasText: "Coffee Shop Berlin" });
    await expect(rows.first()).toBeVisible();
    await expect(
      rows.filter({ hasNotText: "No receipt" }).first(),
    ).toBeVisible();
  });
});
