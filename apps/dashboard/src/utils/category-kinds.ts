import type { RouterOutputs } from "@api/trpc/routers/_app";

export type CategoryKind =
  RouterOutputs["transactionCategories"]["get"][number]["kind"];

export const CATEGORY_KIND_OPTIONS: Array<{
  value: CategoryKind;
  label: string;
  description: string;
}> = [
  {
    value: "expense",
    label: "Expense",
    description: "Money spent. Counts toward expenses and spending.",
  },
  {
    value: "income",
    label: "Income",
    description: "Money earned. Counts as revenue and in the Income filter.",
  },
  {
    value: "refund",
    label: "Refund",
    description: "Refunds and chargebacks you pay back. Kept out of revenue.",
  },
  {
    value: "cost_of_goods",
    label: "Cost of goods",
    description: "Direct costs of what you sell. Used for gross profit.",
  },
  {
    value: "transfer",
    label: "Transfer",
    description: "Money moved, not spent. Left out of the Expense filter.",
  },
];

export function getCategoryKindLabel(kind: CategoryKind | null | undefined) {
  return CATEGORY_KIND_OPTIONS.find((option) => option.value === kind)?.label;
}
