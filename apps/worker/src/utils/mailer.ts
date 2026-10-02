import { type MailMessage, send } from "@midday/mailer";

export type OutgoingEmail = MailMessage;

export type EmailSender = (email: OutgoingEmail) => Promise<void>;

const defaultSender: EmailSender = async (email) => {
  await send(email);
};

let sender: EmailSender = defaultSender;

/**
 * Send path for worker-originated emails (onboarding, invites), via
 * @midday/mailer (SMTP or console). Swappable in tests.
 */
export function sendEmail(email: OutgoingEmail): Promise<void> {
  return sender(email);
}

/** Test seam: replace the sender; pass nothing to restore it. */
export function setEmailSender(next?: EmailSender): void {
  sender = next ?? defaultSender;
}
