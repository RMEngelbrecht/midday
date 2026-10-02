/**
 * End-to-end auth smoke test against a running API + dashboard.
 *
 *   APP_URL=http://localhost:3541 API_URL=http://localhost:3441 \
 *   DATABASE_URL=postgres://... REDIS_URL=redis://... \
 *   bun apps/api/scripts/auth-smoke.ts
 *
 * Expects ALLOW_SIGNUP=first-user and no social providers configured. It
 * wipes auth users, invites, teams and the `teams` queue first, so only run
 * it against a throwaway database.
 */
import { createHash, randomBytes } from "node:crypto";
import { Queue } from "bullmq";
import { generate } from "otplib";
import { Client } from "pg";

const APP_URL = required("APP_URL");
const API_URL = required("API_URL");
const DATABASE_URL = required("DATABASE_URL");
const REDIS_URL = required("REDIS_URL");

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

/** Minimal cookie jar: one per simulated browser. */
class Jar {
  cookies = new Map<string, string>();
  store(res: Response) {
    for (const raw of res.headers.getSetCookie()) {
      const [pair, ...attrs] = raw.split(";");
      const index = pair!.indexOf("=");
      const name = pair!.slice(0, index).trim();
      const value = pair!.slice(index + 1).trim();
      const expired = attrs.some((a) => /max-age=0\b/i.test(a.trim()));
      if (expired || value === "") this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }
  header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join("; ");
  }
  has(name: string) {
    return this.cookies.has(name);
  }
}

async function req(
  jar: Jar | null,
  url: string,
  init: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
  } = {},
) {
  const res = await fetch(url, {
    method: init.method ?? (init.body ? "POST" : "GET"),
    redirect: "manual",
    headers: {
      origin: APP_URL,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(jar ? { cookie: jar.header() } : {}),
      ...init.headers,
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
  });
  jar?.store(res);
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { res, status: res.status, json, text };
}

const auth = (path: string) => `${API_URL}/auth${path}`;

async function trpcQuery(path: string, token: string) {
  const r = await req(null, `${API_URL}/trpc/${path}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: r.status, data: r.json?.result?.data?.json ?? r.json };
}

async function trpcMutation(path: string, token: string) {
  const r = await req(null, `${API_URL}/trpc/${path}`, {
    method: "POST",
    body: { json: null },
    headers: { authorization: `Bearer ${token}` },
  });
  return { status: r.status, data: r.json?.result?.data?.json ?? r.json };
}

const db = new Client({ connectionString: DATABASE_URL });
await db.connect();
const queue = new Queue("teams", { connection: { url: REDIS_URL } });

// --- reset --------------------------------------------------------------
await db.query(`DELETE FROM auth."user"`);
await db.query("DELETE FROM public.user_invites");
await db.query("DELETE FROM public.teams");
await queue.obliterate({ force: true });

const PASSWORD = "correct-horse-battery";

// --- sign-up policy (first-user) ----------------------------------------
const alice = new Jar();
let r = await req(alice, auth("/sign-up/email"), {
  body: { email: "alice@example.com", password: PASSWORD, name: "Alice" },
});
check("sign-up: first user allowed", r.status === 200, r.json);
const aliceId: string = r.json?.user?.id;

r = await req(new Jar(), auth("/sign-up/email"), {
  body: { email: "bob@example.com", password: PASSWORD, name: "Bob" },
});
check(
  "sign-up: second user rejected (first-user policy)",
  r.status === 403 && r.json?.code === "SIGNUP_DISABLED",
  r.json,
);

await db.query("INSERT INTO public.user_invites (email) VALUES ($1)", [
  "Carol@example.com",
]);
r = await req(new Jar(), auth("/sign-up/email"), {
  body: { email: "carol@example.com", password: PASSWORD, name: "Carol" },
});
check("sign-up: invited user allowed", r.status === 200, r.json);
const carolId: string = r.json?.user?.id;

const profiles = await db.query(
  "SELECT id, full_name FROM public.users WHERE id = ANY($1)",
  [[aliceId, carolId]],
);
check(
  "sign-up: public.users rows created by trigger",
  profiles.rowCount === 2,
  profiles.rows,
);

// --- email + password login, session, JWT -------------------------------
const browser = new Jar();
r = await req(browser, auth("/sign-in/email"), {
  body: { email: "alice@example.com", password: PASSWORD },
});
check(
  "login: email + password",
  r.status === 200 && r.json?.user?.id === aliceId,
);

r = await req(browser, auth("/get-session"));
const jwt = r.res.headers.get("set-auth-jwt");
check(
  "get-session returns the user and a JWT (set-auth-jwt)",
  r.json?.user?.email === "alice@example.com" && !!jwt,
  r.json,
);

// Dashboard server: JWT from get-session; browser: JWT from /auth/token.
let me = await trpcQuery("user.me", jwt!);
check("tRPC user.me with get-session JWT", me.data?.id === aliceId, me);

r = await req(browser, auth("/token"));
const clientJwt: string = r.json?.token;
me = await trpcQuery("user.me", clientJwt);
check("tRPC user.me with /auth/token JWT", me.data?.id === aliceId, me);

me = await trpcQuery("user.me", "not-a-token");
check("tRPC user.me rejects a bad token", me.status === 401, me);

r = await req(null, auth("/jwks"));
check("JWKS served at /auth/jwks", (r.json?.keys?.length ?? 0) > 0);

// --- TOTP enroll ---------------------------------------------------------
r = await req(browser, auth("/two-factor/enable"), {
  body: { password: PASSWORD },
});
const totpURI: string | undefined = r.json?.totpURI;
check(
  "2FA: enable returns TOTP URI and backup codes",
  !!totpURI && (r.json?.backupCodes?.length ?? 0) > 0,
  r.json,
);
const secret = new URL(totpURI!).searchParams.get("secret")!;

r = await req(browser, auth("/two-factor/verify-totp"), {
  body: { code: await generate({ secret }) },
});
check("2FA: first code verifies enrollment", r.status === 200, r.json);

r = await req(browser, auth("/get-session"));
check("2FA: user.twoFactorEnabled", r.json?.user?.twoFactorEnabled === true);

// --- logout ---------------------------------------------------------------
r = await req(browser, auth("/sign-out"), { body: {} });
check("logout", r.status === 200);
r = await req(browser, auth("/get-session"));
check("logout: no session afterwards", r.json === null, r.json);

// --- login requires TOTP --------------------------------------------------
r = await req(browser, auth("/sign-in/email"), {
  body: { email: "alice@example.com", password: PASSWORD },
});
check(
  "login with 2FA: password alone gives a TOTP challenge, not a session",
  r.json?.twoFactorRedirect === true && !browser.has("midday.session_token"),
  r.json,
);
r = await req(browser, auth("/get-session"));
check("login with 2FA: no session before TOTP", r.json === null);

r = await req(browser, auth("/two-factor/verify-totp"), {
  body: { code: "000000" },
});
check("login with 2FA: wrong code rejected", r.status === 401, r.json);

r = await req(browser, auth("/two-factor/verify-totp"), {
  body: { code: await generate({ secret }) },
});
check("login with 2FA: TOTP completes sign-in", r.status === 200, r.json);
r = await req(browser, auth("/get-session"));
check("login with 2FA: session established", r.json?.user?.id === aliceId);
const jwtAfter2fa = r.res.headers.get("set-auth-jwt")!;

// --- REST: API key still works -------------------------------------------
const team = await db.query(
  "INSERT INTO public.teams (name) VALUES ('Smoke') RETURNING id",
);
const teamId = team.rows[0].id;
await db.query(
  "INSERT INTO public.users_on_team (user_id, team_id, role) VALUES ($1, $2, 'owner')",
  [aliceId, teamId],
);
await db.query("UPDATE public.users SET team_id = $2 WHERE id = $1", [
  aliceId,
  teamId,
]);
const apiKey = `mid_${randomBytes(32).toString("hex")}`;
await db.query(
  `INSERT INTO public.api_keys (key_encrypted, name, user_id, team_id, key_hash, scopes)
   VALUES ('unused', 'smoke', $1, $2, $3, '{apis.all}')`,
  [aliceId, teamId, createHash("sha256").update(apiKey).digest("hex")],
);
r = await req(null, `${API_URL}/users/me`, {
  headers: { authorization: `Bearer ${apiKey}` },
});
check(
  "REST /users/me with API key",
  r.status === 200 && r.json?.id === aliceId,
  r.json,
);

r = await req(null, `${API_URL}/users/me`, {
  headers: { authorization: `Bearer ${jwtAfter2fa}` },
});
check(
  "REST /users/me with session JWT",
  r.status === 200 && r.json?.id === aliceId,
  r.json,
);

// --- dashboard pages -------------------------------------------------------
r = await req(null, `${APP_URL}/login`);
check(
  "dashboard /login renders password sign-in",
  r.status === 200 && r.text.includes("Sign in"),
);
check(
  "dashboard /login shows no unconfigured social provider",
  !/Continue with (Google|Apple|Github|Microsoft)/.test(r.text),
);

r = await req(null, `${APP_URL}/settings`);
check(
  "dashboard protected page without session -> /login",
  r.status === 307 &&
    (r.res.headers.get("location") ?? "").includes("/login?return_to=settings"),
  { status: r.status, location: r.res.headers.get("location") },
);

r = await req(browser, `${APP_URL}/settings`);
check("dashboard protected page with session renders", r.status === 200, {
  status: r.status,
  location: r.res.headers.get("location"),
});

// --- desktop one-time-token handoff ---------------------------------------
r = await req(browser, `${APP_URL}/api/auth/callback?client=desktop`);
const verifyUrl = new URL(r.res.headers.get("location") ?? "", APP_URL);
const code = verifyUrl.searchParams.get("code");
check(
  "desktop: browser callback mints a one-time code -> /verify",
  r.status === 307 && verifyUrl.pathname === "/verify" && !!code,
  { status: r.status, location: r.res.headers.get("location") },
);

const desktop = new Jar();
r = await req(desktop, `${APP_URL}/api/auth/callback?code=${code}`);
check(
  "desktop: webview redeems the code and gets a session cookie",
  r.status === 307 && desktop.has("midday.session_token"),
  { status: r.status, cookies: [...desktop.cookies.keys()] },
);
r = await req(desktop, auth("/get-session"));
check("desktop: session belongs to the user", r.json?.user?.id === aliceId);

r = await req(new Jar(), `${APP_URL}/api/auth/callback?code=${code}`);
check(
  "desktop: one-time code cannot be reused",
  (r.res.headers.get("location") ?? "").endsWith("/login"),
  { location: r.res.headers.get("location") },
);

// --- onboarding job --------------------------------------------------------
const jobs = await queue.getJobs(["delayed", "waiting", "active"]);
const onboarded = jobs
  .filter((job) => job.name === "onboard-team")
  .map((job) => job.data.userId);
check(
  "onboard-team enqueued for each new user",
  onboarded.includes(aliceId) && onboarded.includes(carolId),
  onboarded,
);

// --- account deletion --------------------------------------------------------
const deleted = await trpcMutation("user.delete", jwtAfter2fa);
check("tRPC user.delete", deleted.status === 200, deleted);
const authRows = await db.query(`SELECT 1 FROM auth."user" WHERE id = $1`, [
  aliceId,
]);
const profileRows = await db.query("SELECT 1 FROM public.users WHERE id = $1", [
  aliceId,
]);
const sessionRows = await db.query(
  "SELECT 1 FROM auth.session WHERE user_id = $1",
  [aliceId],
);
check(
  "deletion removes auth.user, public.users and sessions",
  authRows.rowCount === 0 &&
    profileRows.rowCount === 0 &&
    sessionRows.rowCount === 0,
);
const teamRows = await db.query("SELECT 1 FROM public.teams WHERE id = $1", [
  teamId,
]);
check("deletion removes the user's sole-member team", teamRows.rowCount === 0);

await queue.close();
await db.end();

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
