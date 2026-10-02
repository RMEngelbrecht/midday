import { ENV } from "../env";

/**
 * Environment utility functions, based on APP_ENV.
 */

/** Production enables scheduled maintenance jobs (rates, institutions, ...). */
export function isProduction(): boolean {
  return ENV.APP_ENV === "production";
}

export function isStaging(): boolean {
  return ENV.APP_ENV === "staging";
}

/**
 * Check if the worker is running in a non-production environment
 * Useful for skipping scheduled tasks or enabling debug features
 */
export function isDevelopment(): boolean {
  return !isProduction();
}
