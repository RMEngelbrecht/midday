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
import { SelectCategory } from "@/components/select-category";
import { useInvalidateTransactionQueries } from "@/hooks/use-invalidate-transaction-queries";
import { useTRPC } from "@/trpc/client";

type Replacement = {
  id: string;
  name: string;
  slug: string;
  color?: string | null;
};

type Props = {
  categoryId: string | null;
  onOpenChange: (open: boolean) => void;
  onDeleted?: () => void;
};

/**
 * Deletes a category after asking where its transactions should go.
 * Subcategories become top-level; Uncategorized and Internal Transfer are
 * protected.
 */
export function DeleteCategoryDialog({
  categoryId,
  onOpenChange,
  onDeleted,
}: Props) {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const invalidateTransactionQueries = useInvalidateTransactionQueries();
  const open = Boolean(categoryId);
  const [replacement, setReplacement] = useState<Replacement | undefined>();
  const [error, setError] = useState<string | null>(null);

  const { data: categories } = useQuery({
    ...trpc.transactionCategories.get.queryOptions(),
    enabled: open,
  });

  const { data: usage, isLoading } = useQuery({
    ...trpc.transactionCategories.usage.queryOptions({ id: categoryId ?? "" }),
    enabled: open,
  });

  const all = (categories ?? []).flatMap((parent) => [
    parent,
    ...(parent.children ?? []),
  ]);
  const category = all.find((item) => item.id === categoryId);
  const uncategorized = all.find((item) => item.slug === "uncategorized");
  const selectedReplacement: Replacement | undefined =
    replacement ??
    (uncategorized
      ? {
          id: uncategorized.id,
          name: uncategorized.name,
          slug: "uncategorized",
          color: uncategorized.color,
        }
      : undefined);
  const isLastIncomeCategory =
    category?.kind === "income" &&
    all.filter((item) => item.kind === "income").length === 1;

  const deleteMutation = useMutation(
    trpc.transactionCategories.delete.mutationOptions({
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: trpc.transactionCategories.get.queryKey(),
        });
        invalidateTransactionQueries();
        close();
        onDeleted?.();
      },
      onError: (err) => setError(err.message),
    }),
  );

  function close() {
    setReplacement(undefined);
    setError(null);
    onOpenChange(false);
  }

  const transactionCount = usage?.transactionCount ?? 0;
  const childCount = usage?.childCount ?? 0;

  return (
    <AlertDialog open={open} onOpenChange={(next) => !next && close()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete {category?.name ?? "category"}?
          </AlertDialogTitle>
          <AlertDialogDescription asChild>
            <div className="space-y-3">
              {isLoading ? (
                <Spinner size={16} />
              ) : usage?.protected ? (
                <p>
                  This category is needed by the app and can't be deleted. You
                  can rename it or change its color instead.
                </p>
              ) : (
                <>
                  {transactionCount > 0 ? (
                    <p>
                      {transactionCount === 1
                        ? "1 transaction uses this category."
                        : `${transactionCount} transactions use this category.`}{" "}
                      Move them to:
                    </p>
                  ) : (
                    <p>No transactions use this category.</p>
                  )}
                  {childCount > 0 && (
                    <p>
                      {childCount === 1
                        ? "Its subcategory becomes a top-level category."
                        : `Its ${childCount} subcategories become top-level categories.`}
                    </p>
                  )}
                  {isLastIncomeCategory && (
                    <p className="text-destructive">
                      This is your only income category. Without one, nothing
                      counts as income in reports until you mark another
                      category as Income.
                    </p>
                  )}
                </>
              )}
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>

        {!isLoading && !usage?.protected && transactionCount > 0 && (
          <div className="border border-border h-9 flex items-center">
            <SelectCategory
              selected={selectedReplacement}
              onChange={(selected) => setReplacement(selected)}
              hideLoading
            />
          </div>
        )}

        {error && <p className="text-sm text-destructive">{error}</p>}

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          {!usage?.protected && (
            <Button
              variant="destructive"
              disabled={isLoading || deleteMutation.isPending}
              onClick={() =>
                categoryId &&
                deleteMutation.mutate({
                  id: categoryId,
                  replacementSlug: selectedReplacement?.slug ?? "uncategorized",
                })
              }
            >
              {deleteMutation.isPending ? <Spinner size={16} /> : "Delete"}
            </Button>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
