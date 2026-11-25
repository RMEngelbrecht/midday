"use client";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@midday/ui/alert-dialog";
import { Button } from "@midday/ui/button";
import { Spinner } from "@midday/ui/spinner";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useInvalidateTransactionQueries } from "@/hooks/use-invalidate-transaction-queries";
import { useTRPC } from "@/trpc/client";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * Gives uncategorised transactions the category the team chose before for
 * the same vendor, after showing how many that would be.
 */
export function FillCategoriesFromHistoryDialog({ open, onOpenChange }: Props) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const invalidateTransactionQueries = useInvalidateTransactionQueries();
  const [applied, setApplied] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data: preview, isLoading } = useQuery({
    ...trpc.transactionCategories.historyPreview.queryOptions(),
    enabled: open && applied === null,
    staleTime: 0,
  });

  const applyMutation = useMutation(
    trpc.transactionCategories.applyHistory.mutationOptions({
      onSuccess: ({ count }) => {
        setApplied(count);
        queryClient.invalidateQueries({
          queryKey: trpc.transactionCategories.historyPreview.queryKey(),
        });
        invalidateTransactionQueries();
      },
      onError: (err) => setError(err.message),
    }),
  );

  function close() {
    setApplied(null);
    setError(null);
    onOpenChange(false);
  }

  const count = preview?.count ?? 0;

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Fill categories from history</AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              {applied !== null ? (
                <p>
                  {applied === 1
                    ? "1 transaction was categorised."
                    : `${applied} transactions were categorised.`}
                </p>
              ) : isLoading ? (
                <Spinner size={16} />
              ) : count === 0 ? (
                <p>
                  No uncategorised transactions are from vendors you have
                  categorised before.
                </p>
              ) : (
                <p>
                  {count === 1
                    ? "1 uncategorised transaction is"
                    : `${count} uncategorised transactions are`}{" "}
                  from vendors you have categorised before. Give{" "}
                  {count === 1 ? "it" : "them"} the same category? Transactions
                  that already have a category are not changed.
                </p>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error && <p className="text-sm text-destructive">{error}</p>}

        <AlertDialogFooter>
          <AlertDialogCancel>
            {applied !== null || count === 0 ? "Close" : "Cancel"}
          </AlertDialogCancel>
          {applied === null && count > 0 && (
            <Button
              disabled={isLoading || applyMutation.isPending}
              onClick={() => applyMutation.mutate()}
            >
              {applyMutation.isPending ? <Spinner size={16} /> : "Categorise"}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
