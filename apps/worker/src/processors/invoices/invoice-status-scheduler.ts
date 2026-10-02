import { getInvoiceIdsForStatusCheck } from "@midday/db/queries";
import { triggerJob } from "@midday/job-client";
import type { Job } from "bullmq";
import { getDb } from "../../utils/db";
import { BaseProcessor } from "../base";

/**
 * Twice daily: fan out a status check for every unpaid or overdue invoice.
 */
export class InvoiceStatusSchedulerProcessor extends BaseProcessor<
  Record<string, never>
> {
  async process(_job: Job<Record<string, never>>): Promise<{ count: number }> {
    const invoices = await getInvoiceIdsForStatusCheck(getDb());

    for (const invoice of invoices) {
      await triggerJob(
        "check-invoice-status",
        { invoiceId: invoice.id },
        "invoices",
      );
    }

    this.logger.info("Invoice status checks enqueued", {
      count: invoices.length,
    });

    return { count: invoices.length };
  }
}
