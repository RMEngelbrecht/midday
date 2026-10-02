import type { Database } from "@midday/db/client";
import {
  type AttachmentStorage,
  type InboundResult,
  processInboundEmail,
} from "@midday/inbox/ingest";
import { inboundFromParsedMail } from "@midday/inbox/mail-parser";
import { createLoggerWithContext } from "@midday/logger";
import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";

const logger = createLoggerWithContext("worker:imap-poll");

export type ImapPollConfig = {
  /** imaps://user:pass@host:993 (or imap:// for STARTTLS/plain). */
  url: string;
  mailbox?: string;
  /** Move handled messages here; otherwise they are only marked seen. */
  processedMailbox?: string;
  domain?: string;
  localPart?: string;
  /** Our own outbound address; mail from it is dropped. */
  ownAddress?: string;
};

export type ImapPollResult = {
  fetched: number;
  processed: number;
  skipped: number;
  failed: number;
};

export function parseImapUrl(url: string) {
  const parsed = new URL(url);
  const secure = parsed.protocol === "imaps:";
  return {
    host: parsed.hostname,
    port: parsed.port ? Number(parsed.port) : secure ? 993 : 143,
    secure,
    auth: {
      user: decodeURIComponent(parsed.username),
      pass: decodeURIComponent(parsed.password),
    },
  };
}

/**
 * Fetch unseen messages once and feed each through the same pipeline as the
 * Postmark webhook. Handled messages (processed, ignored, or addressed to no
 * inbox) are marked seen; messages whose processing threw stay unseen and are
 * retried on the next poll.
 */
export async function pollImapInbox(
  config: ImapPollConfig,
  deps: { db: Database; storage: AttachmentStorage },
): Promise<ImapPollResult> {
  const result: ImapPollResult = {
    fetched: 0,
    processed: 0,
    skipped: 0,
    failed: 0,
  };
  const mailbox = config.mailbox || "INBOX";

  const client = new ImapFlow({
    ...parseImapUrl(config.url),
    logger: false,
  });

  client.on("error", (error) => {
    logger.error("IMAP connection error", { error: error.message });
  });

  await client.connect();

  try {
    const lock = await client.getMailboxLock(mailbox);

    try {
      const uids = (await client.search({ seen: false }, { uid: true })) || [];
      result.fetched = uids.length;

      for (const uid of uids) {
        try {
          const message = await client.fetchOne(
            String(uid),
            { source: true },
            { uid: true },
          );

          if (!message || !message.source) {
            result.skipped++;
            continue;
          }

          const parsed = await simpleParser(message.source);
          const inbound = inboundFromParsedMail(
            parsed,
            { domain: config.domain, localPart: config.localPart },
            `imap-${mailbox}-${uid}`,
          );

          let outcome: InboundResult | "no-inbox" = "no-inbox";

          if (inbound) {
            outcome = await processInboundEmail(deps.db, inbound, {
              storage: deps.storage,
              ownAddress: config.ownAddress,
            });
          }

          if (outcome === "no-inbox" || outcome.status !== "processed") {
            result.skipped++;
          } else {
            result.processed++;
          }

          await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true });

          if (config.processedMailbox) {
            await client.messageMove(String(uid), config.processedMailbox, {
              uid: true,
            });
          }
        } catch (error) {
          result.failed++;
          logger.error("Failed to process IMAP message", {
            uid,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }

  logger.info("IMAP poll complete", { mailbox, ...result });
  return result;
}
