import { isAIEnabled } from "@midday/ai";
import { getTransactionsPendingEnrichment } from "@midday/db/queries";
import { triggerJob } from "@midday/job-client";
import type { Job } from "bullmq";
import type { EnrichTransactionsSchedulerPayload } from "../../schemas/transactions";
import { getDb } from "../../utils/db";
import { BaseProcessor } from "../base";

/** Transactions picked up per run; the rest follow on later runs. */
const MAX_PER_RUN = 500;
/** Transaction ids per enrich-transactions job. */
const IDS_PER_JOB = 100;

/**
 * Queues enrichment for transactions that are still pending: history synced
 * before AI was configured, and batches left pending by a provider error.
 * Syncs only enrich the transactions they insert, so without this those rows
 * would show "Analyzing" forever.
 */
export class EnrichTransactionsSchedulerProcessor extends BaseProcessor<EnrichTransactionsSchedulerPayload> {
  async process(_job: Job<EnrichTransactionsSchedulerPayload>): Promise<{
    queuedTransactions: number;
    queuedJobs: number;
  }> {
    if (!isAIEnabled()) {
      return { queuedTransactions: 0, queuedJobs: 0 };
    }

    const pending = await getTransactionsPendingEnrichment(getDb(), {
      limit: MAX_PER_RUN,
    });

    const idsByTeam = new Map<string, string[]>();
    for (const { id, teamId } of pending) {
      const ids = idsByTeam.get(teamId) ?? [];
      ids.push(id);
      idsByTeam.set(teamId, ids);
    }

    let queuedJobs = 0;
    for (const [teamId, ids] of idsByTeam) {
      for (let i = 0; i < ids.length; i += IDS_PER_JOB) {
        await triggerJob(
          "enrich-transactions",
          { transactionIds: ids.slice(i, i + IDS_PER_JOB), teamId },
          "transactions",
        );
        queuedJobs++;
      }
    }

    if (pending.length > 0) {
      this.logger.info("Queued pending transaction enrichment", {
        transactions: pending.length,
        jobs: queuedJobs,
        teams: idsByTeam.size,
      });
    }

    return { queuedTransactions: pending.length, queuedJobs };
  }
}
