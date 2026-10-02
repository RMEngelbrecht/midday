import { getInboxAccountIdsForScheduling } from "@midday/db/queries";
import type { Job } from "bullmq";
import {
  inboxSyncScheduler,
  reconcileDynamicSchedulers,
} from "../../schedulers/dynamic";
import { getDb } from "../../utils/db";
import { BaseProcessor } from "../base";

/**
 * Daily reconcile: every connected inbox account has a sync scheduler, and
 * schedulers of deleted or disconnected accounts are removed.
 */
export class EnsureInboxSchedulersProcessor extends BaseProcessor<
  Record<string, never>
> {
  async process(_job: Job<Record<string, never>>) {
    const accounts = await getInboxAccountIdsForScheduling(getDb());

    return reconcileDynamicSchedulers(
      inboxSyncScheduler,
      accounts.map((account) => account.id),
    );
  }
}
