import { z } from "zod";
import type { BankProvider } from "../utils/banking-client";

/**
 * Banking job schemas
 */

/** Provider names come from the bank_connections row; @midday/banking validates them. */
export const bankProviderSchema = z.custom<BankProvider>(
  (value) => typeof value === "string" && value.length > 0,
  "Invalid bank provider",
);

export const initialBankSetupSchema = z.object({
  teamId: z.string().uuid(),
  connectionId: z.string().uuid(),
});

export type InitialBankSetupPayload = z.infer<typeof initialBankSetupSchema>;

export const syncConnectionSchema = z.object({
  connectionId: z.string().uuid(),
  manualSync: z.boolean().optional(),
  /** Lets the dashboard poll the job's status (team-scoped access check). */
  teamId: z.string().uuid().optional(),
});

export type SyncConnectionPayload = z.infer<typeof syncConnectionSchema>;

export const syncAccountSchema = z.object({
  id: z.string().uuid(),
  teamId: z.string().uuid(),
  connectionId: z.string().uuid(),
  accountId: z.string(),
  accessToken: z.string().optional(),
  errorRetries: z.number().nullable().optional(),
  provider: bankProviderSchema,
  manualSync: z.boolean().optional(),
  currency: z.string().nullable().optional(),
  accountType: z.enum([
    "credit",
    "other_asset",
    "other_liability",
    "depository",
    "loan",
  ]),
});

export type SyncAccountPayload = z.infer<typeof syncAccountSchema>;

export const bankSyncSchedulerSchema = z.object({
  teamId: z.string().uuid(),
});

export type BankSyncSchedulerPayload = z.infer<typeof bankSyncSchedulerSchema>;

export const reconnectConnectionSchema = z.object({
  teamId: z.string().uuid(),
  connectionId: z.string().uuid(),
  provider: bankProviderSchema,
});

export type ReconnectConnectionPayload = z.infer<
  typeof reconnectConnectionSchema
>;

export const deleteConnectionSchema = z.object({
  /** Used to drop the team's sync scheduler once its last connection is gone. */
  teamId: z.string().uuid().optional(),
  referenceId: z.string().optional().nullable(),
  provider: bankProviderSchema,
  accessToken: z.string().optional().nullable(),
});

export type DeleteConnectionPayload = z.infer<typeof deleteConnectionSchema>;

export const transactionNotificationsSchema = z.object({
  teamId: z.string().uuid(),
});

export type TransactionNotificationsPayload = z.infer<
  typeof transactionNotificationsSchema
>;
