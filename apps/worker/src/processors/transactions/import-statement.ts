import { upsertTransactions } from "@midday/db/queries";
import { decodeStatementBytes, parseStatement } from "@midday/import/statement";
import { statementToInserts } from "@midday/import/statement/to-transactions";
import { triggerJob } from "@midday/job-client";
import { getStorage, teamVaultKey } from "@midday/storage";
import type { Job } from "bullmq";
import type { ImportStatementPayload } from "../../schemas/transactions";
import { getDb } from "../../utils/db";
import { processBatch } from "../../utils/process-batch";
import { TIMEOUTS, withTimeout } from "../../utils/timeout";
import { BaseProcessor } from "../base";

const BATCH_SIZE = 500;

export type ImportStatementResult = {
  importedCount: number;
  skippedCount: number;
  invalidCount: number;
};

/**
 * Imports OFX/QFX, CAMT.053, MT940 and QIF statements deterministically (no AI).
 * Dedupe relies on transactions.internal_id (bank reference, or a content
 * fingerprint), so re-importing a file inserts nothing.
 */
export class ImportStatementProcessor extends BaseProcessor<ImportStatementPayload> {
  /** Overridable file access so storage backends (and tests) can be swapped. */
  protected async readFile(
    teamId: string,
    filePath: string[],
  ): Promise<Uint8Array> {
    const data = await withTimeout(
      getStorage().download(teamVaultKey(teamId, filePath)),
      TIMEOUTS.FILE_DOWNLOAD,
      `File download timed out after ${TIMEOUTS.FILE_DOWNLOAD}ms`,
    );
    if (!data) throw new Error("File content is required");
    return new Uint8Array(await data.arrayBuffer());
  }

  async process(
    job: Job<ImportStatementPayload>,
  ): Promise<ImportStatementResult> {
    const { teamId, bankAccountId, filePath, currency } = job.data;
    const db = getDb();

    await this.updateProgress(job, this.ProgressMilestones.FETCHED);
    const content = decodeStatementBytes(await this.readFile(teamId, filePath));
    const filename = filePath[filePath.length - 1];

    const parsed = parseStatement(content, filename);
    if (!parsed) throw new Error("Not a supported statement file");

    await this.updateProgress(job, 40, undefined, "transforming");

    const rows = statementToInserts({
      teamId,
      bankAccountId,
      currency,
      transactions: parsed.accounts.flatMap((a) =>
        a.transactions.map((t) => ({
          ...t,
          currency: t.currency ?? a.currency,
        })),
      ),
    });

    const ids: string[] = [];
    const results = await processBatch(rows, BATCH_SIZE, (batch) =>
      upsertTransactions(db, {
        teamId,
        transactions: batch.map((t) => ({
          name: t.name,
          date: t.date,
          method: "other" as const,
          amount: t.amount,
          currency: t.currency,
          teamId: t.team_id,
          bankAccountId: t.bank_account_id,
          internalId: t.internal_id,
          status: "posted" as const,
          manual: t.manual,
          categorySlug: t.category_slug,
          description: null,
          balance: null,
          note: null,
          counterpartyName: t.counterparty_name,
          merchantName: null,
          assignedId: null,
          internal: false,
          notified: true,
          baseAmount: null,
          baseCurrency: null,
          taxAmount: null,
          taxRate: null,
          taxType: null,
          recurring: false,
          frequency: null,
          enrichmentCompleted: false,
        })),
      }),
    );
    ids.push(...results.flat().map((r) => r.id));

    await this.updateProgress(job, 80, undefined, "finalizing");

    if (ids.length > 0) {
      await triggerJob(
        "enrich-transactions",
        { transactionIds: ids, teamId },
        "transactions",
      );
      await triggerJob(
        "match-transactions-bidirectional",
        { teamId, newTransactionIds: ids },
        "inbox",
      );
    }

    await this.updateProgress(job, 100, undefined, "completed");

    return {
      importedCount: ids.length,
      skippedCount: rows.length - ids.length,
      invalidCount: 0,
    };
  }
}
