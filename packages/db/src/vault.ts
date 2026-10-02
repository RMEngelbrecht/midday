import { type Body, getStorage, objectKey } from "@midday/storage";
import type { Database } from "./client";
import { deleteVaultDocuments, upsertVaultDocument } from "./queries/documents";

/**
 * Vault writes go through here so the `documents` table stays a projection of
 * vault contents: every object under `<teamId>/...` has a row.
 */
export async function putVaultFile(
  db: Database,
  params: {
    path: string[];
    body: Body;
    contentType?: string;
    cacheControl?: string;
    ownerId?: string | null;
  },
) {
  const { path, body, contentType, cacheControl, ownerId } = params;
  const info = await getStorage().put(objectKey("vault", path), body, {
    contentType,
    cacheControl,
  });

  await upsertVaultDocument(db, {
    pathTokens: path,
    size: info.size,
    mimetype: info.contentType,
    ownerId,
  });

  return info;
}

/** Deletes vault objects (paths relative to the bucket) and their rows. */
export async function removeVaultFiles(
  db: Database,
  params: { teamId: string; paths: string[][] },
) {
  const { teamId, paths } = params;
  const own = paths.filter((p) => p[0] === teamId && p.length > 1);
  await getStorage().delete(own.map((p) => objectKey("vault", p)));
  await deleteVaultDocuments(db, {
    teamId,
    names: own.map((p) => p.join("/")),
  });
}
