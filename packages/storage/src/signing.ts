import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Signed URL tokens for objects served through the API (`GET /files/serve`).
 * Format: base64url(JSON payload) "." base64url(HMAC-SHA256).
 */

export type SignedPayload = {
  /** Object key. */
  k: string;
  /** Expiry, unix seconds. */
  e: number;
  /** Download filename (Content-Disposition: attachment). */
  d?: string;
};

const DOMAIN = "midday-storage-url:v1:";

function mac(secret: string, data: string) {
  return createHmac("sha256", secret)
    .update(DOMAIN + data)
    .digest("base64url");
}

export function createSignedToken(
  secret: string,
  payload: SignedPayload,
): string {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${data}.${mac(secret, data)}`;
}

/** Returns the payload when the signature is valid and not expired. */
export function verifySignedToken(
  secret: string,
  token: string,
  now = Date.now(),
): SignedPayload | null {
  const [data, signature, extra] = token.split(".");
  if (!data || !signature || extra !== undefined) return null;

  const expected = Buffer.from(mac(secret, data));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }

  let payload: SignedPayload;
  try {
    payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
  } catch {
    return null;
  }

  if (typeof payload.k !== "string" || typeof payload.e !== "number") {
    return null;
  }
  if (payload.e * 1000 <= now) return null;

  return payload;
}
