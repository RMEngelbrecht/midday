import {
  createTransactionCategorySchema,
  deleteTransactionCategorySchema,
  getCategoryByIdSchema,
  updateTransactionCategorySchema,
} from "@api/schemas/transaction-categories";
import {
  applyCategoryHistory,
  createTransactionCategory,
  deleteTransactionCategory,
  getCategories,
  getCategoryById,
  getCategoryUsage,
  updateTransactionCategory,
} from "@midday/db/queries";
import { z } from "zod";
import { mcpCategoryDetailSchema, sanitize, sanitizeArray } from "../schemas";
import {
  DESTRUCTIVE_ANNOTATIONS,
  hasScope,
  READ_ONLY_ANNOTATIONS,
  type RegisterTools,
  WRITE_ANNOTATIONS,
} from "../types";
import { withErrorHandling } from "../utils";

export const registerCategoryTools: RegisterTools = (server, ctx) => {
  const { db, teamId, userId } = ctx;

  const hasReadScope = hasScope(ctx, "transactions.read");
  const hasWriteScope = hasScope(ctx, "transactions.write");

  if (!hasReadScope && !hasWriteScope) {
    return;
  }

  if (hasReadScope) {
    server.registerTool(
      "categories_list",
      {
        title: "List Transaction Categories",
        description:
          "List all transaction categories as a tree with parent categories and their children, built-in and custom. Each has a kind: expense, income, refund, cost_of_goods or transfer, which decides how reports count it (income kinds are revenue). Use category slugs (not IDs) when filtering or categorizing transactions.",
        inputSchema: {
          limit: z.coerce
            .number()
            .optional()
            .describe(
              "Max number of parent categories to return (default 1000)",
            ),
        },
        outputSchema: {
          data: z.array(z.record(z.string(), z.any())),
        },
        annotations: READ_ONLY_ANNOTATIONS,
      },
      withErrorHandling(async (params) => {
        const result = await getCategories(db, {
          teamId,
          limit: params.limit,
        });

        const clean = sanitizeArray(mcpCategoryDetailSchema, result ?? []);

        return {
          content: [{ type: "text" as const, text: JSON.stringify(clean) }],
          structuredContent: { data: clean },
        };
      }, "Failed to list categories"),
    );

    server.registerTool(
      "categories_get",
      {
        title: "Get Transaction Category",
        description:
          "Get a single transaction category by ID with its child categories, color, description, and tax settings.",
        inputSchema: {
          id: getCategoryByIdSchema.shape.id,
        },
        outputSchema: {
          data: z.record(z.string(), z.any()),
        },
        annotations: READ_ONLY_ANNOTATIONS,
      },
      withErrorHandling(async ({ id }) => {
        const result = await getCategoryById(db, { id, teamId });

        if (!result) {
          return {
            content: [{ type: "text" as const, text: "Category not found" }],
            isError: true,
          };
        }

        const clean = sanitize(mcpCategoryDetailSchema, result);

        return {
          content: [{ type: "text" as const, text: JSON.stringify(clean) }],
          structuredContent: { data: clean },
        };
      }, "Failed to get category"),
    );

    server.registerTool(
      "categories_usage",
      {
        title: "Get Transaction Category Usage",
        description:
          "How many transactions and subcategories a category has, and whether it is protected (Uncategorized and Internal Transfer cannot be deleted). Check this before categories_delete to choose a replacementSlug.",
        inputSchema: {
          id: getCategoryByIdSchema.shape.id,
        },
        outputSchema: {
          data: z.record(z.string(), z.any()),
        },
        annotations: READ_ONLY_ANNOTATIONS,
      },
      withErrorHandling(async ({ id }) => {
        const result = await getCategoryUsage(db, { id, teamId });

        if (!result) {
          return {
            content: [{ type: "text" as const, text: "Category not found" }],
            isError: true,
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: { data: result },
        };
      }, "Failed to get category usage"),
    );
  }

  if (hasWriteScope) {
    server.registerTool(
      "categories_create",
      {
        title: "Create Transaction Category",
        description:
          "Create a custom transaction category. Name is required. Optionally set color, description, tax rate, kind (expense, income, refund, cost_of_goods, transfer; a subcategory defaults to its parent's kind) and parent category to create a subcategory.",
        inputSchema: {
          name: createTransactionCategorySchema.shape.name,
          color: createTransactionCategorySchema.shape.color,
          description: createTransactionCategorySchema.shape.description,
          taxRate: createTransactionCategorySchema.shape.taxRate,
          taxType: createTransactionCategorySchema.shape.taxType,
          taxReportingCode:
            createTransactionCategorySchema.shape.taxReportingCode,
          parentId: createTransactionCategorySchema.shape.parentId,
          kind: createTransactionCategorySchema.shape.kind,
        },
        annotations: WRITE_ANNOTATIONS,
      },
      async (params) => {
        try {
          const result = await createTransactionCategory(db, {
            teamId,
            userId,
            name: params.name,
            color: params.color,
            description: params.description,
            taxRate: params.taxRate,
            taxType: params.taxType,
            taxReportingCode: params.taxReportingCode,
            parentId: params.parentId,
            kind: params.kind,
          });

          if (!result) {
            return {
              content: [{ type: "text", text: "Failed to create category" }],
              isError: true,
            };
          }

          const clean = sanitize(mcpCategoryDetailSchema, result);

          return {
            content: [{ type: "text", text: JSON.stringify(clean) }],
            structuredContent: { data: clean },
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? error.message
                    : "Failed to create category",
              },
            ],
            isError: true,
          };
        }
      },
    );

    server.registerTool(
      "categories_update",
      {
        title: "Update Transaction Category",
        description:
          "Update an existing transaction category. Provide the category ID and only the fields to change. Cannot change parent of a category that has children.",
        inputSchema: {
          id: updateTransactionCategorySchema.shape.id,
          name: updateTransactionCategorySchema.shape.name,
          color: updateTransactionCategorySchema.shape.color,
          description: updateTransactionCategorySchema.shape.description,
          taxRate: updateTransactionCategorySchema.shape.taxRate,
          taxType: updateTransactionCategorySchema.shape.taxType,
          taxReportingCode:
            updateTransactionCategorySchema.shape.taxReportingCode,
          parentId: updateTransactionCategorySchema.shape.parentId,
          kind: updateTransactionCategorySchema.shape.kind,
        },
        annotations: WRITE_ANNOTATIONS,
      },
      async (params) => {
        try {
          const result = await updateTransactionCategory(db, {
            id: params.id,
            teamId,
            name: params.name,
            color: params.color,
            description: params.description,
            taxRate: params.taxRate,
            taxType: params.taxType,
            taxReportingCode: params.taxReportingCode,
            parentId: params.parentId,
            kind: params.kind,
          });

          if (!result) {
            return {
              content: [
                { type: "text", text: "Category not found or update failed" },
              ],
              isError: true,
            };
          }

          const clean = sanitize(mcpCategoryDetailSchema, result);

          return {
            content: [{ type: "text", text: JSON.stringify(clean) }],
            structuredContent: { data: clean },
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? error.message
                    : "Failed to update category",
              },
            ],
            isError: true,
          };
        }
      },
    );

    server.registerTool(
      "categories_fill_from_history",
      {
        title: "Fill Categories From History",
        description:
          "Give uncategorised transactions (no category or Uncategorized) the category the team chose before for the same vendor, where that history clearly agrees. Transactions with a category are never changed. Call with dryRun true first to see how many would change. Returns { count }.",
        inputSchema: {
          dryRun: z
            .boolean()
            .optional()
            .describe("Only count the transactions that would be categorised"),
        },
        outputSchema: {
          count: z.number(),
        },
        annotations: WRITE_ANNOTATIONS,
      },
      withErrorHandling(async ({ dryRun }) => {
        const result = await applyCategoryHistory(db, { teamId, dryRun });

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result) }],
          structuredContent: result,
        };
      }, "Failed to fill categories from history"),
    );

    server.registerTool(
      "categories_delete",
      {
        title: "Delete Transaction Category",
        description:
          'Delete a transaction category by ID, built-in or custom. Its transactions move to replacementSlug (default "uncategorized") and its subcategories become top-level. Uncategorized and Internal Transfer cannot be deleted. Returns the deleted category.',
        inputSchema: {
          id: deleteTransactionCategorySchema.shape.id,
          replacementSlug:
            deleteTransactionCategorySchema.shape.replacementSlug,
        },
        annotations: DESTRUCTIVE_ANNOTATIONS,
      },
      async ({ id, replacementSlug }) => {
        try {
          const result = await deleteTransactionCategory(db, {
            id,
            teamId,
            replacementSlug,
          });

          if (!result) {
            return {
              content: [
                {
                  type: "text",
                  text: "Category not found",
                },
              ],
              isError: true,
            };
          }

          const clean = sanitize(mcpCategoryDetailSchema, result);

          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ success: true, deleted: clean }),
              },
            ],
            structuredContent: { success: true, deleted: clean },
          };
        } catch (error) {
          return {
            content: [
              {
                type: "text",
                text:
                  error instanceof Error
                    ? error.message
                    : "Failed to delete category",
              },
            ],
            isError: true,
          };
        }
      },
    );
  }
};
