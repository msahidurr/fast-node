// Retry worker for the durable webhook queue. The Docker image runs a single
// process (see Dockerfile/shopify.web.toml), so this is meant to be invoked
// periodically by an external scheduler (cron, k8s CronJob, Heroku Scheduler,
// etc.) rather than run as a long-lived process -- `npm run queue:process`.
import "./load-env";
import db from "../app/db.server";
import { processWebhookEvent } from "../app/webhooks/process.server";
import { WEBHOOK_HANDLERS } from "../app/webhooks/handlers.server";
import { logger } from "../app/utils/logger.server";

const STUCK_PROCESSING_MS = 5 * 60_000; // treat as crashed after 5 minutes

async function main() {
  const now = new Date();

  // Recover events stuck in PROCESSING from a crash mid-handler.
  await db.webhookEvent.updateMany({
    where: { status: "PROCESSING", receivedAt: { lt: new Date(now.getTime() - STUCK_PROCESSING_MS) } },
    data: { status: "PENDING" },
  });

  const due = await db.webhookEvent.findMany({
    where: { status: "PENDING", nextAttemptAt: { lte: now } },
    orderBy: { nextAttemptAt: "asc" },
    take: 100,
  });

  logger.info("queue.retry_batch", { count: due.length });

  for (const event of due) {
    const handler = WEBHOOK_HANDLERS[event.topic];
    if (!handler) {
      logger.error("queue.unknown_topic", { eventId: event.id, topic: event.topic });
      continue;
    }
    await processWebhookEvent(event.id, handler);
  }
}

main()
  .catch((error) => {
    logger.error("queue.retry_batch_failed", { error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
