import {
  createTransactionCategorySchema,
  deleteTransactionCategorySchema,
  getCategoriesSchema,
  getCategoryByIdSchema,
  getCategoryUsageSchema,
  updateTransactionCategorySchema,
} from "@api/schemas/transaction-categories";
import { createTRPCRouter, protectedProcedure } from "@api/trpc/init";
import {
  CategoryDeleteError,
  createTransactionCategory,
  deleteTransactionCategory,
  getCategories,
  getCategoryById,
  getCategoryUsage,
  updateTransactionCategory,
} from "@midday/db/queries";
import { TRPCError } from "@trpc/server";

export const transactionCategoriesRouter = createTRPCRouter({
  get: protectedProcedure
    .input(getCategoriesSchema)
    .query(async ({ ctx: { db, teamId }, input }) => {
      const data = await getCategories(db, {
        teamId: teamId!,
        limit: input?.limit,
      });

      return data;
    }),

  getById: protectedProcedure
    .input(getCategoryByIdSchema)
    .query(async ({ input, ctx: { db, teamId } }) => {
      return getCategoryById(db, { id: input.id, teamId: teamId! });
    }),

  usage: protectedProcedure
    .input(getCategoryUsageSchema)
    .query(async ({ input, ctx: { db, teamId } }) => {
      return getCategoryUsage(db, { id: input.id, teamId: teamId! });
    }),

  create: protectedProcedure
    .input(createTransactionCategorySchema)
    .mutation(async ({ input, ctx: { db, teamId, session } }) => {
      return createTransactionCategory(db, {
        teamId: teamId!,
        userId: session.user.id,
        ...input,
      });
    }),

  update: protectedProcedure
    .input(updateTransactionCategorySchema)
    .mutation(async ({ input, ctx: { db, teamId } }) => {
      return updateTransactionCategory(db, {
        ...input,
        teamId: teamId!,
      });
    }),

  delete: protectedProcedure
    .input(deleteTransactionCategorySchema)
    .mutation(async ({ input, ctx: { db, teamId } }) => {
      try {
        return await deleteTransactionCategory(db, {
          id: input.id,
          teamId: teamId!,
          replacementSlug: input.replacementSlug,
        });
      } catch (error) {
        if (error instanceof CategoryDeleteError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        throw error;
      }
    }),
});
