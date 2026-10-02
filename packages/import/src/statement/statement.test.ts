import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  decodeStatementBytes,
  detectStatementFormat,
  parseStatement,
} from "./index";
import { statementToInserts } from "./to-transactions";

const fx = (n: string) =>
  readFileSync(join(__dirname, "__fixtures__", n), "utf8");

describe("OFX 1.x SGML", () => {
  const s = parseStatement(fx("sample-v1.ofx"), "a.qfx")!;
  test("account + transactions", () => {
    expect(s.format).toBe("ofx");
    const a = s.accounts[0]!;
    expect(a.accountNumber).toBe("123456789");
    expect(a.currency).toBe("USD");
    expect(a.balance).toBe(1191.81);
    expect(a.transactions).toHaveLength(4);
    expect(a.transactions[0]).toMatchObject({
      date: "2024-01-03",
      amount: -45.2,
      externalId: "202401030001",
      counterparty: "WHOLE FOODS MARKET",
    });
    expect(a.transactions[2]?.counterparty).toBe("NETFLIX & CO");
    expect(a.transactions[3]?.amount).toBe(-1250);
  });
});

describe("OFX 2.x XML", () => {
  test("parses", () => {
    const a = parseStatement(fx("sample-v2.ofx"), "a.ofx")!.accounts[0]!;
    expect(a.currency).toBe("CAD");
    expect(a.transactions.map((t) => t.amount)).toEqual([3.41, -200, 1000]);
    expect(a.transactions[1]?.description).toBe(
      "Transfer to chequing Online banking",
    );
  });
});

describe("CAMT.053", () => {
  const a = parseStatement(fx("sample-camt053.xml"), "x.xml")!.accounts[0]!;
  test("account and balance", () => {
    expect(a.iban).toBe("DE89370400440532013000");
    expect(a.currency).toBe("EUR");
    expect(a.balance).toBe(1819.5);
  });
  test("entries, sign, batch, reversal, pending skipped", () => {
    expect(a.transactions).toHaveLength(6);
    const [credit, debit, card, b1, b2, rev] = a.transactions;
    expect(credit).toMatchObject({
      date: "2024-02-02",
      amount: 1500,
      counterparty: "Muster GmbH",
      description: "Invoice 2024-001 Thank you",
      externalId: "REF-0001",
    });
    expect(debit).toMatchObject({
      amount: -89.9,
      counterparty: "Stadtwerke Berlin",
    });
    expect(card?.description).toBe("KARTENZAHLUNG REWE");
    expect([b1?.amount, b2?.amount]).toEqual([-100, -200]);
    expect(b1?.externalId).not.toBe(b2?.externalId);
    expect(rev?.amount).toBe(89.9);
  });
});

describe("MT940", () => {
  const s = parseStatement(fx("sample.mt940"), "a.sta")!;
  test("two statements merged into one account", () => {
    expect(s.accounts).toHaveLength(1);
    const a = s.accounts[0]!;
    expect(a.iban).toBe("DE89370400440532013000");
    expect(a.currency).toBe("EUR");
    expect(a.balance).toBe(2615.1);
    expect(a.transactions).toHaveLength(4);
  });
  test("fields", () => {
    const t = s.accounts[0]!.transactions;
    expect(t[0]).toMatchObject({
      date: "2024-01-02",
      amount: 1500,
      counterparty: "Muster GmbH",
    });
    expect(t[0]?.description).toContain("Rechnung 2024-001");
    expect(t[1]).toMatchObject({
      amount: -89.9,
      counterparty: "Stadtwerke Berlin",
    });
    expect(t[2]).toMatchObject({
      date: "2024-01-10",
      amount: -45,
      description: "Card payment REWE Markt Berlin",
    });
    expect(t[3]).toMatchObject({ amount: 250, counterparty: "Kunde AG" });
  });
});

describe("QIF", () => {
  test("parses, handles U and thousands separators", () => {
    const a = parseStatement(fx("sample.qif"), "a.qif")!.accounts[0]!;
    expect(a.transactions).toHaveLength(5);
    expect(a.transactions[1]).toMatchObject({
      date: "2024-01-16",
      amount: 2500,
    });
    expect(a.transactions[4]?.amount).toBe(-1250);
  });
});

describe("detection", () => {
  test("content sniffing beats extension; csv returns null", () => {
    expect(detectStatementFormat(fx("sample-camt053.xml"), "x.txt")).toBe(
      "camt053",
    );
    expect(detectStatementFormat(fx("sample.mt940"), "x.txt")).toBe("mt940");
    expect(detectStatementFormat(fx("sample.qif"))).toBe("qif");
    expect(parseStatement("date,amount\n2024-01-01,5", "a.csv")).toBeNull();
  });
  test("decodes CHARSET 1252", () => {
    const bytes = new Uint8Array(
      Buffer.from("OFXHEADER:100\nCHARSET:1252\n<OFX>\xe9"),
    );
    expect(decodeStatementBytes(bytes)).toContain("OFX");
  });
});

describe("dedupe ids", () => {
  const args = { teamId: "t1", bankAccountId: "acc1", currency: "USD" };
  for (const f of [
    "sample-v1.ofx",
    "sample-v2.ofx",
    "sample-camt053.xml",
    "sample.mt940",
    "sample.qif",
  ]) {
    test(`${f}: stable and unique`, () => {
      const txns = parseStatement(fx(f), f)!.accounts.flatMap(
        (a) => a.transactions,
      );
      const a = statementToInserts({ ...args, transactions: txns });
      const b = statementToInserts({ ...args, transactions: txns });
      expect(a.map((x) => x.internal_id)).toEqual(b.map((x) => x.internal_id));
      expect(new Set(a.map((x) => x.internal_id)).size).toBe(a.length);
    });
  }
  test("different account => different ids", () => {
    const txns = parseStatement(fx("sample-v1.ofx"), "a.ofx")!.accounts[0]!
      .transactions;
    const a = statementToInserts({ ...args, transactions: txns });
    const b = statementToInserts({
      ...args,
      bankAccountId: "acc2",
      transactions: txns,
    });
    expect(a[0]?.internal_id).not.toBe(b[0]?.internal_id);
  });
});
