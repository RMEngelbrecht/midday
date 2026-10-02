import { stripSpecialCharacters } from "@midday/utils";
import { getClientPublicConfig } from "@/components/public-config-provider";
import { getAccessToken } from "@/lib/auth-client";

export type StorageBucket = "vault" | "avatars" | "apps";

export type UploadResult = {
  file: File;
  filename: string;
  /** Path inside the bucket, including the filename. */
  path: string[];
  /** Public URL for avatars/apps; null for the private vault. */
  url: string | null;
};

type UploadParams = {
  file: File;
  bucket: StorageBucket;
  /** Folder tokens. */
  path: string[];
  /** Defaults to the sanitized `file.name`. */
  filename?: string;
  onProgress?: (bytesUploaded: number, bytesTotal: number) => void;
};

/**
 * Uploads a file through the API (`POST /files/upload`), which checks the
 * path belongs to the caller's team. Uses XHR for upload progress events and
 * the same bearer token as tRPC.
 */
export async function uploadFile({
  file,
  bucket,
  path,
  filename = stripSpecialCharacters(file.name),
  onProgress,
}: UploadParams): Promise<UploadResult> {
  const fullPath = [...path, filename];
  const { apiUrl } = getClientPublicConfig();
  const token = await getAccessToken();

  const query = new URLSearchParams({
    bucket,
    path: decodeURIComponent(fullPath.join("/")),
  });

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${apiUrl}/files/upload?${query}`);
    if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    xhr.setRequestHeader(
      "Content-Type",
      file.type || "application/octet-stream",
    );

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded, event.total);
    };
    xhr.onerror = () => reject(new Error("Upload failed: network error"));
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText}`));
        return;
      }
      const body = JSON.parse(xhr.responseText) as {
        path: string[];
        url: string | null;
      };
      resolve({ file, filename, path: body.path, url: body.url });
    };

    xhr.send(file);
  });
}
