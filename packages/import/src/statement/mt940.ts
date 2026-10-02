import {
  type ParsedStatement,
  type StatementAccount,
  StatementParseError,
  type StatementTransaction,
} from "./types";
import { expandYear, isoDate, joinText, parseNumber } from "./utils";

type Field = { tag: string; value: string };

/** Split into SWIFT fields (":61:...") keeping continuation lines. */
function splitFields(content: string): Field[] {
  const fields: Field[] = [];
  let current: Field | null = null;
  for (const line of content.replace(/\r/g, "").split("\n")) {
    const m = line.match(/^:(\d{2}[A-Z]?):(.*)$/);
    if (m) {
      current = { tag: m[1] as string, value: m[2] as string };
      fields.push(current);
    } else if (line.startsWith("-}") || line.startsWith("{") || line === "-") {
      current = null;
    } else if (current) {
      current.value += `\n${line}`;
    }
  }
  return fields;
}

function parseBalance(value: string) {
  const m = value.match(/^([CD])(\d{6})([A-Z]{3})([\d,]+)/);
  if (!m) return undefined;
  const amount = parseNumber(m[4]);
  return {
    amount: m[1] === "D" ? -amount : amount,
    currency: m[3] as string,
  };
}

function resolveBookingDate(valueDate: string, mmdd?: string) {
  const y = expandYear(Number(valueDate.slice(0, 2)));
  const vm = Number(valueDate.slice(2, 4));
  const vd = Number(valueDate.slice(4, 6));
  if (!mmdd) return isoDate(y, vm, vd);
  const bm = Number(mmdd.slice(0, 2));
  const bd = Number(mmdd.slice(2, 4));
  let by = y;
  if (bm - vm > 6) by -= 1;
  else if (vm - bm > 6) by += 1;
  return isoDate(by, bm, bd) ?? isoDate(y, vm, vd);
}

/** :86: either German structured (?20..?33) or free text. */
function parseInfo(value: string): {
  description?: string;
  counterparty?: string;
} {
  const flat = value.replace(/\n/g, "");
  if (/\?\d{2}/.test(flat)) {
    const sub: Record<string, string> = {};
    for (const m of flat.matchAll(/\?(\d{2})([^?]*)/g)) {
      const k = m[1] as string;
      sub[k] = (sub[k] ?? "") + (m[2] ?? "");
    }
    const purpose = joinText(
      ["20", "21", "22", "23", "24", "25", "26", "27", "28", "29"].map(
        (k) => sub[k],
      ),
      " ",
    );
    const name = joinText([sub["32"], sub["33"]], " ");
    const code = sub["00"];
    return { description: purpose ?? code, counterparty: name };
  }
  // Free-text variants. Dutch style "/NAME/Foo/REMI/bar" is partially understood.
  const slashName = flat.match(/\/NAME\/([^/]+)/);
  const remi = flat.match(/\/REMI\/(.+?)(?:\/[A-Z]{3,4}\/|$)/);
  if (slashName || remi) {
    return {
      description: remi?.[1]?.trim(),
      counterparty: slashName?.[1]?.trim(),
    };
  }
  const lines = value
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  return { description: lines.join(" ") || undefined };
}

export function parseMt940(content: string): ParsedStatement {
  const fields = splitFields(content);
  if (!fields.some((f) => f.tag === "20" || f.tag === "61")) {
    throw new StatementParseError("No MT940 fields found", "mt940");
  }

  const accounts = new Map<string, StatementAccount>();
  let current: StatementAccount | null = null;
  let lastTxn: { txn: StatementTransaction } | null = null;

  const startAccount = (number: string) => {
    const key = number.trim().split("/")[0]?.trim() || "UNKNOWN";
    let existing = accounts.get(key);
    if (!existing) {
      const isIban = /^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(key);
      existing = {
        accountNumber: key,
        iban: isIban ? key : undefined,
        transactions: [],
      };
      accounts.set(key, existing);
    }
    current = existing;
  };

  for (const f of fields) {
    if (f.tag === "20") {
      current = null;
      lastTxn = null;
    } else if (f.tag === "25") {
      startAccount(f.value.split("\n")[0] as string);
    } else if (f.tag === "60F" || f.tag === "60M") {
      const b = parseBalance(f.value);
      if (current && b && !(current as StatementAccount).currency) {
        (current as StatementAccount).currency = b.currency;
      }
    } else if (f.tag === "62F" || f.tag === "62M") {
      const b = parseBalance(f.value);
      if (current && b) {
        (current as StatementAccount).balance = b.amount;
        (current as StatementAccount).currency ??= b.currency;
      }
    } else if (f.tag === "61") {
      if (!current) startAccount("UNKNOWN");
      const acct = current as unknown as StatementAccount;
      const [first, ...rest] = f.value.split("\n");
      const m = (first as string).match(
        /^(\d{6})(\d{4})?(R?[CD])[A-Z]?(\d+(?:,\d*)?)(?:[A-Z])(.{3})(.*)$/,
      );
      if (!m) {
        lastTxn = null;
        continue;
      }
      const date = resolveBookingDate(m[1] as string, m[2]);
      const mark = m[3] as string;
      let amount = parseNumber(m[4]);
      // C/RD = credit/reversal-of-debit (money in); D/RC = money out
      if (mark === "D" || mark === "RC") amount = -amount;
      const refs = (m[6] as string).split("//");
      const custRef = refs[0]?.trim();
      const bankRef = refs[1]?.trim();
      const usable = (r?: string) =>
        r && !/^(NONREF|NOTPROVIDED)$/i.test(r) ? r : undefined;
      const ref = usable(bankRef) ?? usable(custRef);
      if (!date || Number.isNaN(amount)) {
        lastTxn = null;
        continue;
      }
      const txn: StatementTransaction = {
        date,
        amount,
        currency: acct.currency,
        // date+amount make reused/short bank refs safe across files
        externalId: ref ? `${date}|${amount}|${ref}` : undefined,
        description: rest.join(" ").trim() || undefined,
      };
      acct.transactions.push(txn);
      lastTxn = { txn };
    } else if (f.tag === "86" && lastTxn) {
      const { description, counterparty } = parseInfo(f.value);
      lastTxn.txn.description = description ?? lastTxn.txn.description;
      lastTxn.txn.counterparty = counterparty;
      lastTxn = null;
    }
  }

  return { format: "mt940", accounts: [...accounts.values()] };
}
