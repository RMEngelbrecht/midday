import { getBankConnections } from "@midday/db/queries";
import { triggerJob } from "@midday/job-client";
import type { Job } from "bullmq";
import {
  bankSyncScheduler,
  removeDynamicScheduler,
} from "../../schedulers/dynamic";
import {
  type BankSyncSchedulerPayload,
  bankSyncSchedulerSchema,
} from "../../schemas/banking";
import { getDb } from "../../utils/db";
import { BaseProcessor } from "../base";

/**
 * Fired daily per team by its job scheduler; fans out one sync-connection job
 * per bank connection. Connection status is checked by each sync.
 */
export class BankSyncSchedulerProcessor extends BaseProcessor<BankSyncSchedulerPayload> {
  protected override getPayloadSchema() {
    return bankSyncSchedulerSchema;
  }

  async process(
    job: Job<BankSyncSchedulerPayload>,
  ): Promise<{ connections: number }> {
    const { teamId } = job.data;
    const connections = await getBankConnections(getDb(), { teamId });

    if (connections.length === 0) {
      // Last connection was deleted: drop the scheduler so it stops firing
      await removeDynamicScheduler(bankSyncScheduler, teamId);
      this.logger.info("No bank connections, removed scheduler", { teamId });
      return { connections: 0 };
    }

    for (const connection of connections) {
      await triggerJob(
        "sync-connection",
        { connectionId: connection.id, teamId },
        "banking",
      );
    }

    this.logger.info("Bank sync fan-out", {
      teamId,
      connections: connections.length,
    });

    return { connections: connections.length };
  }
}
