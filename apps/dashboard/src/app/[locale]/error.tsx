"use client";

import { Button } from "@midday/ui/button";
import { useEffect } from "react";
import { CopyInput } from "@/components/copy-input";
import { usePublicConfig } from "@/components/public-config-provider";

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { supportEmail } = usePublicConfig();

  useEffect(() => {
    // No-op unless Sentry was initialized (SENTRY_DSN, production).
    import("@sentry/nextjs").then((Sentry) => {
      Sentry.captureException(error);
    });
  }, [error]);

  return (
    <div className="h-[calc(100vh-200px)] w-full flex items-center justify-center">
      <div className="max-w-md w-full text-center px-4">
        <h2 className="font-medium mb-4">Something went wrong</h2>
        <p className="text-sm text-[#878787] mb-6">
          Something unexpected happened. Please try again.
          {supportEmail && (
            <>
              <br />
              If this issue persists, please reach out to support.
            </>
          )}
        </p>

        {supportEmail && <CopyInput value={supportEmail} />}

        {error.digest && (
          <p className="text-xs text-[#4a4a4a] mt-4">
            Error ID: {error.digest}
          </p>
        )}

        <Button onClick={() => reset()} variant="outline" className="mt-6">
          Try again
        </Button>
      </div>
    </div>
  );
}
