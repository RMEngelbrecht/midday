import { bareAddress, resolveDefaultFrom } from "./address";
import { ENV } from "./env";
import { createMailer, type Mailer } from "./mailer";
import type { MailMessage, SendManyResult, SendResult } from "./types";

export * from "./address";
export * from "./drivers";
export * from "./mailer";
export { renderMessage } from "./render";
export * from "./types";

let instance: Mailer | undefined;

/** Process-wide mailer configured from SMTP_URL / MAIL_FROM / APP_URL. */
export function getMailer(): Mailer {
  instance ??= createMailer({
    smtpUrl: ENV.SMTP_URL,
    mailFrom: ENV.MAIL_FROM,
    appUrl: ENV.APP_URL,
  });
  return instance;
}

/** Send one email. Uses SMTP when SMTP_URL is set, otherwise logs to stdout. */
export function send(message: MailMessage): Promise<SendResult> {
  return getMailer().send(message);
}

/** Send many emails with small concurrency; never throws per message. */
export function sendMany(messages: MailMessage[]): Promise<SendManyResult> {
  return getMailer().sendMany(messages);
}

/** Bare sender address of our own outbound mail (for loop detection). */
export function getDefaultFromAddress(): string {
  return bareAddress(
    resolveDefaultFrom({ mailFrom: ENV.MAIL_FROM, appUrl: ENV.APP_URL }),
  );
}
