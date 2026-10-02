import {
  child,
  findAll,
  first,
  type MarkupNode,
  parseMarkup,
  textOf,
} from "./markup";
import {
  type ParsedStatement,
  type StatementAccount,
  StatementParseError,
  type StatementTransaction,
} from "./types";
import { isoDate, parseNumber } from "./utils";

/** OFX date: YYYYMMDD[HHMMSS[.XXX]][[offset:TZ]] -> YYYY-MM-DD */
export function parseOfxDate(value: string | undefined): string | undefined {
  const m = value?.match(/^(\d{4})(\d{2})(\d{2})/);
  if (!m) return undefined;
  return isoDate(Number(m[1]), Number(m[2]), Number(m[3]));
}

function text(node: MarkupNode | undefined, name: string) {
  return textOf(child(node, name));
}

function parseTransaction(
  trn: MarkupNode,
  currency?: string,
): StatementTransaction | null {
  const date = parseOfxDate(text(trn, "DTPOSTED") ?? text(trn, "DTUSER"));
  const amount = parseNumber(text(trn, "TRNAMT"));
  if (!date || Number.isNaN(amount)) return null;

  const name = text(trn, "NAME") ?? textOf(first(child(trn, "PAYEE"), "NAME"));
  const memo = text(trn, "MEMO");
  const description =
    name && memo && name !== memo ? `${name} ${memo}` : (memo ?? name);

  return {
    date,
    amount,
    description,
    counterparty: name,
    externalId: text(trn, "FITID"),
    currency: textOf(child(trn, "CURRENCY")?.children[0]) ?? currency,
  };
}

export function parseOfx(content: string): ParsedStatement {
  // Drop the SGML header block (OFXHEADER:100 ...) before the <OFX> root
  const start = content.search(/<OFX[\s>]/i);
  if (start < 0) throw new StatementParseError("No <OFX> root element", "ofx");
  const root = parseMarkup(content.slice(start));

  const accounts: StatementAccount[] = [];
  const stmtrs = [...findAll(root, "STMTRS"), ...findAll(root, "CCSTMTRS")];

  for (const stmt of stmtrs) {
    const currency = text(stmt, "CURDEF");
    const from = child(stmt, "BANKACCTFROM") ?? child(stmt, "CCACCTFROM");
    const transactions = findAll(child(stmt, "BANKTRANLIST") ?? stmt, "STMTTRN")
      .map((t) => parseTransaction(t, currency))
      .filter((t): t is StatementTransaction => t !== null);
    const balance = parseNumber(
      textOf(first(child(stmt, "LEDGERBAL"), "BALAMT")),
    );

    const acct = text(from, "ACCTID");
    accounts.push({
      accountNumber: acct,
      bankId: text(from, "BANKID"),
      currency,
      balance: Number.isNaN(balance) ? undefined : balance,
      transactions,
    });
  }

  if (accounts.length === 0) {
    throw new StatementParseError("No bank statement found in OFX", "ofx");
  }
  return { format: "ofx", accounts };
}
