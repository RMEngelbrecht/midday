import { describe, expect, it } from "bun:test";
import { isAIEnabled } from "@midday/ai";
import { DocumentClient } from "./client";
import { Embed } from "./embed/embed";
import { lookupDomainByCompanyName } from "./utils/domain-lookup";

// Runs under APP_ENV=test, which sets no AI env.
describe("with no AI configured", () => {
  it("reports AI as disabled", () => {
    expect(isAIEnabled()).toBe(false);
  });

  it("marks documents processed with no extracted fields", async () => {
    const result = await new DocumentClient().getInvoiceOrReceipt({
      documentUrl: "http://localhost/none.pdf",
      mimetype: "application/pdf",
    });
    expect(result).toEqual({ type: "invoice", document_type: "invoice" });
  });

  it("skips domain lookup", async () => {
    expect(await lookupDomainByCompanyName("Acme Inc")).toBeNull();
  });

  it("fails embedding with a clear error", async () => {
    await expect(new Embed().embed("x")).rejects.toThrow(
      /AI is not configured|No embedding model/,
    );
  });
});
