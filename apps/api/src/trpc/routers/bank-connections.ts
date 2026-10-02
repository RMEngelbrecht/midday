import {
  addProviderAccountsSchema,
  createBankConnectionSchema,
  deleteBankConnectionSchema,
  getBankConnectionsSchema,
  reconnectBankConnectionSchema,
  reconnectSyncBankConnectionSchema,
  syncBankConnectionSchema,
} from "@api/schemas/bank-connections";
import { createTRPCRouter, protectedProcedure } from "@api/trpc/init";

import {
  addProviderAccounts,
  createBankConnection,
  deleteBankConnection,
  getBankConnectionForSync,
  getBankConnections,
  reconnectBankConnection,
} from "@midday/db/queries";
import { triggerJob } from "@midday/job-client";
import { TRPCError } from "@trpc/server";

export const bankConnectionsRouter = createTRPCRouter({
  get: protectedProcedure
    .input(getBankConnectionsSchema)
    .query(async ({ ctx: { db, teamId }, input }) => {
      return getBankConnections(db, {
        teamId: teamId!,
        enabled: input?.enabled,
      });
    }),

  create: protectedProcedure
    .input(createBankConnectionSchema)
    .mutation(async ({ input, ctx: { db, teamId, session } }) => {
      const data = await createBankConnection(db, {
        ...input,
        teamId: teamId!,
        userId: session.user.id,
      });

      if (!data) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Bank connection not found",
        });
      }

      // The dashboard polls this job until the first sync is done
      return triggerJob(
        "initial-bank-setup",
        { connectionId: data.id, teamId: teamId! },
        "banking",
      );
    }),

  delete: protectedProcedure
    .input(deleteBankConnectionSchema)
    .mutation(async ({ input, ctx: { db, teamId } }) => {
      const data = await deleteBankConnection(db, {
        id: input.id,
        teamId: teamId!,
      });

      if (!data) {
        throw new Error("Bank connection not found");
      }

      await triggerJob(
        "delete-connection",
        {
          teamId: teamId!,
          referenceId: data.referenceId,
          provider: data.provider,
          accessToken: data.accessToken,
        },
        "banking",
      );

      return data;
    }),

  addAccounts: protectedProcedure
    .input(addProviderAccountsSchema)
    .mutation(async ({ input, ctx: { db, teamId, session } }) => {
      const result = await addProviderAccounts(db, {
        connectionId: input.connectionId,
        teamId: teamId!,
        userId: session.user.id,
        accounts: input.accounts,
      });

      return result;
    }),

  reconnect: protectedProcedure
    .input(reconnectBankConnectionSchema)
    .mutation(async ({ input, ctx: { db, teamId } }) => {
      const result = await reconnectBankConnection(db, {
        referenceId: input.referenceId,
        newReferenceId: input.newReferenceId,
        expiresAt: input.expiresAt,
        teamId: teamId!,
      });

      if (!result) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Bank connection not found",
        });
      }

      return result;
    }),

  /** Manual sync from the dashboard; returns the job id to poll. */
  sync: protectedProcedure
    .input(syncBankConnectionSchema)
    .mutation(async ({ input, ctx: { db, teamId } }) => {
      await assertConnectionInTeam(db, input.connectionId, teamId!);

      return triggerJob(
        "sync-connection",
        { connectionId: input.connectionId, manualSync: true, teamId },
        "banking",
      );
    }),

  /**
   * After the user re-authenticated with the provider: re-map account ids
   * and sync. Returns the job id to poll.
   */
  reconnectSync: protectedProcedure
    .input(reconnectSyncBankConnectionSchema)
    .mutation(async ({ input, ctx: { db, teamId } }) => {
      await assertConnectionInTeam(db, input.connectionId, teamId!);

      return triggerJob(
        "reconnect-connection",
        {
          teamId,
          connectionId: input.connectionId,
          provider: input.provider,
        },
        "banking",
      );
    }),
});

async function assertConnectionInTeam(
  db: Parameters<typeof getBankConnectionForSync>[0],
  connectionId: string,
  teamId: string,
) {
  const connection = await getBankConnectionForSync(db, { id: connectionId });

  if (!connection || connection.teamId !== teamId) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Bank connection not found",
    });
  }
}
