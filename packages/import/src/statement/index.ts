import { parseCamt053 } from "./camt053";
import { detectStatementFormat } from "./detect";
import { parseMt940 } from "./mt940";
import { parseOfx } from "./ofx";
import { parseQif } from "./qif";
import { type ParsedStatement, StatementParseError } from "./types";

export * from "./detect";
export * from "./types";

/** Decode bytes, honouring OFX 1.x CHARSET:1252 headers. */
export function decodeStatementBytes(bytes: Uint8Array): string {
  const head = new TextDecoder("windows-1252").decode(bytes.slice(0, 600));
  if (/CHARSET:\s*(1252|windows-1252|8859-1|ISO-8859-1)/i.test(head)) {
    return new TextDecoder("windows-1252").decode(bytes);
  }
  return new TextDecoder("utf-8").decode(bytes);
}

/** Returns null when the file is not a structured statement (i.e. CSV). */
export function parseStatement(
  content: string,
  filename?: string,
): ParsedStatement | null {
  const format = detectStatementFormat(content, filename);
  switch (format) {
    case "ofx":
      return parseOfx(content);
    case "camt053":
      return parseCamt053(content);
    case "mt940":
      return parseMt940(content);
    case "qif":
      return parseQif(content);
    default:
      if (filename?.toLowerCase().endsWith(".xml")) {
        throw new StatementParseError("Unsupported XML statement format");
      }
      return null;
  }
}
