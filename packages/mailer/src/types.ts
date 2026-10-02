import type { ReactNode } from "react";

export type MailDriver = "smtp" | "console";

export type MailAttachment = {
  filename: string;
  content?: string | Buffer;
  path?: string;
  contentType?: string;
  /** Set to "base64" when `content` is a base64 string. */
  encoding?: string;
};

export type MailMessage = {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
  /** Full From value. Defaults to MAIL_FROM. */
  from?: string;
  /** Display name used with the default From address (ignored if `from` is set). */
  fromName?: string;
  replyTo?: string;
  subject: string;
  /** A react-email element, rendered to html (and a text fallback). */
  react?: ReactNode;
  html?: string;
  text?: string;
  attachments?: MailAttachment[];
  headers?: Record<string, string>;
};

export type SendResult = {
  driver: MailDriver;
  messageId?: string;
};

export type SendManyResult = {
  sent: number;
  failed: number;
  results: Array<
    { ok: true; result: SendResult } | { ok: false; error: unknown }
  >;
};
