import { createLoggerWithContext } from "@midday/logger";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { NodePgQueryResultHKT } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PgTransaction } from "drizzle-orm/pg-core";
import { Pool } from "pg";
import {
  getDatabaseSsl,
  getPrimaryDatabaseUrl,
  getReplicaDatabaseUrls,
} from "./env";
import { createDrizzleLogger, instrumentPool } from "./instrument";
import { withReplicas } from "./replicas";
import * as schema from "./schema";

const logger = createLoggerWithContext("db");

const isDevelopment = process.env.NODE_ENV === "development";
const DEBUG_PERF = process.env.DEBUG_PERF === "true";
const DB_POOL_EVENT_LOGGING = process.env.DB_POOL_EVENT_LOGGING === "true";

const connectionConfig = {
  max: Number(process.env.DATABASE_POOL_MAX) || (isDevelopment ? 8 : 20),
  min: isDevelopment ? 0 : 2,
  idleTimeoutMillis: isDevelopment ? 5000 : 30000,
  connectionTimeoutMillis: 5000,
  maxUses: isDevelopment ? 100 : 7500,
  allowExitOnIdle: isDevelopment,
  keepAlive: true,
  keepAliveInitialDelayMillis: 10_000,
  ssl: getDatabaseSsl(),
};

const drizzleLogger = DEBUG_PERF ? createDrizzleLogger() : undefined;

function getPgErrorDetails(error: unknown) {
  const details: Record<string, unknown> = {};

  if (error && typeof error === "object") {
    const err = error as Record<string, unknown>;
    const fields = [
      "name",
      "message",
      "code",
      "errno",
      "syscall",
      "address",
      "port",
      "stack",
    ];

    for (const field of fields) {
      if (err[field] !== undefined) {
        details[field] = err[field];
      }
    }
  } else {
    details.message = String(error);
  }

  return details;
}

function getSinglePoolStats(pool: Pool) {
  return {
    total: pool.totalCount,
    idle: pool.idleCount,
    waiting: pool.waitingCount,
  };
}

function attachPoolMonitoring(pool: Pool, poolName: "primary" | "replica") {
  pool.on("error", (err) => {
    logger.error(`${poolName} pool: idle client error`, {
      pool: poolName,
      ...getPgErrorDetails(err),
      stats: getSinglePoolStats(pool),
    });
  });

  if (!DB_POOL_EVENT_LOGGING) {
    return;
  }

  pool.on("connect", () => {
    logger.info(`${poolName} pool: client connected`, {
      pool: poolName,
      stats: getSinglePoolStats(pool),
    });
  });

  pool.on("acquire", () => {
    logger.info(`${poolName} pool: client acquired`, {
      pool: poolName,
      stats: getSinglePoolStats(pool),
    });
  });

  pool.on("remove", () => {
    logger.info(`${poolName} pool: client removed`, {
      pool: poolName,
      stats: getSinglePoolStats(pool),
    });
  });
}

const primaryUrl = getPrimaryDatabaseUrl();

const primaryPool = new Pool({
  connectionString: primaryUrl,
  ...connectionConfig,
});

if (DEBUG_PERF) instrumentPool(primaryPool, "primary");
attachPoolMonitoring(primaryPool, "primary");

export const primaryDb = drizzle(primaryPool, {
  schema,
  casing: "snake_case",
  logger: drizzleLogger,
});

// Optional read replicas from DATABASE_REPLICA_URLS; reads use the primary
// when none are configured.
const replicaPools = getReplicaDatabaseUrls(primaryUrl).map((url) => {
  const pool = new Pool({ connectionString: url, ...connectionConfig });
  if (DEBUG_PERF) instrumentPool(pool, "replica");
  attachPoolMonitoring(pool, "replica");
  return pool;
});

const replicaDbs = replicaPools.map((pool) =>
  drizzle(pool, { schema, casing: "snake_case", logger: drizzleLogger }),
);

export const db = withReplicas(
  primaryDb,
  replicaDbs.length > 0
    ? [replicaDbs[0]!, ...replicaDbs.slice(1)]
    : [primaryDb],
);

export const connectDb = async () => {
  return db;
};

export type Database = Awaited<ReturnType<typeof connectDb>>;

export type TransactionClient = PgTransaction<
  NodePgQueryResultHKT,
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;

/** Use in query functions that should work both standalone and within transactions */
export type DatabaseOrTransaction = Database | TransactionClient;

export type DatabaseWithPrimary = Database & {
  $primary?: Database;
  usePrimaryOnly?: () => Database;
};

const poolStats = (pool: Pool) => ({
  total: pool.totalCount,
  idle: pool.idleCount,
  waiting: pool.waitingCount,
});

export function getPoolStats() {
  return {
    primary: poolStats(primaryPool),
    replicas: replicaPools.map(poolStats),
  };
}

/**
 * Close all database pools gracefully
 */
export const closeDb = async (): Promise<void> => {
  await Promise.all([primaryPool.end(), ...replicaPools.map((p) => p.end())]);
};
