import type { StaticSchedulerConfig } from "../types/scheduler-config";
import { bankingStaticSchedulers } from "./banking.config";
import { inboxStaticSchedulers } from "./inbox.config";
import { insightsStaticSchedulers } from "./insights.config";
import { institutionsStaticSchedulers } from "./institutions.config";
import { invoicesStaticSchedulers } from "./invoices.config";
import { notificationsStaticSchedulers } from "./notifications.config";
import { ratesStaticSchedulers } from "./rates.config";

/**
 * All static scheduler configurations
 * Add new static scheduler configs here to automatically register them
 */
export const staticSchedulerConfigs: StaticSchedulerConfig[] = [
  ...inboxStaticSchedulers,
  ...institutionsStaticSchedulers,
  ...invoicesStaticSchedulers,
  ...notificationsStaticSchedulers,
  ...ratesStaticSchedulers,
  ...insightsStaticSchedulers,
  ...bankingStaticSchedulers,
];
