import type { Job } from "bullmq";
import {
  type SyncAccountPayload,
  syncAccountSchema,
} from "../../schemas/banking";
import { getDb } from "../../utils/db";
import { BaseProcessor } from "../base";
import { disconnectIfAllAccountsFailing, syncBankAccount } from "./sync";

/**
 * Background sync of a single bank account (fanned out by sync-connection).
 */
export class SyncAccountProcessor extends BaseProcessor<SyncAccountPayload> {
  protected override getPayloadSchema() {
    return syncAccountSchema;
  }

  async process(
    job: Job<SyncAccountPayload>,
  ): Promise<{ transactionsInserted: number }> {
    const db = getDb();

    try {
      const transactionsInserted = await syncBankAccount(
        db,
        job.data,
        this.logger,
      );
      return { transactionsInserted };
    } catch (error) {
      await disconnectIfAllAccountsFailing(
        db,
        job.data.connectionId,
        this.logger,
      );
      throw error;
    }
  }
}
