/**
 * Runs the export-team-data processor against the configured storage driver:
 * seeds a team with a vault document, exports, and checks the zip contains it.
 *
 *   APP_ENV=test DATABASE_URL=... REDIS_URL=... varlock run -- bun scripts/storage-export-smoke.ts
 */
import { randomUUID } from "node:crypto";
import { putVaultFile } from "@midday/db/vault";
import { getStorage, objectKey } from "@midday/storage";
import type { Job } from "bullmq";
import { sql } from "drizzle-orm";
import { ExportTeamDataProcessor } from "../src/processors/transactions/export-team-data";
import type { ExportTeamDataPayload } from "../src/schemas/transactions";
import { getDb } from "../src/utils/db";

const db = getDb();
const teamId = randomUUID();
const userId = randomUUID();

await db.execute(
  sql`insert into public.teams (id, name) values (${teamId}, 'Export smoke')`,
);
await db.execute(
  sql`insert into auth."user" (id, name, email) values (${userId}, 'smoke', ${`${userId}@it.test`})`,
);
await db.execute(
  sql`update public.users set team_id = ${teamId} where id = ${userId}`,
);

const pdf = new TextEncoder().encode("%PDF-1.4\nexport smoke\n%%EOF\n");
await putVaultFile(db, {
  path: [teamId, "receipts", "receipt.pdf"],
  body: pdf,
  contentType: "application/pdf",
});

const progress: number[] = [];
const job = {
  id: "smoke",
  data: { teamId, userId, locale: "en" },
  updateProgress: async (p: number) => {
    progress.push(p);
  },
} as unknown as Job<ExportTeamDataPayload>;

const result = await new ExportTeamDataProcessor().process(job);
const zip = await getStorage().download(objectKey("vault", result.fullPath));
if (!zip) throw new Error(`export zip missing at ${result.fullPath}`);

const tmp = `${process.env.TMPDIR ?? "/tmp"}/export-smoke-${teamId}.zip`;
await Bun.write(tmp, zip);
const listing = Bun.spawnSync(["unzip", "-l", tmp]).stdout.toString();
const hasDoc = listing.includes(`documents/${teamId}_receipts_receipt.pdf`);

const [row] = (
  await db.execute(
    sql`select processing_status from public.documents where team_id = ${teamId} and name = ${result.fullPath}`,
  )
).rows as { processing_status: string }[];

console.log({
  driver: getStorage().driver.name,
  fullPath: result.fullPath,
  zipBytes: zip.size,
  progress: progress.at(-1),
  zipHasVaultDocument: hasDoc,
  exportDocumentRow: row?.processing_status,
});
console.log(listing);
process.exit(hasDoc && row?.processing_status === "completed" ? 0 : 1);
