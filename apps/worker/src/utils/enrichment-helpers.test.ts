import { describe, expect, test } from "bun:test";
import { prepareUpdateData } from "./enrichment-helpers";

const categories = {
  allowed: new Set(["software", "travel"]),
  hasUncategorized: true,
};

const result = (category: string | null, categoryConfidence = 0.9) => ({
  merchant: "Figma Inc",
  merchantConfidence: 0.9,
  category,
  categoryConfidence,
});

describe("prepareUpdateData", () => {
  test("history wins over the AI's category", () => {
    expect(
      prepareUpdateData(
        { categorySlug: null, merchantName: null, amount: -12 },
        result("travel"),
        categories,
        "software",
      ),
    ).toEqual({ merchantName: "Figma Inc", categorySlug: "software" });
  });

  test("history categorises incoming money, which the AI leaves alone", () => {
    expect(
      prepareUpdateData(
        { categorySlug: null, merchantName: null, amount: 1500 },
        result(null),
        categories,
        "consulting-revenue",
      ).categorySlug,
    ).toBe("consulting-revenue");
    expect(
      prepareUpdateData(
        { categorySlug: null, merchantName: null, amount: 1500 },
        result(null),
        categories,
      ).categorySlug,
    ).toBeUndefined();
  });

  test("an existing category is never replaced", () => {
    expect(
      prepareUpdateData(
        { categorySlug: "travel", merchantName: null, amount: -12 },
        result("software"),
        categories,
        "software",
      ).categorySlug,
    ).toBeUndefined();
  });

  test("without history the AI's confident, allowed answer is used", () => {
    expect(
      prepareUpdateData(
        { categorySlug: null, merchantName: null, amount: -12 },
        result("travel"),
        categories,
        null,
      ).categorySlug,
    ).toBe("travel");
    expect(
      prepareUpdateData(
        { categorySlug: null, merchantName: null, amount: -12 },
        result("rent"),
        categories,
        null,
      ).categorySlug,
    ).toBe("uncategorized");
  });
});
