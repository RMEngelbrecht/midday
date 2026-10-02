import {
  assertKey,
  assertPrefix,
  encodeKeyForUrl,
  InvalidKeyError,
  isPublicBucket,
} from "./keys";
import { createSignedToken } from "./signing";
import type {
  Body,
  ByteRange,
  GetResult,
  ListedObject,
  ObjectInfo,
  PutOptions,
  StorageDriver,
} from "./types";

export type StorageConfig = {
  /** Public API base URL; signed and public URLs point at its /files routes. */
  apiUrl: string;
  /** HMAC secret for API-served signed URLs. */
  signingSecret: string;
  /** Base URL serving public buckets directly (e.g. an R2 custom domain). */
  publicBaseUrl?: string;
};

export type SignedUrlOptions = {
  /** `true` uses the object's filename; a string overrides it. */
  download?: boolean | string;
};

/**
 * The storage API used by apps. Validates keys, then delegates I/O to the
 * driver. URLs: direct presigned URLs when the driver offers them, otherwise
 * HMAC-signed URLs served by the API at `GET /files/serve?token=`.
 */
export class Storage {
  constructor(
    readonly driver: StorageDriver,
    private readonly config: StorageConfig,
  ) {}

  async put(
    key: string,
    body: Body,
    options?: PutOptions,
  ): Promise<ObjectInfo> {
    assertKey(key);
    return this.driver.put(key, body, options);
  }

  async get(
    key: string,
    options?: { range?: ByteRange },
  ): Promise<GetResult | null> {
    assertKey(key);
    return this.driver.get(key, options);
  }

  async head(key: string): Promise<ObjectInfo | null> {
    assertKey(key);
    return this.driver.head(key);
  }

  async delete(keys: string[]): Promise<void> {
    for (const key of keys) assertKey(key);
    if (keys.length) await this.driver.delete(keys);
  }

  async list(prefix: string): Promise<ListedObject[]> {
    assertPrefix(prefix);
    return this.driver.list(prefix);
  }

  /** Reads a whole object into memory. Null when it does not exist. */
  async download(key: string): Promise<Blob | null> {
    const object = await this.get(key);
    if (!object) return null;
    const bytes = await new Response(object.body).arrayBuffer();
    return new Blob([bytes], { type: object.contentType });
  }

  async signedUrl(
    key: string,
    ttlSeconds: number,
    options: SignedUrlOptions = {},
  ): Promise<string> {
    assertKey(key);
    const download =
      options.download === true
        ? key.split("/").at(-1)
        : options.download || undefined;

    if (this.driver.presignGet) {
      return this.driver.presignGet(key, ttlSeconds, { download });
    }

    const token = createSignedToken(this.config.signingSecret, {
      k: key,
      e: Math.floor(Date.now() / 1000) + ttlSeconds,
      ...(download ? { d: download } : {}),
    });
    return `${this.config.apiUrl}/files/serve?token=${token}`;
  }

  /** Unauthenticated URL for objects in public buckets. */
  publicUrl(key: string): string {
    const bucket = assertKey(key);
    if (!isPublicBucket(bucket)) {
      throw new InvalidKeyError(key, `bucket "${bucket}" is not public`);
    }
    const base =
      this.config.publicBaseUrl ?? `${this.config.apiUrl}/files/public`;
    return `${base}/${encodeKeyForUrl(key)}`;
  }

  /** Inverse of `publicUrl`: the key, or null for URLs we did not mint. */
  keyFromPublicUrl(url: string): string | null {
    const base = `${
      this.config.publicBaseUrl ?? `${this.config.apiUrl}/files/public`
    }/`;
    if (!url.startsWith(base)) return null;
    const key = url
      .slice(base.length)
      .split("/")
      .map((s) => decodeURIComponent(s))
      .join("/");
    try {
      assertKey(key);
      return key;
    } catch {
      return null;
    }
  }
}
