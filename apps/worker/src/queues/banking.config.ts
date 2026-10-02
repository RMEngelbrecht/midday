import { createLoggerWithContext } from "@midday/logger";
import type { QueueOptions, WorkerOptions } from "bullmq";
import { getRedisConnection } from "../config";
import type { QueueConfig } from "../types/queue-config";

const logger = createLoggerWithContext("worker:queue:banking");

/**
 * Bank provider jobs get two attempts
 * (provider errors are rarely fixed by hammering the API).
 */
const bankingQueueOptions: QueueOptions = {
  connection: getRedisConnection(),
  defaultJobOptions: {
    attempts: 2,
    backoff: {
      type: "exponential",
      delay: 5000,
    },
    removeOnComplete: {
      age: 24 * 3600,
      count: 1000,
    },
    removeOnFail: {
      age: 7 * 24 * 3600,
    },
  },
};

/**
 * Concurrency 10 keeps provider calls modest (Plaid/GoCardless rate limits).
 * Manual syncs run every account of a connection inline, so the lock is long.
 */
const bankingWorkerOptions: WorkerOptions = {
  connection: getRedisConnection(),
  concurrency: 10,
  lockDuration: 10 * 60 * 1000,
  stalledInterval: 11 * 60 * 1000,
  maxStalledCount: 1,
};

/**
 * Banking queue configuration
 * Jobs: initial-bank-setup, sync-connection, sync-account, bank-sync-scheduler,
 * ensure-bank-schedulers, reconnect-connection, delete-connection,
 * transaction-notifications
 */
export const bankingQueueConfig: QueueConfig = {
  name: "banking",
  queueOptions: bankingQueueOptions,
  workerOptions: bankingWorkerOptions,
  eventHandlers: {
    onCompleted: (job) => {
      logger.info("Job completed", { jobName: job.name, jobId: job.id });
    },
    onFailed: (job, err) => {
      logger.error("Job failed", {
        jobName: job?.name,
        jobId: job?.id,
        error: err.message,
      });
    },
  },
};
