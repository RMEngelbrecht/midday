import { ENV } from "./env";

/** Public URL of the dashboard (APP_URL). Server-side only. */
export function getAppUrl() {
  return ENV.APP_URL;
}

/** Public URL of the API (API_URL). Server-side only. */
export function getApiUrl() {
  return ENV.API_URL;
}

/** Base URL for assets referenced from emails (logos, images). */
export function getEmailUrl() {
  return ENV.APP_URL;
}

/** Base URL for static assets. Served by the dashboard until S9 bundles them. */
export function getCdnUrl() {
  return ENV.APP_URL;
}
