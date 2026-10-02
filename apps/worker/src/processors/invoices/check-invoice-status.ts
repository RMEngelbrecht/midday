import {
  createAttachments,
  findInvoicePaymentCandidates,
  getInvoiceForStatusCheck,
  updateInvoice,
} from "@midday/db/queries";
import { triggerJob } from "@midday/job-client";
import type { Job } from "bullmq";
import { subDays } from "date-fns";
import { z } from "zod";
import { getDb } from "../../utils/db";
import { BaseProcessor } from "../base";

export const checkInvoiceStatusSchema = z.object({
  invoiceId: z.string().uuid(),
});

type CheckInvoiceStatusPayload = z.infer<typeof checkInvoiceStatusSchema>;

/** Look back this many days for a transaction paying the invoice. */
const PAYMENT_LOOKBACK_DAYS = 3;

/** Calendar date (YYYY-MM-DD) of an instant in a timezone. */
export function toDateInTimezone(date: Date, timezone: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(
      date,
    );
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * Exactly one candidate transaction means the invoice was paid; otherwise an
 * unpaid invoice past its due date becomes overdue.
 */
export function decideInvoiceStatus(params: {
  status: string;
  dueDate: string;
  candidateCount: number;
  now: Date;
}): "paid" | "overdue" | null {
  if (params.candidateCount === 1) return "paid";
  if (params.status === "unpaid" && new Date(params.dueDate) < params.now) {
    return "overdue";
  }
  return null;
}

/**
 * Check one unpaid/overdue invoice against recent transactions.
 */
export class CheckInvoiceStatusProcessor extends BaseProcessor<CheckInvoiceStatusPayload> {
  protected override getPayloadSchema() {
    return checkInvoiceStatusSchema;
  }

  async process(
    job: Job<CheckInvoiceStatusPayload>,
  ): Promise<{ status: "paid" | "overdue" | null }> {
    const db = getDb();
    const invoice = await getInvoiceForStatusCheck(db, {
      id: job.data.invoiceId,
    });

    if (
      !invoice ||
      invoice.amount === null ||
      !invoice.currency ||
      !invoice.dueDate
    ) {
      this.logger.warn("Invoice data is missing", {
        invoiceId: job.data.invoiceId,
      });
      return { status: null };
    }

    const timezone =
      (invoice.template as { timezone?: string } | null)?.timezone || "UTC";
    const now = new Date();

    const candidates = await findInvoicePaymentCandidates(db, {
      teamId: invoice.teamId,
      amount: invoice.amount,
      currency: invoice.currency,
      since: toDateInTimezone(subDays(now, PAYMENT_LOOKBACK_DAYS), timezone),
    });

    const status = decideInvoiceStatus({
      status: invoice.status,
      dueDate: invoice.dueDate,
      candidateCount: candidates.length,
      now,
    });

    if (!status) return { status };

    const paidAt = status === "paid" ? now.toISOString() : undefined;

    if (status === "paid" && invoice.filePath) {
      await createAttachments(db, {
        teamId: invoice.teamId,
        attachments: [
          {
            type: "application/pdf",
            path: invoice.filePath,
            transactionId: candidates[0]!.id,
            name: `${invoice.invoiceNumber}.pdf`,
            size: invoice.fileSize ?? 0,
          },
        ],
      });
    }

    await updateInvoice(db, {
      id: invoice.id,
      teamId: invoice.teamId,
      status,
      ...(paidAt ? { paidAt } : {}),
    });

    if (invoice.invoiceNumber) {
      await triggerJob(
        "notification",
        {
          type: status === "paid" ? "invoice_paid" : "invoice_overdue",
          teamId: invoice.teamId,
          invoiceId: invoice.id,
          invoiceNumber: invoice.invoiceNumber,
          customerName: invoice.customerName ?? undefined,
          ...(paidAt ? { paidAt } : {}),
        },
        "notifications",
      );
    }

    this.logger.info(`Invoice status changed to ${status}`, {
      invoiceId: invoice.id,
    });

    return { status };
  }
}
