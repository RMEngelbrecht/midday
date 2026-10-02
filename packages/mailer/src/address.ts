import type { MailMessage } from "./types";

/** "Name <a@b.c>" from a display name and an address. */
export function formatAddress(name: string, address: string): string {
  return `"${name.replace(/["\\]/g, "")}" <${address}>`;
}

/** Extract the bare address from `Name <a@b.c>` or `a@b.c`. */
export function bareAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] ?? value).trim();
}

/** Default sender: MAIL_FROM, or noreply@<host of APP_URL>. */
export function resolveDefaultFrom(opts: {
  mailFrom?: string;
  appUrl?: string;
}): string {
  if (opts.mailFrom?.trim()) return opts.mailFrom.trim();

  let host = "localhost";
  try {
    if (opts.appUrl) host = new URL(opts.appUrl).hostname;
  } catch {}

  return `Midday <noreply@${host}>`;
}

/** The From header for a message. */
export function resolveFrom(message: MailMessage, defaultFrom: string): string {
  if (message.from) return message.from;
  if (message.fromName) {
    return formatAddress(message.fromName, bareAddress(defaultFrom));
  }
  return defaultFrom;
}
