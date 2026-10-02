/**
 * Print every BullMQ job scheduler, per queue.
 *   varlock run -- bun scripts/list-schedulers.ts
 */
import { getAllQueues } from "../src/queues";

const queues = getAllQueues();

for (const queue of queues) {
  const schedulers = await queue.getJobSchedulers(0, -1, true);
  for (const s of schedulers) {
    console.log(
      [queue.name, s.key, s.name, s.pattern ?? `every ${s.every}ms`].join("\t"),
    );
  }
}

await Promise.all(queues.map((queue) => queue.close()));
process.exit(0);
