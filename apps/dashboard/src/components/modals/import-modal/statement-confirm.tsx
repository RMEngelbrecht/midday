"use client";

import { Button } from "@midday/ui/button";
import { Label } from "@midday/ui/label";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Controller } from "react-hook-form";
import { SelectAccount } from "@/components/select-account";
import { useTRPC } from "@/trpc/client";
import { useCsvContext } from "./context";

const FORMAT_LABELS = {
  ofx: "OFX / QFX",
  camt053: "CAMT.053 (ISO 20022)",
  mt940: "MT940",
  qif: "QIF",
} as const;

/** Replaces the column-mapping step for structured statement files. */
export function StatementConfirm() {
  const { statement, control, setValue } = useCsvContext();
  const trpc = useTRPC();
  const queryClient = useQueryClient();

  const createAccount = useMutation(
    trpc.bankAccounts.create.mutationOptions({
      onSuccess: (account) => {
        queryClient.invalidateQueries({
          queryKey: trpc.bankAccounts.get.queryKey(),
        });
        if (account) {
          setValue("bank_account_id", account.id, { shouldValidate: true });
        }
      },
    }),
  );

  if (!statement) return null;

  const currency = statement.currency ?? "USD";

  return (
    <div className="mt-6 flex flex-col gap-4">
      <div className="border p-3 text-sm">
        <p>
          {FORMAT_LABELS[statement.format]}: {statement.transactionCount}{" "}
          transactions found
        </p>
        {statement.accountLabel && (
          <p className="text-[#878787] text-xs mt-1">
            Account in file: {statement.accountLabel}
            {statement.currency ? ` (${statement.currency})` : ""}
          </p>
        )}
        <p className="text-[#878787] text-xs mt-1">
          Re-importing the same file never creates duplicates.
        </p>
      </div>

      <div>
        <Label className="mb-2 block">Import into account</Label>
        <Controller
          control={control}
          name="bank_account_id"
          render={({ field: { value, onChange } }) => (
            <SelectAccount
              className="w-full"
              placeholder="Select account"
              value={value}
              modal={false}
              popoverProps={{
                className: "z-[9999]",
                portal: true,
                avoidCollisions: true,
                collisionPadding: 8,
              }}
              onChange={(account) => {
                onChange(account.id);
                setValue("currency", account.currency ?? currency, {
                  shouldValidate: true,
                });
              }}
            />
          )}
        />
      </div>

      {statement.accountLabel && (
        <Button
          type="button"
          variant="outline"
          disabled={createAccount.isPending}
          onClick={() => {
            setValue("currency", currency);
            createAccount.mutate({
              name: statement.accountLabel as string,
              currency,
              manual: true,
            });
          }}
        >
          Create account from file ({statement.accountLabel})
        </Button>
      )}
    </div>
  );
}
