import { useSyncStatus } from "@/hooks/use-sync-status";

/**
 * Track the initial-bank-setup job started after connecting a bank.
 */
export function useInitialConnectionStatus({ jobId }: { jobId?: string }) {
  const { status, setStatus } = useSyncStatus({ jobId });

  return { status, setStatus };
}
