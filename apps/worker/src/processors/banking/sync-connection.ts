import type { Job } from "bullmq";
import {
  type SyncConnectionPayload,
  syncConnectionSchema,
} from "../../schemas/banking";
import { getDb } from "../../utils/db";
import { BaseProcessor } from "../base";
import { type SyncConnectionResult, syncConnection } from "./sync";

/**
 * Sync a bank connection. Triggered by the per-team scheduler, provider
 * webhooks (Plaid, Teller), the dashboard's sync button and reconnects.
 */
export class SyncConnectionProcessor extends BaseProcessor<SyncConnectionPayload> {
  protected override getPayloadSchema() {
    return syncConnectionSchema;
  }

  async process(
    job: Job<SyncConnectionPayload>,
  ): Promise<SyncConnectionResult> {
    return syncConnection(
      getDb(),
      {
        connectionId: job.data.connectionId,
        manualSync: job.data.manualSync,
        parentJobId: job.id,
      },
      this.logger,
    );
  }
}
