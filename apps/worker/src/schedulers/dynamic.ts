import { createLoggerWithContext } from "@midday/logger";
import type { Queue, RepeatOptions } from "bullmq";
import { bankingQueue } from "../queues/banking";
import { inboxProviderQueue } from "../queues/inbox";
import {
  generateCronTag,
  generateQuarterDailyCronTag,
} from "../utils/generate-cron-tag";

const logger = createLoggerWithContext("scheduler:dynamic");

/**
 * A family of per-entity job schedulers (one per team, one per inbox account).
 * Scheduler ids are `${prefix}${key}`, so Redis is the only source of truth:
 * create, remove and reconcile are all idempotent and need no local state.
 */
export type DynamicScheduler = {
  prefix: string;
  queue: () => Queue;
  /** Cron pattern for a key; spread deterministically to avoid load spikes. */
  pattern: (key: string) => string;
  jobName: string;
  data: (key: string) => Record<string, unknown>;
};

/** Daily bank sync per team, fanned out to its connections. */
export const bankSyncScheduler: DynamicScheduler = {
  prefix: "bank-sync:",
  queue: () => bankingQueue,
  pattern: generateCronTag,
  jobName: "bank-sync-scheduler",
  data: (teamId) => ({ teamId }),
};

/** Inbox provider sync every 6 hours per inbox account. */
export const inboxSyncScheduler: DynamicScheduler = {
  prefix: "inbox-sync:",
  queue: () => inboxProviderQueue,
  pattern: generateQuarterDailyCronTag,
  jobName: "sync-scheduler",
  data: (accountId) => ({ id: accountId, manualSync: false }),
};

export function getSchedulerId(scheduler: DynamicScheduler, key: string) {
  return `${scheduler.prefix}${key}`;
}

/**
 * Create or update the scheduler for a key. `repeat` overrides the default
 * cron pattern (tests use `{ every }`).
 */
export async function upsertDynamicScheduler(
  scheduler: DynamicScheduler,
  key: string,
  repeat?: RepeatOptions,
): Promise<string> {
  const id = getSchedulerId(scheduler, key);

  await scheduler
    .queue()
    .upsertJobScheduler(
      id,
      repeat ?? { pattern: scheduler.pattern(key), tz: "UTC" },
      { name: scheduler.jobName, data: scheduler.data(key) },
    );

  return id;
}

export async function removeDynamicScheduler(
  scheduler: DynamicScheduler,
  key: string,
): Promise<boolean> {
  return scheduler.queue().removeJobScheduler(getSchedulerId(scheduler, key));
}

export async function listDynamicSchedulerKeys(
  scheduler: DynamicScheduler,
): Promise<string[]> {
  const keys: string[] = [];
  const pageSize = 500;

  for (let start = 0; ; start += pageSize) {
    const page = await scheduler
      .queue()
      .getJobSchedulers(start, start + pageSize - 1, true);

    for (const entry of page) {
      if (entry.key.startsWith(scheduler.prefix)) {
        keys.push(entry.key.slice(scheduler.prefix.length));
      }
    }

    if (page.length < pageSize) break;
  }

  return keys;
}

/** Keys that have a scheduler but should not. */
export function findOrphanKeys(
  desired: Iterable<string>,
  existing: Iterable<string>,
): string[] {
  const wanted = new Set(desired);
  return [...new Set(existing)].filter((key) => !wanted.has(key));
}

/**
 * Converge Redis to exactly one scheduler per desired key: upsert all desired
 * (cheap, and repairs drifted patterns) and remove orphans.
 */
export async function reconcileDynamicSchedulers(
  scheduler: DynamicScheduler,
  desiredKeys: string[],
): Promise<{ upserted: number; removed: number; failed: number }> {
  const existing = await listDynamicSchedulerKeys(scheduler);
  const orphans = findOrphanKeys(desiredKeys, existing);

  let upserted = 0;
  let removed = 0;
  let failed = 0;

  for (const key of desiredKeys) {
    try {
      await upsertDynamicScheduler(scheduler, key);
      upserted++;
    } catch (error) {
      failed++;
      logger.error("Failed to upsert scheduler", {
        prefix: scheduler.prefix,
        key,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  for (const key of orphans) {
    if (await removeDynamicScheduler(scheduler, key)) removed++;
  }

  logger.info("Reconciled schedulers", {
    prefix: scheduler.prefix,
    desired: desiredKeys.length,
    existing: existing.length,
    upserted,
    removed,
    failed,
  });

  return { upserted, removed, failed };
}
