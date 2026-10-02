/**
 * Configuration for static schedulers (fixed schedule, registered on startup)
 */
export interface StaticSchedulerConfig {
  /** Unique name for the scheduler */
  name: string;
  /** Queue name where the job will be enqueued */
  queue: string;
  /** Cron pattern (e.g., "0 2 * * *" for daily at 2 AM) */
  cron: string;
  /** Job name to trigger */
  jobName: string;
  /** Default payload for the job */
  payload?: unknown;
  /** Optional BullMQ repeat options */
  options?: {
    tz?: string; // Timezone (default: UTC)
    startDate?: Date | number; // Start date
    endDate?: Date | number; // End date
    limit?: number; // Maximum number of repetitions
  };
}
