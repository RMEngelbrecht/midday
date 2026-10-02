/**
 * SimpleFIN sync through the worker's bank sync path (syncBankAccount ->
 * @midday/banking Provider) with mocked HTTP. Second sync must insert 0 rows.
 *
 * APP_ENV=test DATABASE_URL=... REDIS_URL=... varlock run -- bun scripts/e2e-simplefin-sync.ts
 */
import { encryptAccessUrl } from "@midday/banking";
import { createLoggerWithContext } from "@midday/logger";
import { sql } from "drizzle-orm";
import { syncBankAccount } from "../src/processors/banking/sync";
import { getDb } from "../src/utils/db";

const ACCESS_URL = "https://u:p@bridge.example.org/simplefin";
const requests: string[] = [];
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(String(input));
  requests.push(`${url.pathname}?${url.searchParams}`);
  const balancesOnly = url.searchParams.get("balances-only") === "1";
  return Response.json({
    errors: [],
    accounts: [
      {
        org: { name: "My Bank" },
        id: "ACT-1",
        name: "Checking",
        currency: "USD",
        balance: "1500.25",
        "balance-date": 1735689600,
        transactions: balancesOnly
          ? undefined
          : [
              {
                id: "T1",
                posted: 1735776000,
                amount: "-45.20",
                description: "WHOLE FOODS",
              },
              {
                id: "T2",
                posted: 1735862400,
                amount: "2500.00",
                description: "payroll",
              },
            ],
      },
    ],
  });
}) as typeof fetch;

const db = getDb();
const rows = async (q: ReturnType<typeof sql>) => {
  const res = (await db.execute(q)) as unknown as
    | Array<Record<string, string>>
    | { rows: Array<Record<string, string>> };
  return Array.isArray(res) ? res : res.rows;
};

const [user] = await rows(
  sql`insert into auth."user" (name, email) values ('SF', ${`sf-${Date.now()}@example.com`}) returning id`,
);
const [team] = await rows(
  sql`insert into teams (name, base_currency) values ('SF Team', 'USD') returning id`,
);
await rows(
  sql`insert into transaction_categories (team_id, name, slug, system) values (${team?.id}, 'Income', 'income', true)`,
);
const token = encryptAccessUrl(ACCESS_URL);
const [conn] = await rows(
  sql`insert into bank_connections (institution_id, name, team_id, provider, access_token) values ('simplefin', 'SimpleFIN', ${team?.id}, 'simplefin', ${token}) returning id`,
);
const [acct] = await rows(
  sql`insert into bank_accounts (created_by, team_id, name, currency, manual, type, account_id, bank_connection_id) values (${user?.id}, ${team?.id}, 'My Bank Checking', 'USD', false, 'depository', 'ACT-1', ${conn?.id}) returning id`,
);

const payload = {
  id: acct?.id as string,
  teamId: team?.id as string,
  connectionId: conn?.id as string,
  accountId: "ACT-1",
  accessToken: token,
  provider: "simplefin" as const,
  manualSync: true,
  currency: "USD",
  accountType: "depository" as const,
};
const logger = createLoggerWithContext("e2e");
const first = await syncBankAccount(db, payload, logger);
const second = await syncBankAccount(db, payload, logger);
const [{ n }] = (await rows(
  sql`select count(*)::int as n from transactions where bank_account_id = ${acct?.id}`,
)) as [{ n: string }];
const [{ balance }] = (await rows(
  sql`select balance from bank_accounts where id = ${acct?.id}`,
)) as [{ balance: string }];
console.log(
  `simplefin sync: run1 inserted=${first} run2 inserted=${second} rows=${n} balance=${balance} requests=${requests.length}`,
);
process.exit(first === 2 && second === 0 && Number(n) === 2 ? 0 : 1);
