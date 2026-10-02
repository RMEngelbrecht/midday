import { getDefaultFromAddress } from "@midday/mailer";
import type { Job } from "bullmq";
import { ENV } from "../../env";
import { getDb } from "../../utils/db";
import { type ImapPollResult, pollImapInbox } from "../../utils/imap-poll";
import { BaseProcessor } from "../base";

/**
 * Polls the configured IMAP mailbox for inbound email (see IMAP_URL). Only
 * scheduled when IMAP_URL is set.
 */
export class ImapPollProcessor extends BaseProcessor<Record<string, never>> {
  async process(
    _job: Job<Record<string, never>>,
  ): Promise<ImapPollResult | null> {
    if (!ENV.IMAP_URL) return null;

    return pollImapInbox(
      {
        url: ENV.IMAP_URL,
        mailbox: ENV.IMAP_MAILBOX || undefined,
        processedMailbox: ENV.IMAP_PROCESSED_MAILBOX || undefined,
        domain: ENV.INBOX_EMAIL_DOMAIN || undefined,
        localPart: ENV.INBOX_EMAIL_LOCAL_PART || undefined,
        ownAddress: getDefaultFromAddress(),
      },
      { db: getDb() },
    );
  }
}
