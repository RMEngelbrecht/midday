import { countBankConnections } from "@midday/db/queries";
import type { Job } from "bullmq";
import {
  bankSyncScheduler,
  removeDynamicScheduler,
} from "../../schedulers/dynamic";
import {
  type DeleteConnectionPayload,
  deleteConnectionSchema,
} from "../../schemas/banking";
import { getBankingClient } from "../../utils/banking-client";
import { getDb } from "../../utils/db";
import { BaseProcessor } from "../base";

/**
 * Revoke a deleted connection at the provider. The DB row is already gone;
 * when it was the team's last connection the team's sync scheduler goes too.
 */
export class DeleteConnectionProcessor extends BaseProcessor<DeleteConnectionPayload> {
  protected override getPayloadSchema() {
    return deleteConnectionSchema;
  }

  async process(
    job: Job<DeleteConnectionPayload>,
  ): Promise<{ schedulerRemoved: boolean }> {
    const { teamId, referenceId, provider, accessToken } = job.data;

    if (referenceId || accessToken) {
      await getBankingClient(provider).deleteConnection({
        id: referenceId ?? "",
        accessToken: accessToken ?? undefined,
      });
    }

    let schedulerRemoved = false;
    if (teamId && (await countBankConnections(getDb(), { teamId })) === 0) {
      schedulerRemoved = await removeDynamicScheduler(
        bankSyncScheduler,
        teamId,
      );
      this.logger.info("Removed bank sync scheduler", {
        teamId,
        schedulerRemoved,
      });
    }

    return { schedulerRemoved };
  }
}
