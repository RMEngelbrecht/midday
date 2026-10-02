import { createLoggerWithContext } from "@midday/logger";
import nodemailer, { type Transporter } from "nodemailer";
import { resolveFrom } from "./address";
import type { RenderedMessage } from "./render";
import type { MailDriver, SendResult } from "./types";

const logger = createLoggerWithContext("mailer");

export type DriverContext = {
  defaultFrom: string;
};

export type Driver = {
  name: MailDriver;
  send(message: RenderedMessage, ctx: DriverContext): Promise<SendResult>;
  close?(): void;
};

const list = (value?: string | string[]) =>
  value === undefined ? undefined : Array.isArray(value) ? value : [value];

/** SMTP when a connection string is configured, console otherwise. */
export function selectDriver(smtpUrl?: string | null): MailDriver {
  return smtpUrl?.trim() ? "smtp" : "console";
}

export function createSmtpDriver(
  smtpUrl: string,
  transport?: Pick<Transporter, "sendMail" | "close">,
): Driver {
  let transporter = transport;

  const getTransporter = () => {
    if (!transporter) {
      const url = new URL(smtpUrl);
      url.searchParams.set("pool", "true");
      transporter = nodemailer.createTransport(url.toString());
    }
    return transporter;
  };

  return {
    name: "smtp",
    async send(message, ctx) {
      const info = await getTransporter().sendMail({
        from: resolveFrom(message, ctx.defaultFrom),
        to: list(message.to),
        cc: list(message.cc),
        bcc: list(message.bcc),
        replyTo: message.replyTo,
        subject: message.subject,
        html: message.html,
        text: message.text,
        attachments: message.attachments,
        headers: message.headers,
      });

      return { driver: "smtp", messageId: info.messageId };
    },
    close() {
      transporter?.close();
    },
  };
}

/** Format a message the way the console driver prints it. */
export function formatConsoleMessage(
  message: RenderedMessage,
  from: string,
): string {
  const lines = [
    "------------------------- email (console driver) -------------------------",
    `From:    ${from}`,
    `To:      ${list(message.to)?.join(", ")}`,
  ];
  if (message.cc) lines.push(`Cc:      ${list(message.cc)?.join(", ")}`);
  if (message.bcc) lines.push(`Bcc:     ${list(message.bcc)?.join(", ")}`);
  if (message.replyTo) lines.push(`Reply-To: ${message.replyTo}`);
  lines.push(`Subject: ${message.subject}`);
  if (message.attachments?.length) {
    lines.push(
      `Attachments: ${message.attachments.map((a) => a.filename).join(", ")}`,
    );
  }
  lines.push("", message.text?.trim() || "(no body)", "");
  lines.push(
    "--------------------------------------------------------------------------",
  );
  return lines.join("\n");
}

export function createConsoleDriver(
  write: (text: string) => void = (text) => logger.info(text),
): Driver {
  return {
    name: "console",
    async send(message, ctx) {
      write(
        formatConsoleMessage(message, resolveFrom(message, ctx.defaultFrom)),
      );
      return { driver: "console" };
    },
  };
}
