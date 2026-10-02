export type Body =
  | ReadableStream<Uint8Array>
  | Uint8Array
  | ArrayBuffer
  | Blob
  | string;

export type PutOptions = {
  contentType?: string;
  cacheControl?: string;
};

export type ObjectInfo = {
  key: string;
  size: number;
  contentType: string;
  cacheControl?: string;
  lastModified: Date;
};

export type ListedObject = Pick<ObjectInfo, "key" | "size" | "lastModified">;

/** Inclusive byte range, like an HTTP `Range: bytes=start-end` header. */
export type ByteRange = { start: number; end?: number };

export type GetResult = ObjectInfo & {
  body: ReadableStream<Uint8Array>;
  /** Set when a range was requested: the bytes actually returned. */
  range?: { start: number; end: number };
};

export type PresignOptions = {
  /** Filename for `Content-Disposition: attachment`. */
  download?: string;
};

/**
 * What a storage backend must implement. Keys are already validated
 * (`<bucket>/<path>`) by the `Storage` facade before they reach a driver.
 */
export interface StorageDriver {
  readonly name: "local" | "s3";
  put(key: string, body: Body, options?: PutOptions): Promise<ObjectInfo>;
  /** Returns null when the object does not exist. */
  get(key: string, options?: { range?: ByteRange }): Promise<GetResult | null>;
  head(key: string): Promise<ObjectInfo | null>;
  /** Missing keys are ignored. */
  delete(keys: string[]): Promise<void>;
  /** Every object whose key starts with `prefix`, recursively. */
  list(prefix: string): Promise<ListedObject[]>;
  /** Direct presigned GET URL, when the backend is reachable by clients. */
  presignGet?(
    key: string,
    ttlSeconds: number,
    options: PresignOptions,
  ): Promise<string>;
}
