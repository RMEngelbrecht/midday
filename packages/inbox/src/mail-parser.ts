import { findInboxId, type InboxAddressConfig } from "./address";
import type { InboundEmail, InboxAttachment } from "./ingest";

type AddressObject = { value: Array<{ address?: string; name?: string }> };

/** The subset of mailparser's ParsedMail used here (keeps mailparser out of this package). */
export type ParsedMailLike = {
  messageId?: string;
  subject?: string;
  text?: string | false;
  html?: string | false;
  from?: AddressObject;
  to?: AddressObject | AddressObject[];
  cc?: AddressObject | AddressObject[];
  headers: Map<string, unknown>;
  attachments: Array<{
    filename?: string;
    contentType: string;
    size: number;
    content: Buffer;
  }>;
};

const toList = (value: unknown): string[] => {
  if (value === undefined || value === null) return [];
  if (Array.isArray(value)) return value.flatMap(toList);
  if (typeof value === "string") return [value];
  const addresses = (value as AddressObject).value;
  if (Array.isArray(addresses)) {
    return addresses.flatMap((a) => (a.address ? [a.address] : []));
  }
  return [];
};

/** Recipient candidates in priority order: To, Delivered-To, X-Original-To, Cc. */
export function getRecipientCandidates(mail: ParsedMailLike): string[] {
  return [
    ...toList(mail.to),
    ...toList(mail.headers.get("delivered-to")),
    ...toList(mail.headers.get("x-original-to")),
    ...toList(mail.cc),
  ];
}

/** Map a parsed IMAP message to the shared inbound shape. Null if it matches no inbox. */
export function inboundFromParsedMail(
  mail: ParsedMailLike,
  config: InboxAddressConfig,
  fallbackMessageId: string,
): InboundEmail | null {
  const inboxId = findInboxId(getRecipientCandidates(mail), config);
  if (!inboxId) return null;

  const sender = mail.from?.value[0];

  return {
    messageId: mail.messageId || fallbackMessageId,
    inboxId,
    from: {
      name: sender?.name || sender?.address || "",
      email: sender?.address ?? "",
    },
    subject: mail.subject,
    text: mail.text || undefined,
    html: mail.html || undefined,
    attachments: mail.attachments.map(
      (a, index): InboxAttachment => ({
        Name: a.filename || `attachment-${index + 1}`,
        Content: a.content.toString("base64"),
        ContentType: a.contentType,
        ContentLength: a.size,
      }),
    ),
  };
}
