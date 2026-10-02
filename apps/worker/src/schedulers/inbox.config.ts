import { ENV } from "../env";
import type { StaticSchedulerConfig } from "../types/scheduler-config";

/**
 * Static scheduler configurations for inbox
 * These run on fixed schedules and are registered on startup.
 * Per-account sync schedulers are dynamic (see ./dynamic.ts).
 */
export const inboxStaticSchedulers: StaticSchedulerConfig[] = [
  {
    name: "no-match-scheduler",
    queue: "inbox",
    cron: "0 2 * * *", // Daily at 2 AM UTC
    jobName: "no-match-scheduler",
    payload: {},
    options: {
      tz: "UTC",
    },
  },
  {
    // Upserts a sync scheduler per inbox account and removes orphans
    name: "ensure-inbox-schedulers",
    queue: "inbox-provider",
    cron: "15 3 * * *",
    jobName: "ensure-inbox-schedulers",
    payload: {},
    options: {
      tz: "UTC",
    },
  },
  // Optional: poll an IMAP mailbox for inbound email.
  ...(ENV.IMAP_URL
    ? [
        {
          name: "imap-poll",
          queue: "inbox",
          cron: `*/${Math.max(1, Math.floor(ENV.IMAP_POLL_INTERVAL ?? 5))} * * * *`,
          jobName: "imap-poll",
          payload: {},
          options: {
            tz: "UTC",
          },
        },
      ]
    : []),
];
