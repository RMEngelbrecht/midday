/**
 * End-to-end check for the import-statement processor against a real database.
 * Seeds a team + one account per fixture, imports each file twice and prints
 * the row counts (second run must insert 0 new rows).
 *
 * APP_ENV=test DATABASE_URL=... REDIS_URL=... varlock run -- bun scripts/e2e-import-statement.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { ImportStatementProcessor } from "../src/processors/transactions/import-statement";
import { getDb } from "../src/utils/db";

const FIXTURES = join(
  import.meta.dir,
  "../../../packages/import/src/statement/__fixtures__",
);
const files: Array<[string, string]> = [
  ["sample-v1.ofx", "USD"],
  ["sample-v2.ofx", "CAD"],
  ["sample-camt053.xml", "EUR"],
  ["sample.mt940", "EUR"],
  ["sample.qif", "USD"],
];

class FileProcessor extends ImportStatementProcessor {
  protected override async readFile(_teamId: string, filePath: string[]) {
    return new Uint8Array(readFileSync(join(FIXTURES, filePath.join("/"))));
  }
  run(data: Parameters<ImportStatementProcessor["process"]>[0]["data"]) {
    return this.process({
      id: "e2e",
      data,
      updateProgress: async () => {},
    } as never);
  }
}

const db = getDb();
const exec = async (q: ReturnType<typeof sql>) => {
  const res = (await db.execute(q)) as unknown as
    | Array<Record<string, string>>
    | { rows: Array<Record<string, string>> };
  return Array.isArray(res) ? res : res.rows;
};

const [user] = await exec(
  sql`insert into auth."user" (name, email) values ('E2E', ${`e2e-${Date.now()}@example.com`}) returning id`,
);
const [team] = await exec(
  sql`insert into teams (name, base_currency) values ('E2E Team', 'USD') returning id`,
);

await exec(
  sql`insert into transaction_categories (team_id, name, slug, system) values (${team?.id}, 'Income', 'income', true)`,
);

const processor = new FileProcessor();
let failed = false;

for (const [file, currency] of files) {
  const [acct] = await exec(
    sql`insert into bank_accounts (created_by, team_id, name, currency, manual, type, account_id)
        values (${user?.id}, ${team?.id}, ${file}, ${currency}, true, 'depository', ${file}) returning id`,
  );
  const data = {
    teamId: team?.id as string,
    bankAccountId: acct?.id as string,
    filePath: [file],
    currency,
  };
  const first = await processor.run(data);
  const [{ n: afterFirst }] = (await exec(
    sql`select count(*)::int as n from transactions where bank_account_id = ${acct?.id}`,
  )) as [{ n: string }];
  const second = await processor.run(data);
  const [{ n: afterSecond }] = (await exec(
    sql`select count(*)::int as n from transactions where bank_account_id = ${acct?.id}`,
  )) as [{ n: string }];
  const ok = second.importedCount === 0 && afterFirst === afterSecond;
  failed ||= !ok || first.importedCount === 0;
  console.log(
    `${file}: run1 imported=${first.importedCount} rows=${afterFirst} | run2 imported=${second.importedCount} skipped=${second.skippedCount} rows=${afterSecond} ${ok ? "OK" : "FAIL"}`,
  );
}

process.exit(failed ? 1 : 0);
