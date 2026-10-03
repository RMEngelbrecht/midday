import { getConfig } from "../config/store.js";

export function isTTY(): boolean {
  return Boolean(process.stdout.isTTY);
}

export function isCI(): boolean {
  return Boolean(
    process.env.CI || process.env.GITHUB_ACTIONS || process.env.GITLAB_CI,
  );
}

export function hasNoColor(): boolean {
  return Boolean(process.env.NO_COLOR);
}

export function isAgentMode(flags: {
  json?: boolean;
  agent?: boolean;
  quiet?: boolean;
}): boolean {
  if (flags.agent || flags.json) return true;
  if (!isTTY()) return true;
  return false;
}

export function shouldShowUI(flags: {
  json?: boolean;
  agent?: boolean;
  quiet?: boolean;
}): boolean {
  if (flags.quiet || flags.agent || flags.json) return false;
  if (!isTTY()) return false;
  if (isCI()) return false;
  return true;
}

/** Resolution order: environment variable, then `~/.config/midday/config.json`
 * (written by `midday auth login --server`), then a local development default. */
export function getApiUrl(): string {
  return (
    process.env.MIDDAY_API_URL || getConfig().apiUrl || "http://localhost:3003"
  );
}

export function getDashboardUrl(): string {
  if (process.env.MIDDAY_DASHBOARD_URL) {
    return process.env.MIDDAY_DASHBOARD_URL;
  }
  const configured = getConfig().appUrl;
  if (configured && !process.env.MIDDAY_API_URL) {
    return configured;
  }
  const apiUrl = getApiUrl();
  if (apiUrl.includes("localhost") || apiUrl.includes("127.0.0.1")) {
    return "http://localhost:3000";
  }
  return apiUrl.replace("api.", "app.");
}
