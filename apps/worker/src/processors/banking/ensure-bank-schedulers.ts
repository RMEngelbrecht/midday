import { getTeamsWithBankConnections } from "@midday/db/queries";
import type { Job } from "bullmq";
import {
  bankSyncScheduler,
  reconcileDynamicSchedulers,
} from "../../schedulers/dynamic";
import { getDb } from "../../utils/db";
import { BaseProcessor } from "../base";

/**
 * Daily reconcile: every team with a bank connection has a sync scheduler,
 * and schedulers of teams without connections are removed.
 */
export class EnsureBankSchedulersProcessor extends BaseProcessor<
  Record<string, never>
> {
  async process(_job: Job<Record<string, never>>) {
    const teams = await getTeamsWithBankConnections(getDb());

    return reconcileDynamicSchedulers(
      bankSyncScheduler,
      teams.map((team) => team.id),
    );
  }
}
