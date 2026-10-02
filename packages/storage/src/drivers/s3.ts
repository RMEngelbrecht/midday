import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
} from "@aws-sdk/client-s3";
import { Upload } from "@aws-sdk/lib-storage";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { attachmentHeader } from "../http";
import { contentTypeFromKey } from "../keys";
import type {
  Body,
  ByteRange,
  GetResult,
  ListedObject,
  ObjectInfo,
  PutOptions,
  StorageDriver,
} from "../types";

export type S3DriverConfig = {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
  /** Endpoint clients can reach; enables direct presigned URLs. */
  publicEndpoint?: string;
};

function isNotFound(error: unknown) {
  return (
    error instanceof S3ServiceException &&
    (error.name === "NoSuchKey" ||
      error.name === "NotFound" ||
      error.$metadata.httpStatusCode === 404)
  );
}

export class S3Driver implements StorageDriver {
  readonly name = "s3";
  private readonly client: S3Client;
  private readonly bucket: string;
  readonly presignGet?: StorageDriver["presignGet"];

  constructor(config: S3DriverConfig) {
    const make = (endpoint?: string) =>
      new S3Client({
        region: config.region,
        endpoint,
        forcePathStyle: config.forcePathStyle,
        credentials:
          config.accessKeyId && config.secretAccessKey
            ? {
                accessKeyId: config.accessKeyId,
                secretAccessKey: config.secretAccessKey,
              }
            : undefined,
      });

    this.bucket = config.bucket;
    this.client = make(config.endpoint);
    if (config.publicEndpoint) {
      const presignClient = make(config.publicEndpoint);
      this.presignGet = (key, ttlSeconds, options) =>
        getSignedUrl(
          presignClient,
          new GetObjectCommand({
            Bucket: this.bucket,
            Key: key,
            ResponseContentDisposition: options.download
              ? attachmentHeader(options.download)
              : undefined,
          }),
          { expiresIn: ttlSeconds },
        );
    }
  }

  async put(key: string, body: Body, options: PutOptions = {}) {
    const contentType =
      options.contentType ||
      (body instanceof Blob && body.type) ||
      contentTypeFromKey(key);
    const params = {
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      CacheControl: options.cacheControl,
    };

    if (body instanceof ReadableStream) {
      // Unknown length: multipart upload streams it without buffering it all.
      await new Upload({
        client: this.client,
        params: { ...params, Body: body },
      }).done();
    } else {
      const bytes =
        body instanceof Blob
          ? new Uint8Array(await body.arrayBuffer())
          : body instanceof ArrayBuffer
            ? new Uint8Array(body)
            : body;
      await this.client.send(new PutObjectCommand({ ...params, Body: bytes }));
    }

    const info = await this.head(key);
    if (!info) throw new Error(`Upload of ${key} did not persist`);
    return info;
  }

  async head(key: string): Promise<ObjectInfo | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        key,
        size: res.ContentLength ?? 0,
        contentType: res.ContentType || contentTypeFromKey(key),
        cacheControl: res.CacheControl,
        lastModified: res.LastModified ?? new Date(0),
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async get(
    key: string,
    options: { range?: ByteRange } = {},
  ): Promise<GetResult | null> {
    const { range } = options;
    try {
      const res = await this.client.send(
        new GetObjectCommand({
          Bucket: this.bucket,
          Key: key,
          Range: range ? `bytes=${range.start}-${range.end ?? ""}` : undefined,
        }),
      );
      if (!res.Body) return null;

      let returned: GetResult["range"];
      const match = res.ContentRange?.match(/bytes (\d+)-(\d+)\/(\d+)/);
      if (range && match) {
        returned = { start: Number(match[1]), end: Number(match[2]) };
      }

      return {
        key,
        size: match ? Number(match[3]) : (res.ContentLength ?? 0),
        contentType: res.ContentType || contentTypeFromKey(key),
        cacheControl: res.CacheControl,
        lastModified: res.LastModified ?? new Date(0),
        body: res.Body.transformToWebStream() as ReadableStream<Uint8Array>,
        range: returned,
      };
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  async delete(keys: string[]) {
    for (let i = 0; i < keys.length; i += 1000) {
      const chunk = keys.slice(i, i + 1000);
      await this.client.send(
        new DeleteObjectsCommand({
          Bucket: this.bucket,
          Delete: { Objects: chunk.map((Key) => ({ Key })), Quiet: true },
        }),
      );
    }
  }

  async list(prefix: string): Promise<ListedObject[]> {
    const results: ListedObject[] = [];
    let token: string | undefined;
    do {
      const res = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      for (const item of res.Contents ?? []) {
        if (!item.Key) continue;
        results.push({
          key: item.Key,
          size: item.Size ?? 0,
          lastModified: item.LastModified ?? new Date(0),
        });
      }
      token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return results;
  }
}
