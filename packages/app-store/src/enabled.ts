/**
 * App id -> integration feature flag that must be enabled for the app to be
 * shown. Apps not listed (MCP instruction-only apps, desktop, e-invoice) are
 * always visible.
 */
const appFeatureKey: Record<string, string> = {
  slack: "slack",
  xero: "xero",
  quickbooks: "quickbooks",
  fortnox: "fortnox",
  gmail: "gmail",
  outlook: "outlook",
  "stripe-payments": "stripe",
  whatsapp: "whatsapp",
  telegram: "telegram",
  sendblue: "sendblue",
};

/** Active apps whose required integration env is configured. */
export function getEnabledApps<
  T extends { id: string; active?: boolean | null },
>(allApps: readonly T[], integrations: Record<string, boolean>): T[] {
  return allApps.filter((app) => {
    if (app.active === false) return false;
    const key = appFeatureKey[app.id];
    return key === undefined || integrations[key] === true;
  });
}
