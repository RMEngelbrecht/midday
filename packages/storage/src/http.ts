/**
 * Parses a single-range `Range: bytes=...` header against an object size.
 * Returns null to serve the whole object (no/unsupported header) and
 * "unsatisfiable" for ranges outside the object (HTTP 416).
 */
export function parseRange(
  header: string | null | undefined,
  size: number,
): { start: number; end: number } | "unsatisfiable" | null {
  const match = header?.trim().match(/^bytes=(\d*)-(\d*)$/);
  if (!match) return null;
  const [, from, to] = match;
  if (!from && !to) return null;

  let start: number;
  let end: number;
  if (!from) {
    // Suffix range: the last N bytes.
    const suffix = Number(to);
    if (suffix === 0) return "unsatisfiable";
    start = Math.max(size - suffix, 0);
    end = size - 1;
  } else {
    start = Number(from);
    end = to ? Math.min(Number(to), size - 1) : size - 1;
  }

  if (start >= size || start > end) return "unsatisfiable";
  return { start, end };
}

/** RFC 6266 attachment header that survives non-ASCII filenames. */
export function attachmentHeader(filename: string): string {
  const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}
