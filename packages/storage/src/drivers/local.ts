import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeWebReadableStream } from "node:stream/web";
import { contentTypeFromKey, InvalidKeyError } from "../keys";
import type {
  Body,
  ByteRange,
  GetResult,
  ListedObject,
  ObjectInfo,
  PutOptions,
  StorageDriver,
} from "../types";

type Meta = { contentType: string; cacheControl?: string };

/**
 * Stores objects as plain files under `root/<key>`. Writes go to `root/.tmp`
 * and are renamed into place, so readers never see partial files. Content
 * type and cache control live in a sidecar tree at `root/.meta/<key>.json`.
 * Bucket names never start with a dot, so neither tree collides with keys.
 */
export class LocalDriver implements StorageDriver {
  readonly name = "local";
  private readonly root: string;

  constructor(root: string) {
    this.root = resolve(root);
  }

  private pathFor(key: string, tree = ""): string {
    const base = tree ? join(this.root, tree) : this.root;
    const full = resolve(base, ...key.split("/"));
    if (!full.startsWith(base + sep)) {
      throw new InvalidKeyError(key, "escapes the storage root");
    }
    return full;
  }

  private metaPath(key: string) {
    return `${this.pathFor(key, ".meta")}.json`;
  }

  private async readMeta(key: string): Promise<Meta> {
    try {
      return JSON.parse(await readFile(this.metaPath(key), "utf8")) as Meta;
    } catch {
      return { contentType: contentTypeFromKey(key) };
    }
  }

  private async tmpFile() {
    const dir = join(this.root, ".tmp");
    await mkdir(dir, { recursive: true });
    return join(dir, randomUUID());
  }

  async put(key: string, body: Body, options: PutOptions = {}) {
    const target = this.pathFor(key);
    const tmp = await this.tmpFile();

    try {
      if (typeof body === "string" || body instanceof Uint8Array) {
        await writeFile(tmp, body);
      } else if (body instanceof ArrayBuffer) {
        await writeFile(tmp, new Uint8Array(body));
      } else {
        const stream = body instanceof Blob ? body.stream() : body;
        await pipeline(
          Readable.fromWeb(stream as unknown as NodeWebReadableStream),
          createWriteStream(tmp),
        );
      }

      await mkdir(dirname(target), { recursive: true });
      await rename(tmp, target);
    } catch (error) {
      await rm(tmp, { force: true });
      throw error;
    }

    const meta: Meta = {
      contentType:
        options.contentType ||
        (body instanceof Blob && body.type) ||
        contentTypeFromKey(key),
      cacheControl: options.cacheControl,
    };
    const metaTmp = await this.tmpFile();
    const metaTarget = this.metaPath(key);
    await writeFile(metaTmp, JSON.stringify(meta));
    await mkdir(dirname(metaTarget), { recursive: true });
    await rename(metaTmp, metaTarget);

    const info = await stat(target);
    return {
      key,
      size: info.size,
      lastModified: info.mtime,
      ...meta,
    };
  }

  async head(key: string): Promise<ObjectInfo | null> {
    const info = await stat(this.pathFor(key)).catch(() => null);
    if (!info?.isFile()) return null;
    const meta = await this.readMeta(key);
    return { key, size: info.size, lastModified: info.mtime, ...meta };
  }

  async get(
    key: string,
    options: { range?: ByteRange } = {},
  ): Promise<GetResult | null> {
    const info = await this.head(key);
    if (!info) return null;

    const range = options.range
      ? {
          start: options.range.start,
          end: Math.min(options.range.end ?? info.size - 1, info.size - 1),
        }
      : undefined;

    const stream = createReadStream(this.pathFor(key), range);
    return {
      ...info,
      body: Readable.toWeb(stream) as unknown as ReadableStream<Uint8Array>,
      range,
    };
  }

  async delete(keys: string[]) {
    await Promise.all(
      keys.flatMap((key) => [
        rm(this.pathFor(key), { force: true }),
        rm(this.metaPath(key), { force: true }),
      ]),
    );
  }

  async list(prefix: string): Promise<ListedObject[]> {
    const dirPart = prefix.includes("/")
      ? prefix.slice(0, prefix.lastIndexOf("/"))
      : prefix;
    const start = this.pathFor(dirPart || prefix);
    const results: ListedObject[] = [];

    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true }).catch(
        () => [],
      );
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          await walk(full);
        } else if (entry.isFile()) {
          const key = relative(this.root, full).split(sep).join("/");
          if (!key.startsWith(prefix)) continue;
          const info = await stat(full);
          results.push({ key, size: info.size, lastModified: info.mtime });
        }
      }
    };

    await walk(start);
    return results.sort((a, b) => a.key.localeCompare(b.key));
  }
}
