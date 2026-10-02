/**
 * Database connection settings.
 *
 * - DATABASE_URL: primary (read/write). DATABASE_PRIMARY_URL is accepted as a
 *   legacy alias.
 * - DATABASE_REPLICA_URLS: optional, comma-separated read replicas.
 */
export function getPrimaryDatabaseUrl(): string {
  const url = process.env.DATABASE_URL || process.env.DATABASE_PRIMARY_URL;
  if (!url) {
    throw new Error("Missing database connection string: set DATABASE_URL");
  }
  return url;
}

export function getReplicaDatabaseUrls(primaryUrl: string): string[] {
  return (process.env.DATABASE_REPLICA_URLS ?? "")
    .split(",")
    .map((url) => url.trim())
    .filter((url) => url.length > 0 && url !== primaryUrl);
}

/**
 * TLS for the pool. Off by default (compose-local Postgres); set
 * DATABASE_SSL=true for hosted databases. `sslmode` in the URL also works.
 */
export function getDatabaseSsl() {
  return process.env.DATABASE_SSL === "true"
    ? { rejectUnauthorized: false }
    : false;
}
