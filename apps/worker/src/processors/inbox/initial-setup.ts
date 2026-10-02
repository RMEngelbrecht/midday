import { updateInboxAccount } from "@midday/db/queries";
import { triggerJob } from "@midday/job-client";
import type { Job } from "bullmq";
import {
  inboxSyncScheduler,
  upsertDynamicScheduler,
} from "../../schedulers/dynamic";
import type { InboxProviderInitialSetupPayload } from "../../schemas/inbox";
import { getDb } from "../../utils/db";
import { BaseProcessor } from "../base";

/**
 * Initial inbox setup processor
 * Registers the account's sync scheduler (every 6 hours, minute spread by
 * account id) and triggers the first full sync.
 */
export class InitialSetupProcessor extends BaseProcessor<InboxProviderInitialSetupPayload> {
  async process(job: Job<InboxProviderInitialSetupPayload>): Promise<{
    inboxAccountId: string;
    schedulerId: string;
  }> {
    const { inboxAccountId } = job.data;

    const schedulerId = await upsertDynamicScheduler(
      inboxSyncScheduler,
      inboxAccountId,
    );

    // Stored so deleting the account can remove the scheduler
    await updateInboxAccount(getDb(), {
      id: inboxAccountId,
      scheduleId: schedulerId,
    });

    await triggerJob(
      "sync-scheduler",
      { id: inboxAccountId, manualSync: true },
      "inbox-provider",
    );

    this.logger.info("Initial inbox setup completed", {
      inboxAccountId,
      schedulerId,
    });

    return { inboxAccountId, schedulerId };
  }
}
