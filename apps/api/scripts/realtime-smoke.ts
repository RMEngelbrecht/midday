/**
 * End-to-end check of the realtime pipeline: Postgres NOTIFY -> API
 * `GET /realtime` (SSE) -> the dashboard's subscription manager.
 *
 *   APP_URL=http://localhost:3547 API_URL=http://localhost:3447 \
 *   DATABASE_URL=postgres://... REDIS_URL=redis://... WORKER_PORT=8447 \
 *   (plus the other required API/worker env) \
 *   bun apps/api/scripts/realtime-smoke.ts
 *
 * Starts its own API (ALLOW_SIGNUP=open) and worker, so nothing may already
 * listen on those ports. Creates two users in two teams; only run it
 * against a throwaway database.
 */
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventSource } from "eventsource";
import { Client } from "pg";
import {
  type ChangeEvent,
  RealtimeSubscriptions,
} from "../../dashboard/src/lib/realtime";

const API_URL = required("API_URL");
const APP_URL = required("APP_URL");
const DATABASE_URL = required("DATABASE_URL");
const WORKER_PORT = process.env.WORKER_PORT ?? "8447";
const DELIVERY_MS = 2_000;
const HEARTBEAT_MS = 25_000;

const root = join(import.meta.dir, "../../..");
const varlock = join(root, "node_modules/.bin/varlock");

function required(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

let failures = 0;
function check(label: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    failures++;
    if (detail !== undefined) console.log("      ", JSON.stringify(detail));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- processes ---------------------------------------------------------------

function spawn(app: "api" | "worker", env: Record<string, string>) {
  return Bun.spawn([varlock, "run", "--", "bun", "src/index.ts"], {
    cwd: join(root, "apps", app),
    env: { ...process.env, ...env },
    stdout: Bun.file(join(tmpdir(), `realtime-smoke-${app}.log`)),
    stderr: Bun.file(join(tmpdir(), `realtime-smoke-${app}.err.log`)),
  });
}

async function waitFor(url: string, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {}
    await sleep(250);
  }
  throw new Error(`${url} did not come up`);
}

const startApi = async () => {
  const proc = spawn("api", { ALLOW_SIGNUP: "open" });
  await waitFor(`${API_URL}/health`);
  return proc;
};

// --- auth (exactly what the browser does: session cookie) --------------------

async function signUp(email: string) {
  const res = await fetch(`${API_URL}/auth/sign-up/email`, {
    method: "POST",
    headers: { origin: APP_URL, "content-type": "application/json" },
    body: JSON.stringify({ email, password: "realtime-smoke-pw", name: email }),
  });
  if (!res.ok) throw new Error(`sign-up ${email}: ${await res.text()}`);
  const { user } = (await res.json()) as { user: { id: string } };
  const cookie = res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  return { id: user.id, cookie };
}

async function jwt(cookie: string) {
  const res = await fetch(`${API_URL}/auth/token`, {
    headers: { origin: APP_URL, cookie },
  });
  return ((await res.json()) as { token: string }).token;
}

async function trpc(
  cookie: string,
  path: string,
  input: unknown,
  method: "query" | "mutation" = "mutation",
) {
  const body = JSON.stringify({ json: input });
  const res = await fetch(
    method === "query"
      ? `${API_URL}/trpc/${path}?input=${encodeURIComponent(body)}`
      : `${API_URL}/trpc/${path}`,
    {
      method: method === "query" ? "GET" : "POST",
      headers: {
        origin: APP_URL,
        authorization: `Bearer ${await jwt(cookie)}`,
        "content-type": "application/json",
      },
      body: method === "query" ? undefined : body,
    },
  );
  if (!res.ok) throw new Error(`${path}: ${await res.text()}`);
  return ((await res.json()) as { result: { data: { json: unknown } } }).result
    .data.json;
}

// --- realtime clients ---------------------------------------------------------

type Received = { at: number; event: ChangeEvent };

function connect(cookie: string) {
  const changes: Received[] = [];
  const control: { at: number; type: string }[] = [];
  const manager = new RealtimeSubscriptions(() => {
    // Node has no cookie jar; a browser sends the cookie via withCredentials.
    const source = new EventSource(`${API_URL}/realtime`, {
      withCredentials: true,
      fetch: (input, init) =>
        fetch(input, {
          ...init,
          headers: { ...init?.headers, cookie, origin: APP_URL },
        }),
    });
    for (const type of ["ready", "ping", "error"]) {
      source.addEventListener(type, () =>
        control.push({ at: Date.now(), type }),
      );
    }
    return source as unknown as globalThis.EventSource;
  });
  const unsubscribe = manager.subscribe((event) =>
    changes.push({ at: Date.now(), event }),
  );
  return { changes, control, manager, unsubscribe };
}

async function until(predicate: () => boolean, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await sleep(25);
  }
  return predicate();
}

// --- run ----------------------------------------------------------------------

const db = new Client({ connectionString: DATABASE_URL });
await db.connect();

let api = await startApi();
const worker = spawn("worker", { PORT: WORKER_PORT });
await waitFor(`http://localhost:${WORKER_PORT}/health`);

try {
  const run = Date.now();
  const alice = await signUp(`alice+${run}@example.com`);
  const bob = await signUp(`bob+${run}@example.com`);

  const teams: Record<string, string> = {};
  for (const [user, name] of [
    [alice, "Team A"],
    [bob, "Team B"],
  ] as const) {
    const { rows } = await db.query(
      "INSERT INTO teams (name) VALUES ($1) RETURNING id",
      [`${name} ${run}`],
    );
    const teamId = rows[0].id as string;
    teams[name] = teamId;
    await db.query(
      "INSERT INTO users_on_team (user_id, team_id, role) VALUES ($1, $2, 'owner')",
      [user.id, teamId],
    );
    await db.query("UPDATE users SET team_id = $2 WHERE id = $1", [
      user.id,
      teamId,
    ]);
  }
  const teamA = teams["Team A"]!;
  const teamB = teams["Team B"]!;

  // Unauthenticated streams are refused.
  const anon = await fetch(`${API_URL}/realtime`);
  check("unauthenticated GET /realtime -> 401", anon.status === 401);

  const a = connect(alice.cookie);
  const b = connect(bob.cookie);
  check(
    "both users receive `ready`",
    await until(
      () =>
        a.control.some((c) => c.type === "ready") &&
        b.control.some((c) => c.type === "ready"),
      5_000,
    ),
  );

  /** Runs `write`, then waits for A to see a matching event. */
  async function expectDelivery(
    label: string,
    write: () => Promise<unknown>,
    match: (e: ChangeEvent) => boolean,
    timeoutMs = DELIVERY_MS,
  ) {
    const start = Date.now();
    const before = a.changes.length;
    await write();
    const ok = await until(
      () => a.changes.slice(before).some((r) => match(r.event)),
      timeoutMs,
    );
    const hit = a.changes.slice(before).find((r) => match(r.event));
    check(
      `${label} -> A in ${hit ? hit.at - start : "-"}ms`,
      ok,
      a.changes.slice(before).map((r) => r.event),
    );
  }

  // 1. Direct DB writes.
  let inboxId = "";
  await expectDelivery(
    "DB insert inbox (team A)",
    async () => {
      const { rows } = await db.query(
        "INSERT INTO inbox (team_id, file_name, file_path, display_name) VALUES ($1, 'smoke.pdf', ARRAY[$2, 'inbox', 'smoke.pdf'], 'smoke') RETURNING id",
        [teamA, teamA],
      );
      inboxId = rows[0].id;
    },
    (e) => e.table === "inbox" && e.type === "INSERT" && e.new.id === inboxId,
  );
  await expectDelivery(
    "DB update inbox status (team A)",
    () => db.query("UPDATE inbox SET status = 'done' WHERE id = $1", [inboxId]),
    (e) =>
      e.table === "inbox" &&
      e.type === "UPDATE" &&
      e.new.status === "done" &&
      e.old.status === "new",
  );
  let documentId = "";
  await expectDelivery(
    "DB insert document (team A)",
    async () => {
      const { rows } = await db.query(
        "INSERT INTO documents (team_id, name, title) VALUES ($1, $2, 'Smoke') RETURNING id",
        [teamA, `${teamA}/smoke.txt`],
      );
      documentId = rows[0].id;
    },
    (e) => e.table === "documents" && e.new.id === documentId,
  );
  await expectDelivery(
    "DB update document (team A)",
    () =>
      db.query("UPDATE documents SET title = 'Smoke 2' WHERE id = $1", [
        documentId,
      ]),
    (e) =>
      e.table === "documents" && e.type === "UPDATE" && e.new.id === documentId,
  );

  // Document full-text search (fts_* columns maintained by migration 0005).
  const { rows: ftsRows } = await db.query(
    "INSERT INTO documents (team_id, name, title, body) VALUES ($1, $2, 'Quarterly retainer', 'Consulting services for the harbour project') RETURNING id",
    [teamA, `${teamA}/retainer.pdf`],
  );
  const ftsId = ftsRows[0].id as string;
  const found = (await trpc(
    alice.cookie,
    "documents.get",
    { q: "harbour consulting" },
    "query",
  )) as { data: { id: string }[] };
  check(
    "documents.get full-text search finds title/body",
    found.data.some((d) => d.id === ftsId),
    found.data,
  );
  const global = (await trpc(
    alice.cookie,
    "search.global",
    { searchTerm: "retainer" },
    "query",
  )) as { id: string }[];
  check(
    "search.global (global_search) finds the document",
    global.some((r) => r.id === ftsId),
    global,
  );

  // Bulk transactions: one statement-level event per team.
  const txBefore = a.changes.length;
  await expectDelivery(
    "DB bulk insert 50 transactions (team A)",
    () =>
      db.query(
        `INSERT INTO transactions (date, name, method, amount, currency, team_id, internal_id)
         SELECT now()::date, 'tx ' || i, 'other', i, 'USD', $1, $2 || '_' || i
         FROM generate_series(1, 50) i`,
        [teamA, teamA],
      ),
    (e) => e.table === "transactions",
  );
  await sleep(300);
  check(
    "bulk insert produced exactly one transactions event",
    a.changes.slice(txBefore).filter((r) => r.event.table === "transactions")
      .length === 1,
  );

  // 2. API + worker path: vault upload (API writes documents), then an
  // inbox upload processed by the worker (process-attachment).
  const fileName = `smoke-${run}.txt`;
  const path = [teamA, "inbox", fileName];
  await expectDelivery(
    "API upload to vault (documents row via API)",
    async () => {
      const res = await fetch(
        `${API_URL}/files/upload?bucket=vault&path=${encodeURIComponent(path.join("/"))}`,
        {
          method: "POST",
          headers: {
            origin: APP_URL,
            authorization: `Bearer ${await jwt(alice.cookie)}`,
            "content-type": "text/plain",
          },
          body: "Invoice 42 from Smoke Ltd, total 12.00 USD",
        },
      );
      if (!res.ok) throw new Error(`upload: ${await res.text()}`);
    },
    (e) => e.table === "documents" && e.type === "INSERT",
  );
  const workerStart = a.changes.length;
  await expectDelivery(
    "worker process-attachment inserts inbox row",
    () =>
      trpc(alice.cookie, "inbox.processAttachments", [
        { filePath: path, mimetype: "text/plain", size: 42 },
      ]),
    (e) => e.table === "inbox" && e.type === "INSERT",
    10_000,
  );
  await until(
    () =>
      a.changes
        .slice(workerStart)
        .some((r) => r.event.table === "inbox" && r.event.type === "UPDATE"),
    15_000,
  );
  const workerEvents = a.changes
    .slice(workerStart)
    .map((r) => `${r.event.table}:${r.event.type}:${r.event.new.status ?? ""}`);
  check(
    `worker status updates reach A (${workerEvents.join(", ")})`,
    workerEvents.some((e) => e.startsWith("inbox:UPDATE")),
  );

  // Team scoping: B saw nothing of team A, but does see its own team.
  check(
    `B received no team A events (A got ${a.changes.length})`,
    b.changes.every((r) => r.event.team_id !== teamA),
    b.changes.map((r) => r.event),
  );
  await db.query(
    "INSERT INTO customers (team_id, name, email) VALUES ($1, 'Bob Co', 'b@example.com')",
    [teamB],
  );
  check(
    "B receives its own team's customer insert",
    await until(() => b.changes.some((r) => r.event.team_id === teamB), 2_000),
  );
  check(
    "A received no team B events",
    a.changes.every((r) => r.event.team_id !== teamB),
  );

  // 3. Heartbeat.
  const pingStart = Date.now();
  check(
    "heartbeat `ping` within 26s",
    await until(
      () => a.control.some((c) => c.type === "ping" && c.at >= pingStart),
      HEARTBEAT_MS + 1_000,
    ),
  );

  // 4. API restart: the client reconnects and keeps receiving.
  const readyBefore = a.control.filter((c) => c.type === "ready").length;
  api.kill("SIGTERM");
  await api.exited;
  check(
    "client notices the API going away",
    await until(() => a.control.some((c) => c.type === "error"), 5_000),
  );
  api = await startApi();
  check(
    "client reconnects after API restart",
    await until(
      () => a.control.filter((c) => c.type === "ready").length > readyBefore,
      15_000,
    ),
  );
  await expectDelivery(
    "DB insert inbox after reconnect",
    () =>
      db.query(
        "INSERT INTO inbox (team_id, file_name, file_path) VALUES ($1, 'after.pdf', ARRAY[$2, 'inbox', 'after.pdf'])",
        [teamA, teamA],
      ),
    (e) => e.table === "inbox" && e.type === "INSERT",
  );

  a.unsubscribe();
  b.unsubscribe();
  check(
    "streams closed after last unsubscribe",
    !a.manager.connected && !b.manager.connected,
  );
} finally {
  api.kill("SIGTERM");
  worker.kill("SIGTERM");
  await Promise.all([api.exited, worker.exited]);
  await db.end();
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
