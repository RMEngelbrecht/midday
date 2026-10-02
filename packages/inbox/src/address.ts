export type InboxAddressConfig = {
  /** Domain inbound mail is received on (INBOX_EMAIL_DOMAIN). */
  domain?: string | null;
  /** Mailbox local part for plus-addressing (INBOX_EMAIL_LOCAL_PART). */
  localPart?: string | null;
};

const INBOX_ID_PATTERN = /^[a-z0-9]{4,64}$/;

/** The forwarding address for a team: `<id>@domain` or `<local>+<id>@domain`. */
export function formatInboxAddress(
  inboxId: string,
  config: InboxAddressConfig,
): string | null {
  const domain = config.domain?.trim();
  if (!domain || !inboxId) return null;

  const localPart = config.localPart?.trim();
  return localPart
    ? `${localPart}+${inboxId}@${domain}`
    : `${inboxId}@${domain}`;
}

/** Bare lowercase address from `Name <a@b.c>` or `a@b.c`. */
export function normalizeAddress(value: string): string {
  const match = value.match(/<([^>]+)>/);
  return (match?.[1] ?? value).trim().toLowerCase();
}

/**
 * Inbox id from a single recipient address. Supports `<id>@domain` and
 * plus-addressing (`anything+<id>@domain`). When a domain is configured,
 * addresses on other domains are ignored.
 */
export function parseInboxId(
  address: string,
  config: InboxAddressConfig = {},
): string | undefined {
  const normalized = normalizeAddress(address);
  const at = normalized.lastIndexOf("@");
  if (at < 1) return undefined;

  const domain = normalized.slice(at + 1);
  const configured = config.domain?.trim().toLowerCase();
  if (configured && domain !== configured) return undefined;

  const local = normalized.slice(0, at);
  const candidate = local.includes("+") ? local.split("+").at(-1) : local;

  return candidate && INBOX_ID_PATTERN.test(candidate) ? candidate : undefined;
}

/**
 * Inbox id from the first matching recipient. Pass candidates in priority
 * order: To, Delivered-To, X-Original-To, Cc.
 */
export function findInboxId(
  recipients: Array<string | undefined | null>,
  config: InboxAddressConfig = {},
): string | undefined {
  for (const recipient of recipients) {
    if (!recipient) continue;
    const id = parseInboxId(recipient, config);
    if (id) return id;
  }
  return undefined;
}
