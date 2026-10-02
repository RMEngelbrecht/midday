import { describe, expect, it } from "bun:test";
import { getEnabledApps } from "./enabled";

const apps = [
  "slack",
  "xero",
  "quickbooks",
  "fortnox",
  "gmail",
  "outlook",
  "stripe-payments",
  "whatsapp",
  "telegram",
  "sendblue",
  "cursor-mcp",
  "e-invoice",
].map((id) => ({ id }));

const ids = (list: { id: string }[]) => list.map((a) => a.id);

describe("getEnabledApps", () => {
  it("hides integrations without credentials but keeps MCP apps", () => {
    const visible = ids(getEnabledApps(apps, {}));
    for (const hidden of [
      "slack",
      "xero",
      "quickbooks",
      "fortnox",
      "gmail",
      "outlook",
      "stripe-payments",
      "whatsapp",
      "telegram",
      "sendblue",
    ]) {
      expect(visible).not.toContain(hidden);
    }
    expect(visible).toContain("cursor-mcp");
    expect(visible).toContain("e-invoice");
  });

  it("shows an integration once it is enabled", () => {
    const visible = ids(getEnabledApps(apps, { slack: true, stripe: true }));
    expect(visible).toContain("slack");
    expect(visible).toContain("stripe-payments");
    expect(visible).not.toContain("xero");
  });
});
