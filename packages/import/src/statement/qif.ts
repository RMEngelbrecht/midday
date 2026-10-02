import {
  type ParsedStatement,
  StatementParseError,
  type StatementTransaction,
} from "./types";
import { expandYear, isoDate, joinText, parseNumber } from "./utils";

type Raw = { d?: string; t?: string; p?: string; m?: string };

function detectOrder(dates: string[]): "mdy" | "dmy" | "ymd" {
  if (dates.some((d) => /^\d{4}[-/.]/.test(d))) return "ymd";
  let dmy = false;
  for (const d of dates) {
    const parts = d.split(/[/.\-'\s]+/).filter(Boolean);
    if (Number(parts[0]) > 12) dmy = true;
    if (Number(parts[1]) > 12) return "mdy";
  }
  return dmy ? "dmy" : "mdy";
}

function parseDate(value: string, order: "mdy" | "dmy" | "ymd") {
  const p = value
    .split(/[/.\-'\s]+/)
    .filter(Boolean)
    .map(Number);
  if (p.length < 3 || p.some(Number.isNaN)) return undefined;
  const [a, b, c] = p as [number, number, number];
  if (order === "ymd") return isoDate(a, b, c);
  const year = c < 100 ? (value.includes("'") ? 2000 + c : expandYear(c)) : c;
  return order === "dmy" ? isoDate(year, b, a) : isoDate(year, a, b);
}

export function parseQif(content: string): ParsedStatement {
  const raws: Raw[] = [];
  let cur: Raw = {};
  let seen = false;
  for (const line of content.replace(/^﻿/, "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const code = line[0] as string;
    const value = line.slice(1).trim();
    if (code === "!") continue;
    if (code === "^") {
      if (cur.d || cur.t) raws.push(cur);
      cur = {};
      continue;
    }
    seen = true;
    if (code === "D") cur.d = value;
    else if (code === "T" || (code === "U" && !cur.t)) cur.t = value;
    else if (code === "P") cur.p = value;
    else if (code === "M") cur.m = value;
  }
  if (cur.d || cur.t) raws.push(cur);
  if (!seen) throw new StatementParseError("Empty QIF file", "qif");

  const order = detectOrder(
    raws.map((r) => r.d).filter((d): d is string => !!d),
  );
  const transactions: StatementTransaction[] = [];
  for (const r of raws) {
    const date = r.d ? parseDate(r.d, order) : undefined;
    const amount = parseNumber(r.t);
    if (!date || Number.isNaN(amount)) continue;
    transactions.push({
      date,
      amount,
      counterparty: r.p || undefined,
      description: joinText([r.p, r.m && r.m !== r.p ? r.m : undefined]),
    });
  }
  return { format: "qif", accounts: [{ transactions }] };
}
