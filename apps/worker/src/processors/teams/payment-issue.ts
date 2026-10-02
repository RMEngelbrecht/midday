import { PaymentIssueEmail } from "@midday/email/emails/payment-issue";
import { send } from "@midday/mailer";
import type { Job } from "bullmq";
import type { PaymentIssuePayload } from "../../schemas/teams";
import { BaseProcessor } from "../base";

export class PaymentIssueProcessor extends BaseProcessor<PaymentIssuePayload> {
  async process(job: Job<PaymentIssuePayload>): Promise<void> {
    const { teamId, email, fullName, teamName } = job.data;

    this.logger.info("Sending payment issue email", {
      jobId: job.id,
      teamId,
      email,
    });

    await send({
      to: email,
      subject: "Your payment didn't go through",
      react: PaymentIssueEmail({ fullName, teamName }),
    });

    this.logger.info("Payment issue email sent", {
      jobId: job.id,
      teamId,
    });
  }
}
