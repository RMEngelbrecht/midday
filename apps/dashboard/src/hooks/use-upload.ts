import { useState } from "react";
import { type StorageBucket, uploadFile as upload } from "@/utils/upload";

interface UploadParams {
  file: File;
  /** Full path inside the bucket, including the filename. */
  path: string[];
  bucket: StorageBucket;
}

interface UploadResult {
  url: string;
  path: string[];
}

export function useUpload() {
  const [isLoading, setLoading] = useState<boolean>(false);

  const uploadFile = async ({
    file,
    path,
    bucket,
  }: UploadParams): Promise<UploadResult> => {
    setLoading(true);

    try {
      const result = await upload({
        file,
        bucket,
        path: path.slice(0, -1),
        filename: path.at(-1),
      });

      return {
        url: result.url ?? "",
        path: result.path,
      };
    } finally {
      setLoading(false);
    }
  };

  return {
    uploadFile,
    isLoading,
  };
}
