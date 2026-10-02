import { createLoggerWithContext } from "@midday/logger";
import { resolveDefaultFrom } from "./address";
import {
  createConsoleDriver,
  createSmtpDriver,
  type Driver,
  selectDriver,
} from "./drivers";
import { renderMessage } from "./render";
import type {
  MailDriver,
  MailMessage,
  SendManyResult,
  SendResult,
} from "./types";

const logger = createLoggerWithContext("mailer");

export type MailerConfig = {
  smtpUrl?: string | null;
  mailFrom?: string;
  appUrl?: string;
  /** Override the driver (tests). */
  driver?: Driver;
  /** Max messages in flight for sendMany. */
  concurrency?: number;
};

export type Mailer = {
  driver: MailDriver;
  send(message: MailMessage): Promise<SendResult>;
  sendMany(messages: MailMessage[]): Promise<SendManyResult>;
  close(): void;
};

export function createMailer(config: MailerConfig): Mailer {
  const driver =
    config.driver ??
    (selectDriver(config.smtpUrl) === "smtp"
      ? createSmtpDriver(config.smtpUrl as string)
      : createConsoleDriver());
  const defaultFrom = resolveDefaultFrom(config);
  const concurrency = Math.max(1, config.concurrency ?? 5);

  const send = async (message: MailMessage) =>
    driver.send(await renderMessage(message), { defaultFrom });

  return {
    driver: driver.name,
    send,
    async sendMany(messages) {
      const results: SendManyResult["results"] = new Array(messages.length);
      let next = 0;

      const worker = async () => {
        while (next < messages.length) {
          const index = next++;
          try {
            results[index] = {
              ok: true,
              result: await send(messages[index] as MailMessage),
            };
          } catch (error) {
            logger.error("Failed to send email", {
              to: messages[index]?.to,
              subject: messages[index]?.subject,
              error: error instanceof Error ? error.message : String(error),
            });
            results[index] = { ok: false, error };
          }
        }
      };

      await Promise.all(
        Array.from({ length: Math.min(concurrency, messages.length) }, worker),
      );

      const sent = results.filter((r) => r.ok).length;
      return { sent, failed: results.length - sent, results };
    },
    close() {
      driver.close?.();
    },
  };
}
