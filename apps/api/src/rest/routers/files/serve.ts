import type { Context } from "@api/rest/types";
import { proxyFileSchema } from "@api/schemas/files";
import { createRoute, OpenAPIHono, z } from "@hono/zod-openapi";
import { isPublicBucket, verifyStorageToken } from "@midday/storage";
import { HTTPException } from "hono/http-exception";
import { withDatabase } from "../../middleware/db";
import { withFileAuth } from "../../middleware/file-auth";
import { withClientIp } from "../../middleware/ip";
import { normalizeAndValidatePath, objectResponse } from "./utils";

const app = new OpenAPIHono<Context>();

const errorResponseSchema = z.object({
  error: z.string(),
});

app.openapi(
  createRoute({
    method: "get",
    path: "/proxy",
    summary: "Proxy file from storage",
    operationId: "proxyFile",
    "x-speakeasy-name-override": "proxy",
    description:
      "Proxies a file from storage. Requires team file key (fk) query parameter for access.",
    tags: ["Files"],
    request: {
      query: proxyFileSchema,
    },
    responses: {
      200: {
        description: "File content",
        content: {
          "application/octet-stream": {
            schema: {
              type: "string",
              format: "binary",
            },
          },
        },
      },
      400: {
        description: "Bad request",
        content: {
          "application/json": {
            schema: errorResponseSchema,
          },
        },
      },
      404: {
        description: "Not found",
        content: {
          "application/json": {
            schema: errorResponseSchema,
          },
        },
      },
      500: {
        description: "Internal server error",
        content: {
          "application/json": {
            schema: errorResponseSchema,
          },
        },
      },
    },
    middleware: [withClientIp, withDatabase, withFileAuth],
  }),
  async (c) => {
    const { filePath } = c.req.valid("query");
    const { normalizedPath } = normalizeAndValidatePath(filePath);

    return objectResponse(`vault/${normalizedPath}`, {
      rangeHeader: c.req.header("range"),
    });
  },
);

/**
 * Signed URLs minted by `storage.signedUrl()` when objects are not served
 * directly by the backend. The HMAC token carries key, expiry and filename.
 */
app.get("/serve", withClientIp, async (c) => {
  const token = c.req.query("token");
  const payload = token ? verifyStorageToken(token) : null;

  if (!payload) {
    throw new HTTPException(403, { message: "Invalid or expired link" });
  }

  return objectResponse(payload.k, {
    rangeHeader: c.req.header("range"),
    download: payload.d,
  });
});

/** Objects in public buckets (avatars, app logos, institution logos). */
app.get("/public/:bucket/*", async (c) => {
  const bucket = c.req.param("bucket");
  if (!isPublicBucket(bucket)) {
    throw new HTTPException(404, { message: "File not found" });
  }

  const prefix = `/files/public/${bucket}/`;
  const encoded = c.req.path.slice(c.req.path.indexOf(prefix) + prefix.length);
  let path: string;
  try {
    path = encoded.split("/").map(decodeURIComponent).join("/");
  } catch {
    throw new HTTPException(400, { message: "Invalid file path" });
  }

  return objectResponse(`${bucket}/${path}`, {
    rangeHeader: c.req.header("range"),
    cacheControl: "public, max-age=3600",
  });
});

export { app as serveRouter };
