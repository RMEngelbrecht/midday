import { normalizeColumns } from "./csv-mapping-prompt";

export type CsvMapping = {
  date?: string;
  description?: string;
  counterparty?: string;
  amount?: string;
  balance?: string;
  currency?: string;
};

// Ordered keyword lists per field; the first column matching an earlier
// keyword wins. Matching is on the lowercased header with separators removed.
const KEYWORDS: Record<keyof CsvMapping, string[]> = {
  date: [
    "bookingdate",
    "transactiondate",
    "paymentdate",
    "valuedate",
    "date",
    "datum",
  ],
  amount: ["transactionamount", "amount", "sum", "value", "belopp", "betrag"],
  balance: ["balance", "saldo"],
  currency: ["currency", "ccy", "valuta", "waehrung"],
  counterparty: [
    "counterparty",
    "payee",
    "merchant",
    "vendor",
    "beneficiary",
    "recipient",
    "payer",
    "fromto",
  ],
  description: [
    "description",
    "memo",
    "text",
    "details",
    "reference",
    "narrative",
    "note",
    "purpose",
    "name",
  ],
};

// Columns that identify the account owner, never the counterparty.
const OWNER_COLUMNS = ["cardholder", "accountholder", "customer"];

function key(column: string) {
  return column.toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * Deterministic header-name mapping used when AI is not configured. Each CSV
 * column is assigned to at most one field.
 */
export function heuristicCsvMapping(fieldColumns: string[]): CsvMapping {
  const columns = normalizeColumns(fieldColumns).filter(
    (c) => !OWNER_COLUMNS.includes(key(c)),
  );
  const used = new Set<string>();
  const mapping: CsvMapping = {};

  for (const field of Object.keys(KEYWORDS) as (keyof CsvMapping)[]) {
    for (const keyword of KEYWORDS[field]) {
      const match = columns.find(
        (c) => !used.has(c) && key(c).includes(keyword),
      );
      if (match) {
        mapping[field] = match;
        used.add(match);
        break;
      }
    }
  }

  return mapping;
}
