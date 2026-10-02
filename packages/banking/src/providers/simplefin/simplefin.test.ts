import { describe, expect, test } from "bun:test";
import { decrypt } from "@midday/encryption";
import {
  decodeSetupToken,
  encryptAccessUrl,
  parseAccessUrl,
  SimplefinApi,
} from "./simplefin-api";
import { SimplefinProvider } from "./simplefin-provider";

const ACCESS_URL = "https://user%40x:p%3Ass@bridge.example.org/simplefin";
const CLAIM_URL = "https://bridge.example.org/simplefin/claim/abc123";
const SETUP_TOKEN = Buffer.from(CLAIM_URL).toString("base64");

const payload = {
  errors: [],
  accounts: [
    {
      org: { domain: "mybank.com", name: "My Bank", "sfin-url": "https://x" },
      id: "ACT-1",
      name: "Checking",
      currency: "USD",
      balance: "1500.25",
      "available-balance": "1400.00",
      "balance-date": 1735689600,
      transactions: [
        {
          id: "T1",
          posted: 1735776000,
          amount: "-45.20",
          description: "WHOLE FOODS #123",
        },
        {
          id: "T2",
          posted: 1735862400,
          amount: "2500.00",
          description: "payroll",
        },
        {
          id: "T3",
          posted: 0,
          transacted_at: 1735948800,
          amount: "-9.99",
          description: "pending coffee",
          pending: true,
        },
      ],
    },
    {
      org: { domain: "mybank.com", name: "My Bank" },
      id: "ACT-2",
      name: "Visa Credit Card",
      currency: "USD",
      balance: "-320.10",
      "balance-date": 1735689600,
      transactions: [],
    },
  ],
};

function mockFetch(handler: (url: string, init?: RequestInit) => Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    return handler(url, init);
  }) as typeof fetch;
  return { fn, calls };
}

describe("claim", () => {
  test("decodes setup token (base64 and url-safe)", () => {
    expect(decodeSetupToken(SETUP_TOKEN)).toBe(CLAIM_URL);
    expect(decodeSetupToken(`  ${SETUP_TOKEN}\n`)).toBe(CLAIM_URL);
    expect(() => decodeSetupToken("not a token")).toThrow();
  });

  test("POSTs to the claim URL and returns the access URL", async () => {
    const { fn, calls } = mockFetch(() => new Response(`${ACCESS_URL}\n`));
    const url = await new SimplefinApi(fn).claim(SETUP_TOKEN);
    expect(url).toBe(ACCESS_URL);
    expect(calls[0]?.url).toBe(CLAIM_URL);
    expect(calls[0]?.init?.method).toBe("POST");
  });

  test("already-claimed token", async () => {
    const { fn } = mockFetch(() => new Response("", { status: 403 }));
    await expect(new SimplefinApi(fn).claim(SETUP_TOKEN)).rejects.toThrow(
      /invalid or was already claimed/,
    );
  });

  test("access URL is encrypted for storage and credentials are stripped for requests", () => {
    const stored = encryptAccessUrl(ACCESS_URL);
    expect(stored).not.toContain("bridge.example.org");
    expect(decrypt(stored)).toBe(ACCESS_URL);
    const { baseUrl, authorization } = parseAccessUrl(ACCESS_URL);
    expect(baseUrl).toBe("https://bridge.example.org/simplefin");
    expect(authorization).toBe(
      `Basic ${Buffer.from("user@x:p:ss").toString("base64")}`,
    );
  });
});

describe("provider", () => {
  const token = encryptAccessUrl(ACCESS_URL);
  const make = () => {
    const m = mockFetch(() => Response.json(payload));
    return {
      provider: new SimplefinProvider(new SimplefinApi(m.fn)),
      calls: m.calls,
    };
  };

  test("getAccounts maps accounts and infers credit", async () => {
    const { provider, calls } = make();
    const accounts = await provider.getAccounts({ accessToken: token });
    expect(accounts).toHaveLength(2);
    expect(accounts[0]).toMatchObject({
      id: "ACT-1",
      name: "My Bank Checking",
      currency: "USD",
      type: "depository",
      balance: { amount: 1500.25, currency: "USD" },
      available_balance: 1400,
      institution: { id: "simplefin", provider: "simplefin" },
    });
    expect(accounts[1]?.type).toBe("credit");
    expect(calls[0]?.url).toBe(
      "https://bridge.example.org/simplefin/accounts?balances-only=1",
    );
    expect(
      (calls[0]?.init?.headers as Record<string, string>).Authorization,
    ).toMatch(/^Basic /);
  });

  test("getTransactions maps sign, dates and pending", async () => {
    const { provider, calls } = make();
    const txns = await provider.getTransactions({
      accountId: "ACT-1",
      accessToken: token,
      accountType: "depository",
      latest: true,
    });
    expect(txns.map((t) => [t.id, t.amount, t.date, t.status])).toEqual([
      ["T1", -45.2, "2025-01-02", "posted"],
      ["T2", 2500, "2025-01-03", "posted"],
      ["T3", -9.99, "2025-01-04", "pending"],
    ]);
    expect(txns[1]?.category).toBe("income");
    const url = new URL(calls[0]?.url as string);
    expect(url.searchParams.get("account")).toBe("ACT-1");
    expect(url.searchParams.get("pending")).toBe("1");
    expect(Number(url.searchParams.get("start-date"))).toBeGreaterThan(0);
  });

  test("getAccountBalance + institutions", async () => {
    const { provider } = make();
    expect(
      await provider.getAccountBalance({
        accountId: "ACT-2",
        accessToken: token,
      }),
    ).toMatchObject({ amount: -320.1, currency: "USD" });
    expect(await provider.getInstitutions()).toEqual([
      { id: "simplefin", name: "SimpleFIN", logo: null, provider: "simplefin" },
    ]);
  });

  test("connection status: connected, revoked", async () => {
    const ok = make().provider;
    expect(await ok.getConnectionStatus({ accessToken: token })).toEqual({
      status: "connected",
    });
    const m = mockFetch(() => new Response("", { status: 403 }));
    const revoked = new SimplefinProvider(new SimplefinApi(m.fn));
    expect(await revoked.getConnectionStatus({ accessToken: token })).toEqual({
      status: "disconnected",
    });
  });

  test("delete is a no-op that does not call the network", async () => {
    const m = mockFetch(() => new Response("", { status: 500 }));
    const p = new SimplefinProvider(new SimplefinApi(m.fn));
    await p.deleteConnection({ id: "x", accessToken: token });
    await p.deleteAccounts({ accessToken: token });
    expect(m.calls).toHaveLength(0);
  });

  test("supports v2 connections for org names", async () => {
    const v2 = {
      errlist: [],
      connections: [{ conn_id: "C1", name: "Credit Union" }],
      accounts: [
        {
          id: "A",
          conn_id: "C1",
          name: "Savings",
          currency: "CAD",
          balance: "10.00",
        },
      ],
    };
    const m = mockFetch(() => Response.json(v2));
    const [a] = await new SimplefinProvider(new SimplefinApi(m.fn)).getAccounts(
      { accessToken: token },
    );
    expect(a).toMatchObject({ name: "Credit Union Savings", currency: "CAD" });
  });
});
