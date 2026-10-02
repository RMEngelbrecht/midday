import type { Context } from "@api/rest/types";
import { OpenAPIHono } from "@hono/zod-openapi";
import { putVaultFile } from "@midday/db/vault";
import {
  type Bucket,
  getStorage,
  isPublicBucket,
  maxUploadBytes,
  objectKey,
} from "@midday/storage";
import { HTTPException } from "hono/http-exception";
import { fileMiddleware } from "../../middleware";
import { canWriteObject } from "./utils";

const app = new OpenAPIHono<Context>();

class TooLargeError extends Error {}

/** Passes bytes through, failing the stream once `limit` is exceeded. */
function limitStream(limit: number) {
  let seen = 0;
  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength;
      if (seen > limit) {
        controller.error(new TooLargeError());
        return;
      }
      controller.enqueue(chunk);
    },
  });
}

/**
 * Streaming upload: `POST /files/upload?bucket=vault&path=<teamId>/inbox/a.pdf`
 * with the raw file as the body and its type as `Content-Type`. The first
 * path token must be the caller's team (or, for avatars, the caller).
 */
app.use("/upload", ...fileMiddleware);

app.post("/upload", async (c) => {
  const bucket = c.req.query("bucket") ?? "";
  const path = c.req.query("path") ?? "";
  const tokens = path.split("/");
  const session = c.get("session");
  const teamId = c.get("teamId");

  if (!isPublicBucket(bucket) && bucket !== "vault") {
    throw new HTTPException(400, { message: "Unknown bucket" });
  }
  if (bucket === "institutions") {
    throw new HTTPException(403, { message: "Bucket is read-only" });
  }

  let key: string;
  try {
    key = objectKey(bucket as Bucket, tokens);
  } catch {
    throw new HTTPException(400, { message: "Invalid file path" });
  }

  if (!canWriteObject(bucket, tokens, { teamId, userId: session.user.id })) {
    throw new HTTPException(403, {
      message: "Access denied. Path does not belong to your team.",
    });
  }

  const limit = maxUploadBytes();
  const declared = Number(c.req.header("content-length") ?? 0);
  if (declared > limit) {
    throw new HTTPException(413, { message: "File too large" });
  }

  const raw = c.req.raw.body;
  if (!raw) {
    throw new HTTPException(400, { message: "Request body is required" });
  }

  const body = raw.pipeThrough(limitStream(limit));
  const contentType = c.req.header("content-type") || undefined;
  const isPublic = isPublicBucket(bucket);

  try {
    if (bucket === "vault") {
      await putVaultFile(c.get("db"), {
        path: tokens,
        body,
        contentType,
        cacheControl: "private, max-age=3600",
        ownerId: session.user.id,
      });
    } else {
      await getStorage().put(key, body, {
        contentType,
        cacheControl: "public, max-age=3600",
      });
    }
  } catch (error) {
    if (error instanceof TooLargeError) {
      throw new HTTPException(413, { message: "File too large" });
    }
    throw error;
  }

  return c.json({
    bucket,
    path: tokens,
    url: isPublic ? getStorage().publicUrl(key) : null,
  });
});

export { app as uploadRouter };
