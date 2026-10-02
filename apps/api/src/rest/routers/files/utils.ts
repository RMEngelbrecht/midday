import { teamCache } from "@midday/cache/team-cache";
import type { Database } from "@midday/db/client";
import { hasTeamAccess } from "@midday/db/queries";
import {
  assertKey,
  attachmentHeader,
  getStorage,
  parseRange,
} from "@midday/storage";
import { HTTPException } from "hono/http-exception";

/**
 * Normalize and validate file path
 * Extracts teamId from path and validates format
 */
export function normalizeAndValidatePath(filePath: string): {
  normalizedPath: string;
  pathTeamId: string;
  pathArray: string[];
} {
  // Normalize path
  const normalizedPath = filePath.startsWith("vault/")
    ? filePath.substring("vault/".length)
    : filePath;

  // Extract teamId from path and validate
  const pathParts = normalizedPath.split("/");
  const pathTeamId = pathParts[0];
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  if (!pathTeamId || !uuidRegex.test(pathTeamId)) {
    throw new HTTPException(400, {
      message:
        "Invalid file path format. Path must start with a valid teamId UUID.",
    });
  }

  return {
    normalizedPath,
    pathTeamId,
    pathArray: pathParts,
  };
}

/**
 * Validate user has access to team using cache
 * Uses team cache for fast lookups, falls back to efficient DB query on cache miss
 */
export async function validateTeamAccess(
  db: Database,
  userId: string,
  teamId: string,
): Promise<void> {
  const cacheKey = `user:${userId}:team:${teamId}`;
  let hasAccess = await teamCache.get(cacheKey);

  if (hasAccess === undefined) {
    // Cache miss - use efficient hasTeamAccess query (direct join, no user lookup)
    hasAccess = await hasTeamAccess(db, teamId, userId);
    await teamCache.set(cacheKey, hasAccess);
  }

  if (!hasAccess) {
    throw new HTTPException(403, {
      message: "Access denied. File does not belong to your team.",
    });
  }
}

/**
 * Who may write where. Storage RLS used to enforce this; now the upload
 * endpoint does. The first path token scopes the object to its owner.
 */
export function canWriteObject(
  bucket: string,
  pathTokens: string[],
  actor: { teamId: string; userId: string },
): boolean {
  const [owner] = pathTokens;
  if (!owner || pathTokens.length < 2) return false;
  switch (bucket) {
    case "vault":
    case "apps":
      return owner === actor.teamId;
    case "avatars":
      return owner === actor.teamId || owner === actor.userId;
    default:
      return false;
  }
}

/** Types safe to render inline from the API origin; others download. */
const INLINE_TYPES =
  /^(application\/pdf|image\/(png|jpe?g|gif|webp|avif|heic|heif)|video\/[\w.+-]+|audio\/[\w.+-]+|text\/(plain|csv))(;|$)/i;

/**
 * Streams a stored object, honouring single byte ranges so PDF viewers and
 * video players can seek. Returns 404 when the object does not exist.
 */
export async function objectResponse(
  key: string,
  options: {
    rangeHeader?: string | null;
    download?: string;
    cacheControl?: string;
  } = {},
): Promise<Response> {
  try {
    assertKey(key);
  } catch {
    throw new HTTPException(400, { message: "Invalid file path" });
  }

  const storage = getStorage();
  const head = await storage.head(key);
  if (!head) {
    throw new HTTPException(404, { message: "File not found" });
  }

  const range = parseRange(options.rangeHeader, head.size);
  if (range === "unsatisfiable") {
    return new Response(null, {
      status: 416,
      headers: { "Content-Range": `bytes */${head.size}` },
    });
  }

  const object = await storage.get(key, range ? { range } : undefined);
  if (!object) {
    throw new HTTPException(404, { message: "File not found" });
  }

  const filename = options.download ?? key.split("/").at(-1) ?? "file";
  const inline = !options.download && INLINE_TYPES.test(object.contentType);
  const headers: Record<string, string> = {
    "Content-Type": object.contentType,
    "Accept-Ranges": "bytes",
    "Last-Modified": object.lastModified.toUTCString(),
    "Cross-Origin-Resource-Policy": "cross-origin",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": inline
      ? `inline; filename*=UTF-8''${encodeURIComponent(filename)}`
      : attachmentHeader(filename),
    "Cache-Control":
      options.cacheControl ?? object.cacheControl ?? "private, max-age=0",
  };

  if (object.range) {
    headers["Content-Range"] =
      `bytes ${object.range.start}-${object.range.end}/${object.size}`;
    headers["Content-Length"] = String(
      object.range.end - object.range.start + 1,
    );
    return new Response(object.body, { status: 206, headers });
  }

  headers["Content-Length"] = String(object.size);
  return new Response(object.body, { status: 200, headers });
}
