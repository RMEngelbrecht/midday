/**
 * End-to-end check of the IMAP poller against GreenMail (imap 3145, smtp 3025),
 * a migrated Postgres and Valkey. Attachments go to the configured storage
 * driver (local by default).
 *
 *   APP_ENV=test DATABASE_URL=postgres://postgres:postgres@localhost:5445/midday_test \
 *   REDIS_URL=redis://localhost:6445 INBOX_EMAIL_DOMAIN=example.com \
 *   IMAP_URL=imap://inbox:secret@localhost:3145 varlock run -- bun scripts/imap-smoke.ts
 */

import { getInboxByFilePath } from "@midday/db/queries";
import { teams } from "@midday/db/schema";
import { Queue } from "bullmq";
import { eq } from "drizzle-orm";
import nodemailer from "nodemailer";
import { ENV } from "../src/env";
import { ProcessAttachmentProcessor } from "../src/processors/inbox/process-attachment";
import { getDb } from "../src/utils/db";
import { pollImapInbox } from "../src/utils/imap-poll";

const db = getDb();
const [team] = await db.select().from(teams).limit(1);
if (!team?.inboxId) throw new Error("seed a team first");
const inboxId = team.inboxId;

const smtp = nodemailer.createTransport({
  host: "localhost",
  port: 3025,
  secure: false,
});
const pdf = Buffer.from(`%PDF-1.4 smoke ${Date.now()}`);

// 1. plus-addressing in To (delivered to the mailbox user)
await smtp.sendMail({
  from: "billing@vendor.test",
  to: `inbox+${inboxId}@example.com`,
  envelope: { from: "billing@vendor.test", to: "inbox@example.com" },
  subject: "Invoice via plus-address",
  text: "see attached",
  attachments: [
    { filename: "plus.pdf", content: pdf, contentType: "application/pdf" },
  ],
});
// 2. list address in To, real inbox only in X-Original-To
await smtp.sendMail({
  from: "billing@vendor.test",
  to: "list@company.test",
  envelope: { from: "billing@vendor.test", to: "inbox@example.com" },
  headers: { "X-Original-To": `${inboxId}@example.com` },
  subject: "Invoice via X-Original-To",
  text: "see attached",
  attachments: [
    { filename: "orig.pdf", content: pdf, contentType: "application/pdf" },
  ],
});
// 3. unrelated mail: no inbox id
await smtp.sendMail({
  from: "x@y.test",
  to: "inbox@example.com",
  subject: "Not for any team",
  text: "hello",
});
await new Promise((r) => setTimeout(r, 1000));

const config = {
  url: ENV.IMAP_URL as string,
  domain: ENV.INBOX_EMAIL_DOMAIN,
  mailbox: ENV.IMAP_MAILBOX,
};
const first = await pollImapInbox(config, { db });
console.log("poll 1:", first);
const second = await pollImapInbox(config, { db });
console.log("poll 2 (nothing new):", second);

// Run the queued process-attachment jobs; they create the inbox row first.
const queue = new Queue("inbox", {
  connection: { url: ENV.REDIS_QUEUE_URL ?? ENV.REDIS_URL } as never,
});
const jobs = (await queue.getJobs(["waiting", "delayed", "active"])).filter(
  (j) => j.name === "process-attachment",
);
console.log("queued process-attachment jobs:", jobs.length);
for (const job of jobs) {
  try {
    await new ProcessAttachmentProcessor().process(job as never);
  } catch (error) {
    console.log(
      "  process-attachment failed (AI may be unconfigured):",
      (error as Error).message.slice(0, 80),
    );
  }
  const row = await getInboxByFilePath(db, {
    filePath: job.data.filePath,
    teamId: team.id,
  });
  console.log(
    "inbox row:",
    row
      ? {
          id: row.id,
          status: row.status,
          name: row.fileName,
          sender: row.senderEmail,
        }
      : null,
  );
}
await queue.obliterate({ force: true });
await queue.close();
process.exit(0);
