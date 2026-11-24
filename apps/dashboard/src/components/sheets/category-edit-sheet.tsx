"use client";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@midday/ui/dropdown-menu";
import { Icons } from "@midday/ui/icons";
import { Sheet, SheetContent, SheetHeader } from "@midday/ui/sheet";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { DeleteCategoryDialog } from "@/components/delete-category-dialog";
import { useCategoryParams } from "@/hooks/use-category-params";
import { useTRPC } from "@/trpc/client";
import { CategoryEditForm } from "../forms/category-edit-form";

export function CategoryEditSheet() {
  const trpc = useTRPC();
  const queryClient = useQueryClient();
  const { setParams, categoryId } = useCategoryParams();

  const isOpen = Boolean(categoryId);

  const { data: category } = useQuery(
    trpc.transactionCategories.getById.queryOptions(
      { id: categoryId! },
      {
        enabled: isOpen,
        placeholderData: () => {
          const pages = queryClient
            .getQueriesData({
              queryKey: trpc.transactionCategories.get.queryKey(),
            })
            // @ts-expect-error
            .flatMap(([, data]) => data?.pages ?? [])
            .flatMap((page) => page.data ?? []);

          return pages.find((d) => d.id === categoryId);
        },
      },
    ),
  );

  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <Sheet open={isOpen} onOpenChange={() => setParams(null)}>
      <SheetContent>
        <SheetHeader className="mb-6 flex justify-between items-center flex-row">
          <h2 className="text-xl">Edit Category</h2>

          {categoryId && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button">
                  <Icons.MoreVertical className="size-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent sideOffset={10} align="end">
                <DropdownMenuItem
                  className="text-destructive"
                  onSelect={() => setDeleteOpen(true)}
                >
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </SheetHeader>

        <CategoryEditForm data={category} key={category?.id} />

        <DeleteCategoryDialog
          categoryId={deleteOpen ? (categoryId ?? null) : null}
          onOpenChange={setDeleteOpen}
          onDeleted={() => setParams(null)}
        />
      </SheetContent>
    </Sheet>
  );
}
