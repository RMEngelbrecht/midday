import { describe, expect, test } from "bun:test";
import {
  isGenericName,
  SIMILAR_TRANSACTION_THRESHOLD,
  type SimilarityFields,
  scoreSimilarTransaction,
  vendorKey,
} from "../utils/transaction-matching";

const tx = (
  name: string,
  counterpartyName: string | null = null,
  merchantName: string | null = null,
): SimilarityFields => ({ name, counterpartyName, merchantName });

const isSimilar = (
  source: SimilarityFields,
  candidate: SimilarityFields,
  genericName = false,
) =>
  scoreSimilarTransaction(source, candidate, genericName) >=
  SIMILAR_TRANSACTION_THRESHOLD;

describe("vendorKey", () => {
  test("ignores suffixes, punctuation, case and store numbers", () => {
    expect(vendorKey("Fluitshop B.V.")).toBe(vendorKey("FLUITSHOP BV"));
    expect(vendorKey("Albert Heijn 1234")).toBe(vendorKey("Albert Heijn 5678"));
  });
});

describe("scoreSimilarTransaction", () => {
  test("ING remittance blobs no longer match on the shared 'Naam' prefix", () => {
    expect(
      isSimilar(
        tx("Naam Fluitshop Omschrijving 1018362 Iban Nl87 Knab0255228813"),
        tx("Naam Albert Heijn Omschrijving 99 Iban Nl12 Ingb0001234567"),
      ),
    ).toBe(false);
  });

  test("French card prefixes alone do not link vendors", () => {
    expect(isSimilar(tx("CB Carrefour 12/11"), tx("CB Fnac 03/11"))).toBe(
      false,
    );
  });

  test("same counterparty matches even when names differ", () => {
    expect(
      isSimilar(
        tx("Sepa Overschrijving", "Fluitshop"),
        tx("Naam Fluitshop Omschrijving 2", "Fluitshop B.V."),
      ),
    ).toBe(true);
  });

  test("different counterparties never match, however alike the names", () => {
    expect(
      isSimilar(
        tx("Sepa Overschrijving", "Fluitshop"),
        tx("Sepa Overschrijving", "Albert Heijn"),
      ),
    ).toBe(false);
  });

  test("merchant outranks counterparty: PayPal purchases split by merchant", () => {
    expect(
      isSimilar(
        tx("PayPal Europe", "PayPal Europe", "Bol.com"),
        tx("PayPal Europe", "PayPal Europe", "Zalando SE"),
      ),
    ).toBe(false);
    expect(
      isSimilar(
        tx("PayPal Europe", "PayPal Europe", "Bol.com B.V."),
        tx("PayPal Europe", "PayPal Europe", "bol.com"),
      ),
    ).toBe(true);
  });

  test("store numbers in counterparties do not split a vendor", () => {
    expect(
      isSimilar(
        tx("Albert Heijn 1234", "Albert Heijn 1234"),
        tx("Albert Heijn 5678", "Albert Heijn 5678"),
      ),
    ).toBe(true);
  });

  test("names still match when one side has no counterparty", () => {
    expect(isSimilar(tx("Spotify", "Spotify AB"), tx("Spotify"))).toBe(true);
    expect(isSimilar(tx("Överf Saldo"), tx("Överf Saldo"))).toBe(true);
  });

  test("a generic source name only matches through an identity", () => {
    expect(
      isSimilar(tx("Sepa Overschrijving"), tx("Sepa Overschrijving"), true),
    ).toBe(false);
  });
});

describe("isGenericName", () => {
  test("a name shared by different counterparties is a bank label", () => {
    expect(isGenericName(["Fluitshop", "Albert Heijn"])).toBe(true);
  });

  test("variants of one counterparty are still one vendor", () => {
    expect(isGenericName(["Albert Heijn 1234", "ALBERT HEIJN 5678"])).toBe(
      false,
    );
    expect(isGenericName([])).toBe(false);
  });
});
