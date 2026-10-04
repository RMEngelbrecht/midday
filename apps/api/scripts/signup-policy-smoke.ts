/**
 * Sign-up policy, allowlist, instance admins and instance invites, end to end
 * against a running API + dashboard.
 *
 *   APP_URL=http://localhost:3553 API_URL=http://localhost:3453 \
 *   DATABASE_URL=postgres://... bun apps/api/scripts/signup-policy-smoke.ts
 *
 * The API must run with:
 *   ALLOW_SIGNUP=first-user
 *   SIGNUP_ALLOWED_EMAILS=@allowed.test,vip@example.test
 *   ADMIN_EMAILS=ops@example.test
 *
 * It wipes auth users, invites and teams first, so only run it against a
 * throwaway database.
 */
import { Client } from "pg";

const APP_URL = required("APP_URL");
const API_URL = required("API_URL");
const DATABASE_URL = required("DATABASE_URL");

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
}

async function req(
  jar: Jar | null,
  url: string,
  init: { body?: unknown; headers?: Record<string, string> } = {},
) {
  const res = await fetch(url, {
    method: init.body ? "POST" : "GET",
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
const PASSWORD = "correct-horse-battery";

type User = { id: string; email: string; jar: Jar; token: string };

async function signUp(email: string, name = email.split("@")[0]!) {
  const jar = new Jar();
  const r = await req(jar, auth("/sign-up/email"), {
    body: { email, password: PASSWORD, name },
  });
  return { ...r, jar };
}

async function session(jar: Jar, email: string): Promise<User> {
  const r = await req(jar, auth("/get-session"));
  return {
    id: r.json?.user?.id,
    email,
    jar,
    token: r.res.headers.get("set-auth-jwt") ?? "",
  };
}

async function trpc(
  user: User,
  path: string,
  input?: unknown,
  kind: "query" | "mutation" = input === undefined ? "query" : "mutation",
) {
  const url =
    kind === "query"
      ? `${API_URL}/trpc/${path}${input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify({ json: input }))}`}`
      : `${API_URL}/trpc/${path}`;
  const r = await req(null, url, {
    body: kind === "mutation" ? { json: input ?? null } : undefined,
    headers: { authorization: `Bearer ${user.token}` },
  });
  return {
    status: r.status,
    data: r.json?.result?.data?.json,
    code: r.json?.error?.json?.data?.code,
    raw: r.json,
  };
}

const rejected = (r: { status: number; json: any }) =>
  r.status === 403 && r.json?.code === "SIGNUP_DISABLED";

const db = new Client({ connectionString: DATABASE_URL });
await db.connect();

const memberships = async (userId: string) =>
  (
    await db.query(
      "SELECT team_id FROM public.users_on_team WHERE user_id = $1",
      [userId],
    )
  ).rows;
const instanceInviteCount = async (email: string) =>
  Number(
    (
      await db.query(
        "SELECT count(*) FROM public.instance_invites WHERE lower(email) = lower($1)",
        [email],
      )
    ).rows[0].count,
  );

// --- reset --------------------------------------------------------------
await db.query(`DELETE FROM auth."user"`);
await db.query("DELETE FROM public.user_invites");
await db.query("DELETE FROM public.instance_invites");
await db.query("DELETE FROM public.teams");

// --- first user is an admin ---------------------------------------------
let r = await signUp("first@example.test", "First Admin");
check("first user signs up", r.status === 200, r.json);
const admin = await session(r.jar, "first@example.test");
let t = await trpc(admin, "instance.isAdmin");
check("first user is an instance admin", t.data === true, t.raw);

// --- policy + allowlist -------------------------------------------------
r = await signUp("random@other.test");
check("random@other.test rejected", rejected(r), r.json);

r = await signUp("x@allowed.test");
check("x@allowed.test allowed (domain allowlist)", r.status === 200, r.json);
const allowed = await session(r.jar, "x@allowed.test");

r = await signUp("VIP@example.test");
check(
  "VIP@example.test allowed (exact, case-insensitive)",
  r.status === 200,
  r.json,
);

r = await signUp("y@sub.allowed.test");
check(
  "y@sub.allowed.test rejected (subdomain not listed)",
  rejected(r),
  r.json,
);

t = await trpc(allowed, "instance.isAdmin");
check("allowlisted user is not an admin", t.data === false, t.raw);
check(
  "allowlisted user has no team",
  (await memberships(allowed.id)).length === 0,
);

// --- email OTP sign-up is gated too ---------------------------------------
async function otpSignIn(email: string) {
  const jar = new Jar();
  await req(jar, auth("/email-otp/send-verification-otp"), {
    body: { email, type: "sign-in" },
  });
  const row = await db.query(
    "SELECT value FROM auth.verification WHERE identifier LIKE $1 ORDER BY created_at DESC LIMIT 1",
    [`%${email}`],
  );
  const otp = String(row.rows[0]?.value ?? "").split(":")[0];
  const res = await req(jar, auth("/sign-in/email-otp"), {
    body: { email, otp },
  });
  return { ...res, jar };
}

r = await otpSignIn("otp-random@other.test");
check("email OTP: uninvited sign-up rejected", rejected(r), r.json);

// --- instance admin: non-admins are FORBIDDEN ------------------------------
t = await trpc(allowed, "instance.invites.create", { email: "z@other.test" });
check(
  "non-admin instance.invites.create -> FORBIDDEN",
  t.code === "FORBIDDEN",
  t.raw,
);
t = await trpc(allowed, "instance.invites.list");
check(
  "non-admin instance.invites.list -> FORBIDDEN",
  t.code === "FORBIDDEN",
  t.raw,
);

// --- instance invite -> own account, no team -----------------------------
t = await trpc(admin, "instance.invites.create", { email: "guest@other.test" });
check("admin creates instance invite", t.status === 200 && !!t.data?.id, t.raw);

t = await trpc(admin, "instance.invites.create", { email: "Guest@other.test" });
check("duplicate instance invite -> CONFLICT", t.code === "CONFLICT", t.raw);

t = await trpc(admin, "instance.invites.create", { email: "x@allowed.test" });
check("inviting an existing account -> CONFLICT", t.code === "CONFLICT", t.raw);

t = await trpc(admin, "instance.invites.list");
check(
  "admin lists the pending invite",
  t.data?.length === 1 && t.data[0].email === "guest@other.test",
  t.raw,
);

r = await signUp("guest@other.test");
check("instance invitee signs up", r.status === 200, r.json);
const guest = await session(r.jar, "guest@other.test");
check(
  "instance invite consumed on sign-up",
  (await instanceInviteCount("guest@other.test")) === 0,
);
check(
  "guest has no team membership",
  (await memberships(guest.id)).length === 0,
);
t = await trpc(guest, "instance.isAdmin");
check("guest is not an admin", t.data === false, t.raw);
t = await trpc(guest, "user.invites");
check(
  "guest sees no team invites",
  Array.isArray(t.data) && t.data.length === 0,
  t.raw,
);

// Email OTP sign-up with an instance invite.
await trpc(admin, "instance.invites.create", { email: "otp-guest@other.test" });
r = await otpSignIn("otp-guest@other.test");
check("email OTP: invited sign-up allowed", r.status === 200, r.json);
check(
  "email OTP: invite consumed",
  (await instanceInviteCount("otp-guest@other.test")) === 0,
);

// --- ADMIN_EMAILS -----------------------------------------------------------
r = await signUp("ops@example.test");
check("ops@example.test (ADMIN_EMAILS) can sign up", r.status === 200, r.json);
const ops = await session(r.jar, "ops@example.test");
t = await trpc(ops, "instance.isAdmin");
check("ops@example.test is an admin", t.data === true, t.raw);

// --- revoke -------------------------------------------------------------------
t = await trpc(ops, "instance.invites.create", { email: "revoked@other.test" });
const revokeId: string = t.data?.id;
t = await trpc(ops, "instance.invites.revoke", { id: revokeId });
check("revoke deletes the invite", t.status === 200, t.raw);
check(
  "revoked invite is gone",
  (await instanceInviteCount("revoked@other.test")) === 0,
);
r = await signUp("revoked@other.test");
check("revoked invitee rejected", rejected(r), r.json);

// --- team invites still work ---------------------------------------------------
t = await trpc(admin, "team.invite", [
  { email: "z@other.test", role: "member" },
]);
check(
  "team invite without a team -> BAD_REQUEST (no team-less user_invites)",
  t.code === "BAD_REQUEST",
  t.raw,
);

t = await trpc(admin, "team.create", {
  name: "Admin Co",
  baseCurrency: "USD",
  countryCode: "US",
  companyType: "small_team",
  heardAbout: "other",
  switchTeam: true,
});
check("admin creates a team", t.status === 200, t.raw);
const teamId: string = t.data;

t = await trpc(admin, "team.invite", [
  { email: "member@other.test", role: "member" },
]);
check("admin sends a team invite", t.data?.sent === 1, t.raw);

t = await trpc(admin, "instance.invites.list");
check(
  "team invites do not show up as instance invites",
  Array.isArray(t.data) && t.data.length === 0,
  t.raw,
);

r = await signUp("member@other.test", "Member");
check("team invitee signs up", r.status === 200, r.json);
const member = await session(r.jar, "member@other.test");

t = await trpc(member, "user.invites");
const teamInvite = t.data?.[0];
check(
  "team invitee sees the invite with the inviter's team",
  t.data?.length === 1 && teamInvite?.team?.id === teamId,
  t.raw,
);

t = await trpc(member, "team.acceptInvite", { id: teamInvite?.id });
check("team invitee accepts", t.status === 200, t.raw);
const memberTeams = await memberships(member.id);
check(
  "team invitee joined the inviter's team",
  memberTeams.length === 1 && memberTeams[0].team_id === teamId,
  memberTeams,
);
t = await trpc(member, "user.switchTeam", { teamId });
check("team invitee switches to the team", t.status === 200, t.raw);
t = await trpc(admin, "team.members");
check(
  "inviter sees the new member",
  t.data?.some((m: any) => m.user?.id === member.id),
  t.raw,
);
t = await trpc(member, "instance.isAdmin");
check("team member is not an admin", t.data === false, t.raw);

// --- dashboard ---------------------------------------------------------------
let page = await req(admin.jar, `${APP_URL}/settings/instance`);
check(
  "dashboard: admin sees Settings > Instance",
  page.status === 200 && page.text.includes("Invite to this instance"),
  { status: page.status, location: page.res.headers.get("location") },
);
page = await req(admin.jar, `${APP_URL}/settings`);
check(
  "dashboard: admin settings nav has Instance",
  page.status === 200 && page.text.includes('href="/settings/instance"'),
);

page = await req(member.jar, `${APP_URL}/settings/instance`);
check(
  "dashboard: non-admin is redirected away from Settings > Instance",
  page.status === 307 &&
    new URL(page.res.headers.get("location") ?? "", APP_URL).pathname ===
      "/settings",
  { status: page.status, location: page.res.headers.get("location") },
);
page = await req(member.jar, `${APP_URL}/settings`);
check(
  "dashboard: non-admin settings nav has no Instance",
  page.status === 200 && !page.text.includes('href="/settings/instance"'),
  { status: page.status },
);

page = await req(null, `${APP_URL}/login?email=guest2%40other.test`);
check(
  "dashboard: /login?email= opens the prefilled sign-up form",
  page.status === 200 &&
    page.text.includes("Create account") &&
    page.text.includes("guest2@other.test"),
);

await db.end();

console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
