import type { StaticSchedulerConfig } from "../types/scheduler-config";

/**
 * Static scheduler configurations for banking.
 * Per-team sync schedulers are dynamic (see ./dynamic.ts); this daily job
 * reconciles them with the teams that have bank connections.
 */
export const bankingStaticSchedulers: StaticSchedulerConfig[] = [
  {
    name: "ensure-bank-schedulers",
    queue: "banking",
    cron: "0 3 * * *",
    jobName: "ensure-bank-schedulers",
    payload: {},
    options: {
      tz: "UTC",
    },
  },
];
