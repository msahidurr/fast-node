// Retry worker for fulfillment submission (FR-4.5). Same rationale as
// scripts/process-webhook-queue.ts: the container runs a single process, so
// this is meant to be invoked periodically by an external scheduler rather
// than run as a long-lived worker -- `npm run fulfillments:process`.
import "./load-env";
import db from "../app/db.server";
import { MAX_ATTEMPTS, submitFulfillment } from "../app/routing/submit.server";
import { logger } from "../app/utils/logger.server";

async function main() {
  const now = new Date();

  const due = await db.fulfillment.findMany({
    where: { status: "FAILED", attempts: { lt: MAX_ATTEMPTS }, nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: "asc" },
    take: 100,
  });

  logger.info("fulfillment_queue.retry_batch", { count: due.length });

  for (const fulfillment of due) {
    await submitFulfillment(fulfillment.id);
  }
}

main()
  .catch((error) => {
    logger.error("fulfillment_queue.retry_batch_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
