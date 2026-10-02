import { useEffect, useState } from "react";
import { useJobStatus } from "@/hooks/use-job-status";

type SyncStatus = "FAILED" | "SYNCING" | "COMPLETED" | null;

/**
 * Track a background sync job (bank or inbox) by its composite job id.
 */
export function useSyncStatus({ jobId }: { jobId?: string }) {
  const [status, setStatus] = useState<SyncStatus>(null);
  const job = useJobStatus({ jobId, enabled: !!jobId });

  useEffect(() => {
    if (jobId) {
      setStatus("SYNCING");
    }
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;

    if (job.queryError || job.status === "failed") {
      setStatus("FAILED");
    }

    if (job.status === "completed") {
      setStatus("COMPLETED");
    }
  }, [jobId, job.status, job.queryError]);

  return {
    status,
    setStatus,
    result: job.result as Record<string, unknown> | undefined,
  };
}
