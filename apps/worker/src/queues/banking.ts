import { Queue } from "bullmq";
import { bankingQueueConfig } from "./banking.config";

/**
 * Banking queue instance
 * Configuration is defined in banking.config.ts
 */
export const bankingQueue = new Queue(
  "banking",
  bankingQueueConfig.queueOptions,
);
