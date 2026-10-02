/**
 * End-to-end check of file storage against a running API:
 * upload, signed read (+range), cross-team isolation, public objects, delete.
 *
 *   STORAGE_IT_API=http://localhost:3442 \
 *   STORAGE_IT_DATABASE_URL=postgres://postgres:postgres@localhost:5442/midday_test \
 *   bun scripts/storage-integration.ts
 *
 * Seeds two teams with API keys directly in Postgres. Exits non-zero on failure.
 */
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { SQL } from "bun";

const API = process.env.STORAGE_IT_API ?? "http://localhost:3442";
const sql = new SQL(
  process.env.STORAGE_IT_DATABASE_URL ??
    "postgres://postgres:postgres@localhost:5442/midday_test",
);

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` ${JSON.stringify(detail)}`}`,
  );
  if (!ok) failures++;
}

async function seedTeam(label: string) {
  const teamId = randomUUID();
  const userId = randomUUID();
  const key = `mid_${randomBytes(32).toString("hex")}`;
  await sql`insert into public.teams (id, name) values (${teamId}, ${`IT ${label}`})`;
  await sql`insert into auth."user" (id, name, email) values (${userId}, ${label}, ${`${userId}@it.test`})`;
  await sql`update public.users set team_id = ${teamId} where id = ${userId}`;
  await sql`insert into public.users_on_team (user_id, team_id, role) values (${userId}, ${teamId}, 'owner')`;
  await sql`insert into public.api_keys (key_encrypted, name, user_id, team_id, key_hash, scopes)
            values ('it', 'it', ${userId}, ${teamId}, ${createHash("sha256").update(key).digest("hex")}, '{apis.all}')`;
  return { teamId, userId, auth: { Authorization: `Bearer ${key}` } };
}

const pdf = new TextEncoder().encode(
  `%PDF-1.4\n% storage integration ${randomUUID()}\n%%EOF\n`,
);

function upload(
  auth: Record<string, string>,
  bucket: string,
  path: string,
  body: Uint8Array,
  type: string,
) {
  const query = new URLSearchParams({ bucket, path });
  return fetch(`${API}/files/upload?${query}`, {
    method: "POST",
    headers: { ...auth, "Content-Type": type },
    body,
  });
}

const a = await seedTeam("A");
const b = await seedTeam("B");
const vaultPath = `${a.teamId}/inbox/invoice ${Date.now()}.pdf`;

// Upload as team A
const up = await upload(a.auth, "vault", vaultPath, pdf, "application/pdf");
const upBody = (await up.json()) as { path: string[]; url: string | null };
check("A uploads PDF to own vault", up.status === 200, upBody);
check("upload returns path tokens", upBody.path?.join("/") === vaultPath);

// documents row is the vault projection
const [doc] =
  await sql`select id, metadata from public.documents where team_id = ${a.teamId} and name = ${vaultPath}`;
check("documents row created", Boolean(doc), doc);
check(
  "documents metadata has size + mimetype",
  doc?.metadata?.size === pdf.byteLength &&
    doc?.metadata?.mimetype === "application/pdf",
  doc?.metadata,
);

// Signed URL via the public REST API
const pre = await fetch(`${API}/documents/${doc.id}/presigned-url`, {
  method: "POST",
  headers: a.auth,
});
const preBody = (await pre.json()) as { url: string };
check("A gets presigned URL", pre.status === 200 && !!preBody.url, preBody);

const viaSigned = await fetch(preBody.url);
const signedBytes = new Uint8Array(await viaSigned.arrayBuffer());
check(
  "signed URL returns the PDF",
  viaSigned.status === 200 &&
    Buffer.compare(Buffer.from(signedBytes), Buffer.from(pdf)) === 0,
  { status: viaSigned.status, type: viaSigned.headers.get("content-type") },
);
check(
  "signed URL serves application/pdf as attachment",
  (viaSigned.headers.get("content-type") ?? "").startsWith("application/pdf") &&
    (viaSigned.headers.get("content-disposition") ?? "").startsWith(
      "attachment",
    ),
  Object.fromEntries(viaSigned.headers),
);

const ranged = await fetch(preBody.url, { headers: { Range: "bytes=0-3" } });
check(
  "range request returns 206 %PDF",
  ranged.status === 206 && (await ranged.text()) === "%PDF",
  ranged.status,
);

if (preBody.url.includes("/files/serve?token=")) {
  const tampered = preBody.url.replace(/token=([^.]+)\./, (_m, d: string) => {
    const payload = JSON.parse(Buffer.from(d, "base64url").toString());
    payload.k = `vault/${b.teamId}/x.pdf`;
    return `token=${Buffer.from(JSON.stringify(payload)).toString("base64url")}.`;
  });
  check("tampered token rejected", (await fetch(tampered)).status === 403);
}

// Team isolation
const bIntoA = await upload(
  b.auth,
  "vault",
  `${a.teamId}/inbox/evil.pdf`,
  pdf,
  "application/pdf",
);
check(
  "B cannot upload into A's prefix (403)",
  bIntoA.status === 403,
  bIntoA.status,
);

const bTraversal = await upload(
  b.auth,
  "vault",
  `${b.teamId}/../${a.teamId}/inbox/evil.pdf`,
  pdf,
  "application/pdf",
);
check(
  "B traversal path rejected (400)",
  bTraversal.status === 400,
  bTraversal.status,
);

const bPresign = await fetch(`${API}/documents/${doc.id}/presigned-url`, {
  method: "POST",
  headers: b.auth,
});
check(
  "B cannot presign A's document (404)",
  bPresign.status === 404,
  bPresign.status,
);

const bAvatarIntoA = await upload(
  b.auth,
  "avatars",
  `${a.userId}/me.png`,
  pdf,
  "image/png",
);
check("B cannot write A's avatar (403)", bAvatarIntoA.status === 403);

const unauth = await upload(
  {},
  "vault",
  `${a.teamId}/x.pdf`,
  pdf,
  "application/pdf",
);
check(
  "unauthenticated upload rejected (401)",
  unauth.status === 401,
  unauth.status,
);

check(
  "vault is not served publicly (404)",
  (await fetch(`${API}/files/public/vault/${encodeURI(vaultPath)}`)).status ===
    404,
);

// Public bucket
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);
const avatar = await upload(
  a.auth,
  "avatars",
  `${a.userId}/me.png`,
  png,
  "image/png",
);
const avatarBody = (await avatar.json()) as { url: string };
const avatarGet = await fetch(avatarBody.url);
check(
  "public avatar URL readable without auth",
  avatar.status === 200 &&
    avatarGet.status === 200 &&
    avatarGet.headers.get("content-type") === "image/png",
  { url: avatarBody.url, status: avatarGet.status },
);

// Delete
const del = await fetch(`${API}/documents/${doc.id}`, {
  method: "DELETE",
  headers: a.auth,
});
check("A deletes document", del.status === 200, del.status);
check("deleted file is gone", (await fetch(preBody.url)).status === 404);

await sql.end();
console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
process.exit(failures ? 1 : 0);
