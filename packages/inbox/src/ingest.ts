import type { Database } from "@midday/db/client";
import { getTeamByInboxId } from "@midday/db/queries";
import { triggerJob } from "@midday/job-client";
import { logger } from "@midday/logger";
import { send } from "@midday/mailer";
import { getExtensionFromMimeType } from "@midday/utils";
import { nanoid } from "nanoid";

export const ALLOWED_FORWARDING_EMAILS = [
  "forwarding-noreply@google.com",
] as const;
export const MIN_ATTACHMENT_SIZE_BYTES = 100000; // 100KB
export const FILE_EXTENSION_REGEX = /\.[^.]+$/;

export const ALLOWED_ATTACHMENT_TYPES = [
  "image/heic",
  "image/png",
  "image/jpeg",
  "image/jpg",
  "application/pdf",
  "application/octet-stream",
];

/** Attachment in Postmark's shape (Content is base64). */
export type InboxAttachment = {
  Name: string;
  Content: string;
  ContentType: string;
  ContentLength: number;
};

export type UploadResult = {
  display_name: string;
  team_id: string;
  file_path: string[];
  file_name: string;
  content_type: string;
  sender_email: string | null;
  reference_id: string;
  size: number;
};

/** The slice of a storage client used for the `vault` bucket. */
export type AttachmentStorage = {
  storage: {
    from(bucket: string): {
      upload(
        path: string,
        body: Buffer,
        options: { contentType: string; upsert: boolean },
      ): Promise<{
        data: { path: string } | null;
        error: { message: string } | null;
      }>;
    };
  };
};

/** A received email, normalized from Postmark or IMAP. */
export type InboundEmail = {
  messageId: string;
  inboxId: string;
  from: { name: string; email: string };
  subject?: string;
  text?: string;
  html?: string;
  attachments: InboxAttachment[];
};

export type InboundResult =
  | { status: "processed"; teamId: string; uploaded: number }
  | { status: "forwarded"; teamId: string }
  | { status: "ignored"; reason: string; teamId?: string }
  | { status: "unknown-inbox" };

export function generateUniqueFileName(
  name: string,
  contentType: string,
): string {
  const hasExtension = FILE_EXTENSION_REGEX.test(name);
  if (hasExtension) {
    return name.replace(/(\.[^.]+)$/, (ext) => `_${nanoid(4)}${ext}`);
  }
  return `${name}_${nanoid(4)}${getExtensionFromMimeType(contentType)}`;
}

export function getAllowedAttachments(attachments: InboxAttachment[]) {
  return attachments.filter((a) =>
    ALLOWED_ATTACHMENT_TYPES.includes(a.ContentType),
  );
}

/**
 * Exclude small images (<100KB) except PDFs, to skip logos, favicons and
 * tracking pixels.
 */
export function filterAttachments(
  attachments: InboxAttachment[],
): InboxAttachment[] {
  return attachments.filter(
    (attachment) =>
      !(
        attachment.ContentLength < MIN_ATTACHMENT_SIZE_BYTES &&
        attachment.ContentType !== "application/pdf" &&
        attachment.ContentType !== "application/octet-stream"
      ),
  );
}

/** Upload one attachment to the team's inbox folder. Null on failure. */
export async function uploadAttachment(
  storage: AttachmentStorage,
  teamId: string,
  attachment: InboxAttachment,
  senderEmail: string | null,
  subject: string | undefined,
  messageId: string,
): Promise<UploadResult | null> {
  try {
    const uniqueFileName = generateUniqueFileName(
      attachment.Name,
      attachment.ContentType,
    );

    const { data, error } = await storage.storage
      .from("vault")
      .upload(
        `${teamId}/inbox/${uniqueFileName}`,
        Buffer.from(attachment.Content, "base64"),
        { contentType: attachment.ContentType, upsert: true },
      );

    if (error || !data?.path) {
      logger.error("Failed to upload attachment", {
        fileName: attachment.Name,
        teamId,
        error: error?.message,
        size: attachment.ContentLength,
      });
      return null;
    }

    return {
      display_name: subject || attachment.Name,
      team_id: teamId,
      file_path: data.path.split("/"),
      file_name: uniqueFileName,
      content_type: attachment.ContentType,
      sender_email: senderEmail,
      reference_id: `${messageId}_${attachment.Name}`,
      size: attachment.ContentLength,
    };
  } catch (error) {
    logger.error("Exception during attachment upload", {
      fileName: attachment.Name,
      teamId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
    return null;
  }
}

/** Enqueue attachment processing and the "new inbox items" notification. */
export async function triggerProcessingJobs(
  teamId: string,
  uploadResults: UploadResult[],
) {
  const jobResults = await Promise.all(
    uploadResults.map((item) =>
      triggerJob(
        "process-attachment",
        {
          filePath: item.file_path,
          mimetype: item.content_type,
          size: item.size,
          senderEmail: item.sender_email || undefined,
          teamId,
          referenceId: item.reference_id,
        },
        "inbox",
      ),
    ),
  );

  logger.info("Triggered process-attachment jobs", {
    teamId,
    jobCount: jobResults.length,
  });

  // Non-critical: a failing notification must not fail ingestion.
  triggerJob(
    "notification",
    {
      type: "inbox_new",
      teamId,
      totalCount: uploadResults.length,
      inboxType: "email",
    },
    "notifications",
  ).catch((error) => {
    logger.warn("Failed to trigger inbox_new notification", {
      teamId,
      error: error instanceof Error ? error.message : "Unknown error",
    });
  });
}

/**
 * The single pipeline for inbound email, shared by the Postmark webhook (api)
 * and the IMAP poller (worker): resolve team, filter and upload attachments,
 * enqueue processing.
 */
export async function processInboundEmail(
  db: Database,
  email: InboundEmail,
  deps: {
    storage: AttachmentStorage;
    /** Address of our own outbound mail; messages from it are dropped (loops). */
    ownAddress?: string;
  },
): Promise<InboundResult> {
  const { inboxId, messageId, from, subject } = email;
  const sender = from.email.toLowerCase();

  if (deps.ownAddress && sender === deps.ownAddress.toLowerCase()) {
    logger.info("Ignoring email from own address", { messageId, inboxId });
    return { status: "ignored", reason: "own-address" };
  }

  const team = await getTeamByInboxId(db, inboxId);

  if (!team) {
    logger.warn("Team not found for inbox", { inboxId, messageId });
    return { status: "unknown-inbox" };
  }

  const teamId = team.id;

  // Google Workspace forwarding confirmation: relay it to the team email so
  // the owner can confirm the forwarding address.
  if (
    team.email &&
    ALLOWED_FORWARDING_EMAILS.includes(
      sender as (typeof ALLOWED_FORWARDING_EMAILS)[number],
    )
  ) {
    await send({
      fromName: from.name,
      to: team.email,
      subject: subject ?? from.name,
      text: email.text,
      html: email.html,
      headers: { "X-Entity-Ref-ID": nanoid() },
    });
    return { status: "forwarded", teamId };
  }

  const allowed = getAllowedAttachments(email.attachments);
  const filtered = filterAttachments(allowed);

  if (!filtered.length) {
    logger.info("No processable attachments", {
      teamId,
      inboxId,
      messageId,
      total: email.attachments.length,
    });
    return { status: "ignored", reason: "no-attachments", teamId };
  }

  const uploads = (
    await Promise.all(
      filtered.map((attachment) =>
        uploadAttachment(
          deps.storage,
          teamId,
          attachment,
          from.email || null,
          subject,
          messageId,
        ),
      ),
    )
  ).filter((r): r is UploadResult => r !== null);

  if (!uploads.length) {
    logger.warn("No successful uploads", { teamId, inboxId, messageId });
    return { status: "ignored", reason: "upload-failed", teamId };
  }

  await triggerProcessingJobs(teamId, uploads);

  logger.info("Inbound email processed", {
    teamId,
    inboxId,
    messageId,
    attachmentsProcessed: uploads.length,
  });

  return { status: "processed", teamId, uploaded: uploads.length };
}
