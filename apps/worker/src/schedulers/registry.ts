import { createLoggerWithContext } from "@midday/logger";
import type { Queue } from "bullmq";
import { getAllQueues } from "../queues";
import { staticSchedulerConfigs } from "./index";

const logger = createLoggerWithContext("scheduler");

/**
 * Get queue instance by name
 */
function getQueueByName(queueName: string): Queue {
  const queue = getAllQueues().find((q) => q.name === queueName);
  if (!queue) {
    throw new Error(`Unknown queue: ${queueName}`);
  }
  return queue;
}

/**
 * Map to track registered static schedulers
 * Key: scheduler name
 * Value: Queue instance
 */
const registeredStaticSchedulers = new Map<string, Queue>();

/**
 * Register all static schedulers on startup
 * Uses BullMQ's upsertJobScheduler API (v5.16.0+) for better deduplication
 */
export async function registerStaticSchedulers(): Promise<void> {
  logger.info("Registering static schedulers", {
    count: staticSchedulerConfigs.length,
  });

  for (const config of staticSchedulerConfigs) {
    try {
      const queue = getQueueByName(config.queue);

      // Use upsertJobScheduler for better deduplication and management
      // This ensures the scheduler is updated or created without duplications
      await queue.upsertJobScheduler(
        `scheduler:${config.name}`, // Unique scheduler ID
        {
          pattern: config.cron,
          tz: config.options?.tz ?? "UTC",
          startDate: config.options?.startDate,
          endDate: config.options?.endDate,
          limit: config.options?.limit,
        },
        {
          name: config.jobName,
          data: config.payload ?? {},
          opts: {
            // Job options can be added here if needed
          },
        },
      );

      registeredStaticSchedulers.set(config.name, queue);

      logger.info("Registered static scheduler", {
        name: config.name,
        cron: config.cron,
      });
    } catch (error) {
      logger.error("Failed to register static scheduler", {
        name: config.name,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  }

  logger.info("Successfully registered static schedulers", {
    count: registeredStaticSchedulers.size,
  });
}

/**
 * Get all registered static scheduler names
 */
export function getRegisteredStaticSchedulers(): string[] {
  return Array.from(registeredStaticSchedulers.keys());
}
