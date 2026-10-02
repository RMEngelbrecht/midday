export type StatementFormat = "ofx" | "camt053" | "mt940" | "qif";

export type StatementTransaction = {
  /** YYYY-MM-DD (booking date, falls back to value date) */
  date: string;
  /** Signed: negative = money out, positive = money in */
  amount: number;
  description?: string;
  counterparty?: string;
  /** Bank-provided stable reference (FITID, AcctSvcrRef, MT940 bank ref ...) */
  externalId?: string;
  currency?: string;
};

export type StatementAccount = {
  /** IBAN or bank account number as found in the file */
  accountNumber?: string;
  iban?: string;
  bankId?: string;
  currency?: string;
  /** Closing/ledger balance when the file carries one */
  balance?: number;
  transactions: StatementTransaction[];
};

export type ParsedStatement = {
  format: StatementFormat;
  accounts: StatementAccount[];
};

export class StatementParseError extends Error {
  constructor(
    message: string,
    public readonly format?: StatementFormat,
  ) {
    super(message);
    this.name = "StatementParseError";
  }
}
