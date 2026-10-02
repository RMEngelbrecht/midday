import { afterAll, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalDriver } from "./drivers/local";
import { S3Driver } from "./drivers/s3";
import { ENV } from "./env";
import { resolveDriverName } from "./index";
import { InvalidKeyError, objectKey } from "./keys";
import { verifySignedToken } from "./signing";
import { Storage } from "./storage";
import type { StorageDriver } from "./types";

const SECRET = "test-signing-secret";
const API = "http://api.test";
const PDF = new TextEncoder().encode("%PDF-1.4\nhello midday\n%%EOF");

const text = (body: ReadableStream<Uint8Array>) => new Response(body).text();
const run = crypto.randomUUID();

function streamOf(...chunks: string[]) {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(new TextEncoder().encode(chunk));
      }
      controller.close();
    },
  });
}

async function localDriver() {
  const dir = await mkdtemp(join(tmpdir(), "midday-storage-"));
  afterAll(() => rm(dir, { recursive: true, force: true }));
  return { driver: new LocalDriver(dir), dir };
}

function contractSuite(
  name: string,
  makeDriver: () => Promise<StorageDriver>,
  opts: { presigned?: boolean } = {},
) {
  describe(`${name} driver`, async () => {
    const driver = await makeDriver();
    const storage = new Storage(driver, {
      apiUrl: API,
      signingSecret: SECRET,
    });
    const team = `team-${run}`;
    const key = (path: string) => objectKey("vault", [team, path]);

    it("puts and gets bytes with metadata", async () => {
      const info = await storage.put(key("a/invoice.pdf"), PDF, {
        contentType: "application/pdf",
        cacheControl: "3600",
      });
      expect(info.size).toBe(PDF.byteLength);

      const object = await storage.get(key("a/invoice.pdf"));
      expect(object?.contentType).toBe("application/pdf");
      expect(object?.size).toBe(PDF.byteLength);
      expect(await text(object!.body)).toBe(new TextDecoder().decode(PDF));

      const head = await storage.head(key("a/invoice.pdf"));
      expect(head?.cacheControl).toBe("3600");
    });

    it("streams uploads and infers content type", async () => {
      await storage.put(key("a/notes.txt"), streamOf("hello ", "world"));
      const blob = await storage.download(key("a/notes.txt"));
      expect(await blob?.text()).toBe("hello world");
      expect(blob?.type).toStartWith("text/plain");
    });

    it("overwrites existing objects", async () => {
      await storage.put(key("a/notes.txt"), "v2");
      expect(await (await storage.download(key("a/notes.txt")))?.text()).toBe(
        "v2",
      );
    });

    it("reads byte ranges", async () => {
      const object = await storage.get(key("a/invoice.pdf"), {
        range: { start: 0, end: 3 },
      });
      expect(object?.range).toEqual({ start: 0, end: 3 });
      expect(object?.size).toBe(PDF.byteLength);
      expect(await text(object!.body)).toBe("%PDF");
    });

    it("returns null for missing objects", async () => {
      expect(await storage.get(key("missing.pdf"))).toBeNull();
      expect(await storage.head(key("missing.pdf"))).toBeNull();
      expect(await storage.download(key("missing.pdf"))).toBeNull();
    });

    it("lists recursively by prefix", async () => {
      await storage.put(key("b/deep/x.png"), "x", { contentType: "image/png" });
      const all = await storage.list(`vault/${team}/`);
      expect(all.map((o) => o.key)).toEqual([
        key("a/invoice.pdf"),
        key("a/notes.txt"),
        key("b/deep/x.png"),
      ]);
      const partial = await storage.list(`vault/${team}/a/inv`);
      expect(partial.map((o) => o.key)).toEqual([key("a/invoice.pdf")]);
      expect(await storage.list(`vault/${team}/nope/`)).toEqual([]);
    });

    it("deletes objects and ignores missing keys", async () => {
      await storage.delete([key("b/deep/x.png"), key("never-existed")]);
      expect(await storage.head(key("b/deep/x.png"))).toBeNull();
      expect((await storage.list(`vault/${team}/b`)).length).toBe(0);
    });

    it("signs URLs that expire", async () => {
      const url = await storage.signedUrl(key("a/invoice.pdf"), 1, {
        download: true,
      });

      if (opts.presigned) {
        const ok = await fetch(url);
        expect(ok.status).toBe(200);
        expect(ok.headers.get("content-disposition")).toContain("invoice.pdf");
        expect(await ok.text()).toBe(new TextDecoder().decode(PDF));
        await Bun.sleep(2100);
        // AWS answers 403, Garage 400: either way the URL is dead.
        const expired = await fetch(url);
        expect(expired.status).toBeGreaterThanOrEqual(400);
        expect(expired.status).toBeLessThan(500);
        return;
      }

      expect(url).toStartWith(`${API}/files/serve?token=`);
      const token = new URL(url).searchParams.get("token")!;
      expect(verifySignedToken(SECRET, token)).toMatchObject({
        k: key("a/invoice.pdf"),
        d: "invoice.pdf",
      });
      expect(verifySignedToken(SECRET, token, Date.now() + 2000)).toBeNull();
      expect(verifySignedToken("other-secret", token)).toBeNull();
      const [data, sig] = token.split(".");
      const forged = Buffer.from(
        JSON.stringify({ k: `vault/other-team/x.pdf`, e: 9999999999 }),
      ).toString("base64url");
      expect(verifySignedToken(SECRET, `${forged}.${sig}`)).toBeNull();
      expect(verifySignedToken(SECRET, `${data}.${sig}x`)).toBeNull();
    });

    it("rejects path traversal and malformed keys", async () => {
      const bad = [
        "vault/../secrets",
        `vault/${team}/../../etc/passwd`,
        "../vault/x",
        "/vault/x",
        "vault//x",
        "vault/a\\..\\b",
        "vault/a/./b",
        "nope/x",
        "vault",
        "vault/a\u0000b",
        ".meta/vault/x",
      ];
      for (const k of bad) {
        await expect(storage.put(k, "x")).rejects.toBeInstanceOf(
          InvalidKeyError,
        );
        await expect(storage.get(k)).rejects.toBeInstanceOf(InvalidKeyError);
      }
      await expect(storage.list("vault/../")).rejects.toBeInstanceOf(
        InvalidKeyError,
      );
      expect(() => objectKey("vault", ["..", "x"])).toThrow(InvalidKeyError);
    });

    it("only gives public URLs for public buckets", () => {
      expect(storage.publicUrl("avatars/u1/me 1.png")).toBe(
        `${API}/files/public/avatars/u1/me%201.png`,
      );
      expect(
        storage.keyFromPublicUrl(`${API}/files/public/avatars/u1/me%201.png`),
      ).toBe("avatars/u1/me 1.png");
      expect(() => storage.publicUrl(key("a/invoice.pdf"))).toThrow(
        InvalidKeyError,
      );
    });
  });
}

contractSuite("local", async () => (await localDriver()).driver);

describe("local driver internals", () => {
  it("refuses keys that escape the root even without the facade", async () => {
    const { driver } = await localDriver();
    await expect(driver.put("vault/../../escape", "x")).rejects.toBeInstanceOf(
      InvalidKeyError,
    );
  });

  it("leaves no temp files behind after a failed stream", async () => {
    const { driver, dir } = await localDriver();
    const failing = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.error(new Error("client went away"));
      },
    });
    await expect(driver.put("vault/t/f.bin", failing)).rejects.toThrow();
    expect(await driver.head("vault/t/f.bin")).toBeNull();
    expect(await readdir(join(dir, ".tmp"))).toEqual([]);
  });
});

describe("resolveDriverName", () => {
  it("defaults to local and infers s3 from S3_BUCKET", () => {
    expect(resolveDriverName({})).toBe("local");
    expect(resolveDriverName({ S3_BUCKET: "b" })).toBe("s3");
    expect(resolveDriverName({ STORAGE_DRIVER: "local", S3_BUCKET: "b" })).toBe(
      "local",
    );
  });
});

// Runs against a real S3-compatible server: `bun run test:s3` starts Garage.
const s3Enabled = Boolean(ENV.S3_BUCKET && ENV.S3_ENDPOINT);
const s3Config = () => ({
  bucket: ENV.S3_BUCKET!,
  region: ENV.S3_REGION,
  endpoint: ENV.S3_ENDPOINT,
  accessKeyId: ENV.S3_ACCESS_KEY_ID,
  secretAccessKey: ENV.S3_SECRET_ACCESS_KEY,
  forcePathStyle: ENV.S3_FORCE_PATH_STYLE,
});

if (s3Enabled) {
  contractSuite("s3 (proxied)", async () => new S3Driver(s3Config()));
  contractSuite(
    "s3 (presigned)",
    async () =>
      new S3Driver({ ...s3Config(), publicEndpoint: ENV.S3_ENDPOINT }),
    { presigned: true },
  );
} else {
  it.skip("s3 driver (set S3_* or run `bun run test:s3`)", () => {});
}
