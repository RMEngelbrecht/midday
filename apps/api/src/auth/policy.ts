/**
 * Pure auth configuration decisions, kept free of env and DB access so they
 * can be unit tested. `./index.ts` applies them to ENV and the database.
 */

export type SignupPolicy = "first-user" | "invite-only" | "open";

/**
 * Whether a new account may be created.
 *
 * - open: anyone
 * - first-user: the very first account, then only invited emails
 * - invite-only: only emails with a pending team invite
 */
export function canSignUp(
  policy: SignupPolicy,
  state: { userCount: number; hasPendingInvite: boolean },
): boolean {
  switch (policy) {
    case "open":
      return true;
    case "first-user":
      return state.userCount === 0 || state.hasPendingInvite;
    case "invite-only":
      return state.hasPendingInvite;
  }
}

function isIpOrLocal(hostname: string) {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) ||
    hostname.includes(":")
  );
}

/**
 * Cookie domain the dashboard and API share, or undefined for a host-only
 * cookie. The session cookie is set by the API (API_URL) and must also reach
 * the dashboard server (APP_URL), so for app.example.com + api.example.com
 * this returns `example.com`.
 *
 * Host-only cookies already work when both run on the same host (cookies
 * ignore ports, e.g. localhost:3001 + localhost:3003) or behind one origin.
 * For multi-label public suffixes (app.example.co.uk) set AUTH_COOKIE_DOMAIN.
 */
export function deriveCookieDomain(
  appUrl: string,
  apiUrl: string,
  override?: string,
): string | undefined {
  if (override?.trim()) return override.trim().replace(/^\./, "");

  const app = new URL(appUrl).hostname;
  const api = new URL(apiUrl).hostname;

  if (app === api || isIpOrLocal(app) || isIpOrLocal(api)) return undefined;

  const appLabels = app.split(".").reverse();
  const apiLabels = api.split(".").reverse();
  const shared: string[] = [];

  for (let i = 0; i < Math.min(appLabels.length, apiLabels.length); i++) {
    if (appLabels[i] !== apiLabels[i]) break;
    shared.push(appLabels[i]!);
  }

  // A bare TLD ("com") is never a valid cookie domain.
  if (shared.length < 2) return undefined;

  return shared.reverse().join(".");
}

export type SocialProviderId = "google" | "github" | "apple" | "microsoft";

type ProviderEnv = {
  AUTH_GOOGLE_CLIENT_ID?: string;
  AUTH_GOOGLE_CLIENT_SECRET?: string;
  AUTH_GITHUB_CLIENT_ID?: string;
  AUTH_GITHUB_CLIENT_SECRET?: string;
  AUTH_APPLE_CLIENT_ID?: string;
  AUTH_APPLE_CLIENT_SECRET?: string;
  AUTH_MICROSOFT_CLIENT_ID?: string;
  AUTH_MICROSOFT_CLIENT_SECRET?: string;
  AUTH_MICROSOFT_TENANT_ID?: string;
};

type ProviderConfig = { clientId: string; clientSecret: string } & Record<
  string,
  unknown
>;

/** better-auth `socialProviders`, one entry per provider whose keys are set. */
export function socialProvidersFromEnv(
  env: ProviderEnv,
): Partial<Record<SocialProviderId, ProviderConfig>> {
  const pair = (id?: string, secret?: string) =>
    id?.trim() && secret?.trim()
      ? { clientId: id.trim(), clientSecret: secret.trim() }
      : null;

  const providers: Partial<Record<SocialProviderId, ProviderConfig>> = {};

  const google = pair(env.AUTH_GOOGLE_CLIENT_ID, env.AUTH_GOOGLE_CLIENT_SECRET);
  if (google) providers.google = { ...google, prompt: "select_account" };

  const github = pair(env.AUTH_GITHUB_CLIENT_ID, env.AUTH_GITHUB_CLIENT_SECRET);
  if (github) providers.github = github;

  const apple = pair(env.AUTH_APPLE_CLIENT_ID, env.AUTH_APPLE_CLIENT_SECRET);
  if (apple) providers.apple = apple;

  const microsoft = pair(
    env.AUTH_MICROSOFT_CLIENT_ID,
    env.AUTH_MICROSOFT_CLIENT_SECRET,
  );
  if (microsoft) {
    providers.microsoft = {
      ...microsoft,
      tenantId: env.AUTH_MICROSOFT_TENANT_ID || "common",
    };
  }

  return providers;
}
