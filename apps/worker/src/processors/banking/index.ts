import { BankSyncSchedulerProcessor } from "./bank-sync-scheduler";
import { DeleteConnectionProcessor } from "./delete-connection";
import { EnsureBankSchedulersProcessor } from "./ensure-bank-schedulers";
import { InitialBankSetupProcessor } from "./initial-bank-setup";
import { ReconnectConnectionProcessor } from "./reconnect-connection";
import { SyncAccountProcessor } from "./sync-account";
import { SyncConnectionProcessor } from "./sync-connection";
import { TransactionNotificationsProcessor } from "./transaction-notifications";

/**
 * Banking processor registry
 * Maps job names to processor instances
 */
export const bankingProcessors = {
  "initial-bank-setup": new InitialBankSetupProcessor(),
  "sync-connection": new SyncConnectionProcessor(),
  "sync-account": new SyncAccountProcessor(),
  "bank-sync-scheduler": new BankSyncSchedulerProcessor(),
  "ensure-bank-schedulers": new EnsureBankSchedulersProcessor(),
  "reconnect-connection": new ReconnectConnectionProcessor(),
  "delete-connection": new DeleteConnectionProcessor(),
  "transaction-notifications": new TransactionNotificationsProcessor(),
};
