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
import { isoDate, joinText, parseNumber } from "./utils";

function dateOf(node: MarkupNode | undefined): string | undefined {
  const raw = textOf(child(node, "Dt")) ?? textOf(child(node, "DtTm"));
  const m = raw?.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? isoDate(Number(m[1]), Number(m[2]), Number(m[3])) : undefined;
}

function signed(
  amt: MarkupNode | undefined,
  indicator: string | undefined,
  reversal: boolean,
) {
  const value = parseNumber(textOf(amt));
  if (Number.isNaN(value)) return Number.NaN;
  const debit = (indicator ?? "").toUpperCase() === "DBIT";
  // A reversal (RvslInd=true) flips the economic direction of the entry.
  const outflow = reversal ? !debit : debit;
  return outflow ? -Math.abs(value) : Math.abs(value);
}

function party(scope: MarkupNode | undefined, role: "Dbtr" | "Cdtr") {
  const nm = first(first(scope, "RltdPties"), role);
  return textOf(first(nm, "Nm"));
}

function remittance(scope: MarkupNode | undefined): string | undefined {
  const rmt = first(scope, "RmtInf");
  const ustrd = rmt ? findAll(rmt, "Ustrd").map(textOf) : [];
  const structured = rmt ? findAll(rmt, "Ref").map(textOf) : [];
  return (
    joinText(ustrd) ??
    joinText(structured) ??
    textOf(first(scope, "AddtlTxInf"))
  );
}

const GENERIC_REFS = new Set(["NOTPROVIDED", "NONREF", "N/A", ""]);

function usableRef(value: string | undefined) {
  return value && !GENERIC_REFS.has(value.toUpperCase()) ? value : undefined;
}

function parseEntry(
  ntry: MarkupNode,
  accountCurrency?: string,
): StatementTransaction[] {
  const status =
    textOf(child(ntry, "Sts")) ?? textOf(first(child(ntry, "Sts"), "Cd"));
  if (status && status.toUpperCase() === "PDNG") return [];

  const date = dateOf(child(ntry, "BookgDt")) ?? dateOf(child(ntry, "ValDt"));
  if (!date) return [];

  const indicator = textOf(child(ntry, "CdtDbtInd"));
  const reversal = textOf(child(ntry, "RvslInd"))?.toLowerCase() === "true";
  const entryAmt = child(ntry, "Amt");
  const currency = entryAmt?.ccy ?? accountCurrency;

  const entryRef =
    usableRef(textOf(child(ntry, "AcctSvcrRef"))) ??
    usableRef(textOf(child(ntry, "NtryRef")));
  const incoming = (indicator ?? "").toUpperCase() === "CRDT";
  const counterpartyRole = incoming ? "Dbtr" : "Cdtr";

  const details = findAll(ntry, "TxDtls");
  const entryDescription =
    remittance(ntry) ?? textOf(child(ntry, "AddtlNtryInf"));

  // Batch entry: several TxDtls each carrying their own amount
  const batch = details
    .map((d, i) => {
      const amt = first(child(d, "AmtDtls"), "Amt") ?? child(d, "Amt");
      if (!amt) return null;
      const dInd = textOf(child(d, "CdtDbtInd")) ?? indicator;
      const amount = signed(amt, dInd, reversal);
      if (Number.isNaN(amount)) return null;
      const ref =
        usableRef(textOf(first(child(d, "Refs"), "AcctSvcrRef"))) ??
        usableRef(textOf(first(child(d, "Refs"), "EndToEndId"))) ??
        usableRef(textOf(first(child(d, "Refs"), "TxId")));
      const dIncoming = (dInd ?? "").toUpperCase() === "CRDT";
      return {
        date,
        amount,
        description: remittance(d) ?? entryDescription,
        counterparty: party(d, dIncoming ? "Dbtr" : "Cdtr"),
        externalId: entryRef ? `${entryRef}#${ref ?? i + 1}` : undefined,
        currency,
      } satisfies StatementTransaction;
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);

  if (details.length > 1 && batch.length === details.length) return batch;

  const amount = signed(entryAmt, indicator, reversal);
  if (Number.isNaN(amount)) return [];
  const single = details[0];
  return [
    {
      date,
      amount,
      description: entryDescription,
      counterparty: party(single ?? ntry, counterpartyRole),
      externalId: entryRef,
      currency,
    },
  ];
}

export function parseCamt053(content: string): ParsedStatement {
  const root = parseMarkup(content);
  const stmts = findAll(root, "Stmt");
  if (stmts.length === 0) {
    throw new StatementParseError("No <Stmt> element found", "camt053");
  }

  const accounts: StatementAccount[] = stmts.map((stmt) => {
    const acct = child(stmt, "Acct");
    const iban = textOf(first(child(acct, "Id"), "IBAN"));
    const other = textOf(first(first(child(acct, "Id"), "Othr"), "Id"));
    const currency = textOf(child(acct, "Ccy")) ?? textOf(first(acct, "Ccy"));

    let balance: number | undefined;
    for (const bal of findAll(stmt, "Bal")) {
      const code = textOf(first(child(bal, "Tp"), "Cd"));
      if (code === "CLBD" || (code === "ITBD" && balance === undefined)) {
        const v = signed(
          child(bal, "Amt"),
          textOf(child(bal, "CdtDbtInd")),
          false,
        );
        if (!Number.isNaN(v)) balance = v;
      }
    }

    return {
      iban,
      accountNumber: iban ?? other,
      currency,
      balance,
      transactions: findAll(stmt, "Ntry").flatMap((n) =>
        parseEntry(n, currency),
      ),
    };
  });

  return { format: "camt053", accounts };
}
