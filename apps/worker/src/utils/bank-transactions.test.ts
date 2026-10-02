import { describe, expect, test } from "bun:test";
import type { Transaction } from "@midday/banking";
import { getClassification, toTransactionRow } from "./bank-transactions";

const base: Transaction = {
  id: "123456",
  name: "Coffee Shop",
  description: "Morning coffee",
  date: "2023-05-15",
  amount: 5.5,
  currency: "USD",
  method: "card_purchase",
  category: "meals",
  balance: 100.5,
  status: "posted",
  counterparty_name: "Spotify AB",
  merchant_name: null,
  currency_rate: null,
  currency_source: null,
};

describe("toTransactionRow", () => {
  test("maps provider fields and scopes internalId to the team", () => {
    expect(
      toTransactionRow({
        transaction: base,
        teamId: "team123",
        bankAccountId: "account456",
      }),
    ).toEqual({
      name: "Coffee Shop",
      description: "Morning coffee",
      date: "2023-05-15",
      amount: 5.5,
      currency: "USD",
      method: "card_purchase",
      internalId: "team123_123456",
      categorySlug: "meals",
      bankAccountId: "account456",
      balance: 100.5,
      teamId: "team123",
      counterpartyName: "Spotify AB",
      merchantName: null,
      status: "posted",
      manual: false,
    });
  });

  test("only sets notified when true so upserts keep the DB default", () => {
    const manual = toTransactionRow({
      transaction: base,
      teamId: "t",
      bankAccountId: "a",
      notified: true,
    });
    expect(manual.notified).toBe(true);

    const background = toTransactionRow({
      transaction: base,
      teamId: "t",
      bankAccountId: "a",
      notified: false,
    });
    expect("notified" in background).toBe(false);
  });

  test("defaults a missing merchant name to null", () => {
    const { merchant_name: _, ...withoutMerchant } = base;
    const row = toTransactionRow({
      transaction: withoutMerchant as Transaction,
      teamId: "t",
      bankAccountId: "a",
    });
    expect(row.merchantName).toBeNull();
  });
});

describe("getClassification", () => {
  test("credit stays credit, everything else is depository", () => {
    expect(getClassification("credit")).toBe("credit");
    expect(getClassification("loan")).toBe("depository");
    expect(getClassification(null)).toBe("depository");
  });
});
