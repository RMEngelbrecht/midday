import { triggerJob } from "@midday/job-client";
import type { Job } from "bullmq";
import {
  bankSyncScheduler,
  upsertDynamicScheduler,
} from "../../schedulers/dynamic";
import {
  type InitialBankSetupPayload,
  initialBankSetupSchema,
} from "../../schemas/banking";
import { getDb } from "../../utils/db";
import { BaseProcessor } from "../base";
import { type SyncConnectionResult, syncConnection } from "./sync";

/** Providers can take a few minutes to make the full history available. */
const FOLLOW_UP_SYNC_DELAY_MS = 5 * 60_000;

/**
 * Runs after a bank connection is created: registers the team's daily sync
 * scheduler and imports the connection's accounts. The dashboard polls this
 * job, so it only completes once the first sync is done.
 */
export class InitialBankSetupProcessor extends BaseProcessor<InitialBankSetupPayload> {
  protected override getPayloadSchema() {
    return initialBankSetupSchema;
  }

  async process(
    job: Job<InitialBankSetupPayload>,
  ): Promise<SyncConnectionResult> {
    const { teamId, connectionId } = job.data;

    const schedulerId = await upsertDynamicScheduler(bankSyncScheduler, teamId);
    this.logger.info("Bank sync scheduler registered", { teamId, schedulerId });

    await this.updateProgress(job, 10, "Syncing accounts", "syncing");

    const result = await syncConnection(
      getDb(),
      { connectionId, manualSync: true },
      this.logger,
    );

    // Second pass once the provider has finished preparing the history
    // (Plaid and Teller also notify us via webhooks).
    await triggerJob(
      "sync-connection",
      { connectionId, manualSync: true, teamId },
      "banking",
      { delay: FOLLOW_UP_SYNC_DELAY_MS },
    );

    return result;
  }
}
