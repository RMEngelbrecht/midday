/**
 * Object keys are `<bucket>/<path>`. Buckets are plain key prefixes inside one
 * store, so every driver shares the same validation rules here.
 */

export const BUCKETS = ["vault", "avatars", "apps", "institutions"] as const;
export type Bucket = (typeof BUCKETS)[number];

/** Buckets whose objects are readable without auth via `publicUrl()`. */
export const PUBLIC_BUCKETS: readonly Bucket[] = [
  "avatars",
  "apps",
  "institutions",
];

export class InvalidKeyError extends Error {
  constructor(key: string, reason: string) {
    super(`Invalid storage key "${key}": ${reason}`);
    this.name = "InvalidKeyError";
  }
}

export function isBucket(value: string): value is Bucket {
  return (BUCKETS as readonly string[]).includes(value);
}

export function isPublicBucket(value: string): boolean {
  return (PUBLIC_BUCKETS as readonly string[]).includes(value);
}

function checkSegment(key: string, segment: string) {
  if (segment === "" || segment === "." || segment === "..") {
    throw new InvalidKeyError(key, "empty, '.' or '..' segment");
  }
  // biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting them is the point
  if (/[\\\u0000-\u001f]/.test(segment)) {
    throw new InvalidKeyError(key, "backslash or control character");
  }
}

/**
 * Throws unless `key` is `<bucket>/<segment>(/<segment>)*` with no empty,
 * relative or control-character segments. Returns the bucket.
 */
export function assertKey(key: string): Bucket {
  const [bucket, ...rest] = key.split("/");
  if (!bucket || !isBucket(bucket)) {
    throw new InvalidKeyError(key, "unknown bucket");
  }
  if (rest.length === 0) {
    throw new InvalidKeyError(key, "missing path");
  }
  for (const segment of rest) checkSegment(key, segment);
  return bucket;
}

/**
 * Validates a list prefix: a bucket, optionally followed by complete segments
 * and a trailing partial segment (`vault/team/inv` matches `vault/team/invoice.pdf`).
 */
export function assertPrefix(prefix: string): Bucket {
  const [bucket, ...rest] = prefix.split("/");
  if (!bucket || !isBucket(bucket)) {
    throw new InvalidKeyError(prefix, "unknown bucket");
  }
  const last = rest.pop();
  for (const segment of rest) checkSegment(prefix, segment);
  if (last && (last === "." || last === "..")) {
    throw new InvalidKeyError(prefix, "relative segment");
  }
  return bucket;
}

/** Builds and validates `<bucket>/<path>` from a path string or path tokens. */
export function objectKey(bucket: Bucket, path: string | string[]): string {
  const joined = Array.isArray(path) ? path.join("/") : path;
  const key = `${bucket}/${joined.replace(/^\/+/, "")}`;
  assertKey(key);
  return key;
}

/** Splits a key into bucket and path (`vault/a/b.pdf` → `["vault", "a/b.pdf"]`). */
export function splitKey(key: string): [Bucket, string] {
  const bucket = assertKey(key);
  return [bucket, key.slice(bucket.length + 1)];
}

/** Percent-encodes each segment so a key can be placed in a URL path. */
export function encodeKeyForUrl(key: string): string {
  return key.split("/").map(encodeURIComponent).join("/");
}

const CONTENT_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  avif: "image/avif",
  heic: "image/heic",
  heif: "image/heif",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  txt: "text/plain",
  csv: "text/csv",
  json: "application/json",
  xml: "application/xml",
  zip: "application/zip",
  eml: "message/rfc822",
  mp4: "video/mp4",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
};

export function contentTypeFromKey(key: string): string {
  const name = key.split("/").at(-1) ?? "";
  const ext = name.includes(".") ? name.split(".").at(-1)?.toLowerCase() : "";
  return CONTENT_TYPES[ext ?? ""] ?? "application/octet-stream";
}

/**
 * Vault key for a team-owned path. Vault paths start with the team id, so a
 * path naming another team is rejected even if a DB row points at it.
 */
export function teamVaultKey(teamId: string, path: string | string[]): string {
  const tokens = Array.isArray(path) ? path : path.split("/");
  if (tokens[0] !== teamId) {
    throw new InvalidKeyError(tokens.join("/"), "not in the team's vault");
  }
  return objectKey("vault", tokens);
}
