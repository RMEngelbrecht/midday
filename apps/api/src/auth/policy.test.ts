import { describe, expect, it } from "bun:test";
import {
  canSignUp,
  cookieSharingProblem,
  deriveCookieDomain,
  isInstanceAdmin,
  matchesAllowlist,
  parseEmailList,
  socialProvidersFromEnv,
} from "./policy";

describe("canSignUp", () => {
  const none = { hasPendingInvite: false, isAllowlisted: false };
  const empty = { userCount: 0, ...none };
  const taken = { userCount: 1, ...none };
  const invited = {
    userCount: 3,
    hasPendingInvite: true,
    isAllowlisted: false,
  };
  const allowlisted = {
    userCount: 3,
    hasPendingInvite: false,
    isAllowlisted: true,
  };

  it("first-user: the first account, then invited or allowlisted emails", () => {
    expect(canSignUp("first-user", empty)).toBe(true);
    expect(canSignUp("first-user", taken)).toBe(false);
    expect(canSignUp("first-user", invited)).toBe(true);
    expect(canSignUp("first-user", allowlisted)).toBe(true);
  });

  it("invite-only: requires an invite or the allowlist, even for the first account", () => {
    expect(canSignUp("invite-only", empty)).toBe(false);
    expect(canSignUp("invite-only", invited)).toBe(true);
    expect(canSignUp("invite-only", allowlisted)).toBe(true);
    expect(
      canSignUp("invite-only", { userCount: 0, ...none, isAllowlisted: true }),
    ).toBe(true);
  });

  it("open: anyone", () => {
    expect(canSignUp("open", taken)).toBe(true);
  });
});

describe("parseEmailList / matchesAllowlist", () => {
  const list = parseEmailList(" @Allowed.test , VIP@example.test,, ");

  it("parses, trims and lowercases entries, dropping empties", () => {
    expect(list).toEqual(["@allowed.test", "vip@example.test"]);
    expect(parseEmailList(undefined)).toEqual([]);
    expect(parseEmailList(" , ")).toEqual([]);
  });

  it("matches exact addresses", () => {
    expect(matchesAllowlist("vip@example.test", list)).toBe(true);
    expect(matchesAllowlist("other@example.test", list)).toBe(false);
  });

  it("matches whole domains", () => {
    expect(matchesAllowlist("anyone@allowed.test", list)).toBe(true);
    expect(matchesAllowlist("anyone@notallowed.test", list)).toBe(false);
  });

  it("does not match subdomains unless listed", () => {
    expect(matchesAllowlist("x@sub.allowed.test", list)).toBe(false);
    expect(matchesAllowlist("x@sub.allowed.test", ["@sub.allowed.test"])).toBe(
      true,
    );
  });

  it("ignores case and surrounding whitespace", () => {
    expect(matchesAllowlist(" VIP@Example.TEST ", list)).toBe(true);
    expect(matchesAllowlist("X@ALLOWED.TEST", list)).toBe(true);
  });

  it("an exact entry does not act as a domain", () => {
    expect(matchesAllowlist("allowed.test", list)).toBe(false);
    expect(
      matchesAllowlist("evil@vip@example.test", ["vip@example.test"]),
    ).toBe(false);
  });

  it("an empty list matches nothing", () => {
    expect(matchesAllowlist("a@b.test", [])).toBe(false);
    expect(matchesAllowlist("a@b.test", parseEmailList(""))).toBe(false);
  });
});

describe("isInstanceAdmin", () => {
  const adminEmails = parseEmailList("ops@example.test");

  it("the first user is an admin", () => {
    expect(
      isInstanceAdmin({
        userId: "u1",
        email: "first@x.test",
        firstUserId: "u1",
        adminEmails,
      }),
    ).toBe(true);
  });

  it("ADMIN_EMAILS are admins", () => {
    expect(
      isInstanceAdmin({
        userId: "u2",
        email: "OPS@example.test",
        firstUserId: "u1",
        adminEmails,
      }),
    ).toBe(true);
  });

  it("everyone else is not", () => {
    expect(
      isInstanceAdmin({
        userId: "u3",
        email: "guest@other.test",
        firstUserId: "u1",
        adminEmails,
      }),
    ).toBe(false);
    expect(
      isInstanceAdmin({
        userId: "u3",
        email: "guest@other.test",
        firstUserId: undefined,
        adminEmails: [],
      }),
    ).toBe(false);
  });
});

describe("deriveCookieDomain", () => {
  it("shares the parent domain of app and api subdomains", () => {
    expect(
      deriveCookieDomain("https://app.example.com", "https://api.example.com"),
    ).toBe("example.com");
    expect(
      deriveCookieDomain(
        "https://midday.corp.example.com",
        "https://api.midday.corp.example.com",
      ),
    ).toBe("midday.corp.example.com");
  });

  it("uses host-only cookies for one host, localhost and IPs", () => {
    expect(
      deriveCookieDomain("http://localhost:3001", "http://localhost:3003"),
    ).toBeUndefined();
    expect(
      deriveCookieDomain("http://10.0.0.5:3001", "http://10.0.0.5:3003"),
    ).toBeUndefined();
    expect(
      deriveCookieDomain(
        "https://midday.example.com",
        "https://midday.example.com",
      ),
    ).toBeUndefined();
  });

  it("never returns a bare TLD", () => {
    expect(
      deriveCookieDomain("https://app.one.com", "https://api.two.com"),
    ).toBeUndefined();
  });

  it("prefers an explicit override", () => {
    expect(
      deriveCookieDomain(
        "http://localhost",
        "http://localhost",
        ".example.co.uk",
      ),
    ).toBe("example.co.uk");
  });
});

describe("socialProvidersFromEnv", () => {
  it("enables a provider only when id and secret are both set", () => {
    expect(socialProvidersFromEnv({})).toEqual({});
    expect(socialProvidersFromEnv({ AUTH_GITHUB_CLIENT_ID: "id" })).toEqual({});
    expect(
      Object.keys(
        socialProvidersFromEnv({
          AUTH_GITHUB_CLIENT_ID: "id",
          AUTH_GITHUB_CLIENT_SECRET: "secret",
          AUTH_MICROSOFT_CLIENT_ID: "ms",
          AUTH_MICROSOFT_CLIENT_SECRET: "ms-secret",
        }),
      ),
    ).toEqual(["github", "microsoft"]);
  });

  it("defaults the Microsoft tenant to common", () => {
    const { microsoft } = socialProvidersFromEnv({
      AUTH_MICROSOFT_CLIENT_ID: "ms",
      AUTH_MICROSOFT_CLIENT_SECRET: "ms-secret",
    });
    expect(microsoft?.tenantId).toBe("common");
  });
});

describe("cookieSharingProblem", () => {
  it("flags different *.localhost hosts", () => {
    expect(
      cookieSharingProblem(
        "http://app.localhost",
        "http://api.localhost",
        undefined,
      ),
    ).toContain("lvh.me");
  });

  it("accepts a shared domain, one host and a cookie domain", () => {
    expect(
      cookieSharingProblem("http://app.lvh.me", "http://api.lvh.me", "lvh.me"),
    ).toBeUndefined();
    expect(
      cookieSharingProblem(
        "http://localhost:3001",
        "http://localhost:3003",
        undefined,
      ),
    ).toBeUndefined();
  });
});
