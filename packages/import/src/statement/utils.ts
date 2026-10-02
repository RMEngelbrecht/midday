/**
 * Locale-tolerant number parser: "1,234.56", "1.234,56", "-12,5", "(10.00)".
 * Returns NaN for unparseable input.
 */
export function parseNumber(input: string | undefined): number {
  if (!input) return Number.NaN;
  let s = input.replace(/\s/g, "").replace(/[−–]/g, "-");
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[^\d.,+-]/g, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    if (lastComma > lastDot) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // "1,234" with exactly 3 digits after a single comma is a thousands sep
    const single = s.indexOf(",") === lastComma;
    if (single && /,\d{3}$/.test(s) && !/^[-+]?0,/.test(s))
      s = s.replace(",", "");
    else s = s.replace(/,/g, ".");
    if ((s.match(/\./g) ?? []).length > 1) {
      const i = s.lastIndexOf(".");
      s = s.slice(0, i).replace(/\./g, "") + s.slice(i);
    }
  } else if (lastDot >= 0 && (s.match(/\./g) ?? []).length > 1) {
    const i = s.lastIndexOf(".");
    s = s.slice(0, i).replace(/\./g, "") + s.slice(i);
  }
  const n = Number(s);
  if (Number.isNaN(n)) return Number.NaN;
  return negative ? -Math.abs(n) : n;
}

export function pad2(n: number | string) {
  return String(n).padStart(2, "0");
}

export function isoDate(y: number, m: number, d: number): string | undefined {
  const date = new Date(Date.UTC(y, m - 1, d));
  if (
    date.getUTCFullYear() !== y ||
    date.getUTCMonth() !== m - 1 ||
    date.getUTCDate() !== d
  ) {
    return undefined;
  }
  return `${String(y).padStart(4, "0")}-${pad2(m)}-${pad2(d)}`;
}

export function expandYear(yy: number) {
  return yy < 70 ? 2000 + yy : 1900 + yy;
}

export function joinText(
  parts: Array<string | undefined>,
  sep = " ",
): string | undefined {
  const out = parts.map((p) => p?.trim()).filter((p): p is string => !!p);
  return out.length ? out.join(sep) : undefined;
}
