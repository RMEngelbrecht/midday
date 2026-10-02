import { markTeamTransactionsNotified } from "@midday/db/queries";
import { Notifications } from "@midday/notifications";
import type { Job } from "bullmq";
import {
  type TransactionNotificationsPayload,
  transactionNotificationsSchema,
} from "../../schemas/banking";
import { getDb } from "../../utils/db";
import { BaseProcessor } from "../base";

/**
 * Notify the team about transactions synced since the last notification.
 * Claiming rows (notified=false -> true) makes duplicate jobs harmless.
 */
export class TransactionNotificationsProcessor extends BaseProcessor<TransactionNotificationsPayload> {
  protected override getPayloadSchema() {
    return transactionNotificationsSchema;
  }

  async process(
    job: Job<TransactionNotificationsPayload>,
  ): Promise<{ notified: number }> {
    const db = getDb();
    const { teamId } = job.data;

    const transactions = await markTeamTransactionsNotified(db, { teamId });

    if (transactions.length > 0) {
      await new Notifications(db).create(
        "transactions_created",
        teamId,
        { transactions },
        { sendEmail: true },
      );
    }

    return { notified: transactions.length };
  }
}
