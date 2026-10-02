/**
 * Applies pending migrations from packages/db/migrations.
 *
 * Safe to run on every api container start: drizzle records applied
 * migrations in drizzle.__drizzle_migrations, and a Postgres advisory lock
 * keeps concurrent starts from racing each other.
 *
 *   DATABASE_URL=postgres://... bun run migrate   (src/scripts/migrate.ts)
 */
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Client } from "pg";
import { getDatabaseSsl, getPrimaryDatabaseUrl } from "./env";

// Arbitrary constant shared by every migrator process.
const MIGRATION_LOCK_ID = 727_001;

const migrationsFolder = path.join(__dirname, "../migrations");

export async function runMigrations(
  connectionString = getPrimaryDatabaseUrl(),
) {
  const client = new Client({ connectionString, ssl: getDatabaseSsl() });
  await client.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1)", [MIGRATION_LOCK_ID]);
    await migrate(drizzle(client), { migrationsFolder });
  } finally {
    await client
      .query("SELECT pg_advisory_unlock($1)", [MIGRATION_LOCK_ID])
      .catch(() => {});
    await client.end();
  }
}
