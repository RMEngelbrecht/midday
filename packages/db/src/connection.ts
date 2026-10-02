import { ENV } from "./env";

/**
 * Database connection settings (declared in packages/db/.env.schema).
 *
 * - DATABASE_URL: primary (read/write).
 * - DATABASE_REPLICA_URLS: optional, comma-separated read replicas.
 * - DATABASE_SSL: opt-in TLS for hosted databases.
 */
export function getPrimaryDatabaseUrl(): string {
  return ENV.DATABASE_URL;
}

export function getReplicaDatabaseUrls(primaryUrl: string): string[] {
  return (ENV.DATABASE_REPLICA_URLS ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url.length > 0 && url !== primaryUrl);
}

/**
 * TLS for the pool. Off by default (compose-local Postgres); set
 * DATABASE_SSL=true for hosted databases. `sslmode` in the URL also works.
 */
export function getDatabaseSsl() {
  return ENV.DATABASE_SSL ? { rejectUnauthorized: false } : false;
}
