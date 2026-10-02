import type { Database } from "@midday/db/client";
import { shouldSendNotification } from "@midday/db/queries";
import InsightsWeeklyEmail from "@midday/email/emails/insights-weekly";
import InvoiceEmail from "@midday/email/emails/invoice";
import InvoiceOverdueEmail from "@midday/email/emails/invoice-overdue";
import InvoicePaidEmail from "@midday/email/emails/invoice-paid";
import InvoiceReminderEmail from "@midday/email/emails/invoice-reminder";
import TransactionsEmail from "@midday/email/emails/transactions";
import TransactionsExportedEmail from "@midday/email/emails/transactions-exported";
import UpcomingInvoicesEmail from "@midday/email/emails/upcoming-invoices";
import { type MailMessage, sendMany } from "@midday/mailer";
import { nanoid } from "nanoid";
import type { EmailInput } from "../base";

export class EmailService {
  constructor(private db: Database) {}

  async sendBulk(emails: EmailInput[], notificationType: string) {
    if (emails.length === 0) {
      return {
        sent: 0,
        skipped: 0,
        failed: 0,
      };
    }

    const eligibleEmails = await this.#filterEligibleEmails(
      emails,
      notificationType,
    );

    if (eligibleEmails.length === 0) {
      return {
        sent: 0,
        skipped: emails.length,
        failed: 0,
      };
    }

    try {
      const emailPayloads = await Promise.all(
        eligibleEmails.map((email) => this.#buildEmailPayload(email)),
      );

      const { sent, failed } = await sendMany(emailPayloads);

      return {
        sent,
        skipped: emails.length - eligibleEmails.length,
        failed,
      };
    } catch (error) {
      console.error("Failed to send emails:", error);
      return {
        sent: 0,
        skipped: emails.length - eligibleEmails.length,
        failed: eligibleEmails.length,
      };
    }
  }

  async #filterEligibleEmails(emails: EmailInput[], notificationType: string) {
    const eligibleEmails = await Promise.all(
      emails.map(async (email) => {
        // For customer emails (with explicit 'to' field), always send - decision made at notification level
        if (email.to && email.to.length > 0) {
          return email;
        }

        // For team emails (no 'to' field), check user's notification settings
        const shouldSend = await shouldSendNotification(
          this.db,
          email.user.id,
          email.user.team_id,
          notificationType,
          "email",
        );

        return shouldSend ? email : null;
      }),
    );

    return eligibleEmails.filter(Boolean) as EmailInput[];
  }

  async #buildEmailPayload(email: EmailInput): Promise<MailMessage> {
    if (!email.template) {
      throw new Error(`No template found for email: ${email.template}`);
    }

    if (!email.subject) {
      throw new Error(`No subject found for email: ${email.template}`);
    }

    const template = this.#getTemplate(email.template as string);

    return {
      from: email.from,
      fromName: email.fromName,
      // Explicit 'to' wins, otherwise default to the user's email
      to: email.to || [email.user.email],
      cc: email.cc,
      bcc: email.bcc,
      replyTo: email.replyTo,
      subject: email.subject,
      text: email.text,
      react: template(email.data as any),
      attachments: email.attachments,
      headers: {
        "X-Entity-Ref-ID": nanoid(),
        ...email.headers,
      },
    };
  }

  #getTemplate(templateName: string) {
    const templates = {
      "invoice-overdue": InvoiceOverdueEmail,
      "invoice-paid": InvoicePaidEmail,
      invoice: InvoiceEmail,
      "invoice-reminder": InvoiceReminderEmail,
      transactions: TransactionsEmail,
      "transactions-exported": TransactionsExportedEmail,
      "upcoming-invoices": UpcomingInvoicesEmail,
      "insights-weekly": InsightsWeeklyEmail,
    };

    const template = templates[templateName as keyof typeof templates];

    if (!template) {
      throw new Error(`Unknown email template: ${templateName}`);
    }

    return template;
  }
}
