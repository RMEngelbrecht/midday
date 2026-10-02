import type { StatementFormat } from "./types";

const EXT: Record<string, StatementFormat> = {
  ofx: "ofx",
  qfx: "ofx",
  sta: "mt940",
  mt940: "mt940",
  "940": "mt940",
  qif: "qif",
};

/** Content sniffing wins over extension; returns null for CSV / unknown. */
export function detectStatementFormat(
  content: string,
  filename?: string,
): StatementFormat | null {
  const head = content.replace(/^﻿/, "").slice(0, 4000);
  if (
    /^\s*OFXHEADER:/i.test(head) ||
    /<OFX[\s>]/i.test(content.slice(0, 20000))
  )
    return "ofx";
  if (/<(?:\w+:)?BkToCstmrStmt[\s>]/.test(content) || /camt\.053/.test(head))
    return "camt053";
  if (/^\s*!(?:Type|Account|Option)/im.test(head)) return "qif";
  if (/^\s*(?:\{1:|:20:)/m.test(head) && /^:(?:61|60[FM]|25):/m.test(content))
    return "mt940";

  const ext = filename?.split(".").pop()?.toLowerCase();
  if (ext && ext in EXT) return EXT[ext] as StatementFormat;
  return null;
}

/** Extensions the import UI should accept as structured statements. */
export const STATEMENT_EXTENSIONS = [
  ".ofx",
  ".qfx",
  ".xml",
  ".sta",
  ".mt940",
  ".940",
  ".qif",
] as const;
