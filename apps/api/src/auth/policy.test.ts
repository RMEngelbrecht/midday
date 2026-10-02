import { describe, expect, it } from "bun:test";
import {
  canSignUp,
  deriveCookieDomain,
  socialProvidersFromEnv,
} from "./policy";

describe("canSignUp", () => {
  const empty = { userCount: 0, hasPendingInvite: false };
  const taken = { userCount: 1, hasPendingInvite: false };
  const invited = { userCount: 3, hasPendingInvite: true };

  it("first-user: only the first account, then invited emails", () => {
    expect(canSignUp("first-user", empty)).toBe(true);
    expect(canSignUp("first-user", taken)).toBe(false);
    expect(canSignUp("first-user", invited)).toBe(true);
  });

  it("invite-only: requires an invite, even for the first account", () => {
    expect(canSignUp("invite-only", empty)).toBe(false);
    expect(canSignUp("invite-only", invited)).toBe(true);
  });

  it("open: anyone", () => {
    expect(canSignUp("open", taken)).toBe(true);
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
