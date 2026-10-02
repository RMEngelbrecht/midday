import { isAbsolute, resolve } from "node:path";
import { LocalDriver } from "./drivers/local";
import { S3Driver } from "./drivers/s3";
import { ENV } from "./env";
import { verifySignedToken } from "./signing";
import { Storage } from "./storage";

export * from "./http";
export * from "./keys";
export * from "./signing";
export { type SignedUrlOptions, Storage, type StorageConfig } from "./storage";
export type * from "./types";
export { LocalDriver, S3Driver };

export type DriverName = "local" | "s3";

/** `STORAGE_DRIVER` wins; otherwise a configured S3 bucket selects s3. */
export function resolveDriverName(env: {
  STORAGE_DRIVER?: string;
  S3_BUCKET?: string;
}): DriverName {
  if (env.STORAGE_DRIVER === "local" || env.STORAGE_DRIVER === "s3") {
    return env.STORAGE_DRIVER;
  }
  return env.S3_BUCKET?.trim() ? "s3" : "local";
}

/** Relative local dirs resolve against the repo root so api and worker agree. */
export function resolveLocalDir(dir: string): string {
  // packages/storage/src -> repo root
  return isAbsolute(dir) ? dir : resolve(__dirname, "../../..", dir);
}

function createStorageFromEnv(): Storage {
  const config = {
    apiUrl: ENV.API_URL.replace(/\/+$/, ""),
    signingSecret: ENV.FILE_KEY_SECRET,
  };

  if (resolveDriverName(ENV) === "s3") {
    if (!ENV.S3_BUCKET) {
      throw new Error("STORAGE_DRIVER=s3 requires S3_BUCKET");
    }
    return new Storage(
      new S3Driver({
        bucket: ENV.S3_BUCKET,
        region: ENV.S3_REGION,
        endpoint: ENV.S3_ENDPOINT,
        accessKeyId: ENV.S3_ACCESS_KEY_ID,
        secretAccessKey: ENV.S3_SECRET_ACCESS_KEY,
        forcePathStyle: ENV.S3_FORCE_PATH_STYLE,
        publicEndpoint: ENV.S3_PUBLIC_ENDPOINT,
      }),
      {
        ...config,
        publicBaseUrl: ENV.S3_PUBLIC_URL?.replace(/\/+$/, ""),
      },
    );
  }

  return new Storage(
    new LocalDriver(resolveLocalDir(ENV.STORAGE_LOCAL_DIR)),
    config,
  );
}

let storage: Storage | undefined;

/** The process-wide storage, configured from env on first use. */
export function getStorage(): Storage {
  storage ??= createStorageFromEnv();
  return storage;
}

/** Largest upload accepted by the API, in bytes. */
export function maxUploadBytes(): number {
  return ENV.STORAGE_MAX_UPLOAD_MB * 1024 * 1024;
}

/** Verifies a token from an API-served signed URL (`/files/serve?token=`). */
export function verifyStorageToken(token: string) {
  return verifySignedToken(ENV.FILE_KEY_SECRET, token);
}
