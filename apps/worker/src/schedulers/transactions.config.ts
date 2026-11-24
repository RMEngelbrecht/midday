import type { StaticSchedulerConfig } from "../types/scheduler-config";

/**
 * Static scheduler configurations for transactions
 */
export const transactionsStaticSchedulers: StaticSchedulerConfig[] = [
  {
    name: "enrich-transactions-scheduler",
    queue: "transactions",
    cron: "*/15 * * * *", // Every 15 minutes
    jobName: "enrich-transactions-scheduler",
    payload: {},
    options: {
      tz: "UTC",
    },
  },
];
