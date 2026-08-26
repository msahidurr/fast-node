// FR-5.1/FR-5.2 polling worker. Same external-scheduler shape as every other
// worker in this app (single-process container, see Phase 0) --
// `npm run tracking:sync`.
import "./load-env";
import db from "../app/db.server";
import { syncFulfillmentStatuses } from "../app/tracking/status-sync.server";
import { logger } from "../app/utils/logger.server";

async function main() {
  const summary = await syncFulfillmentStatuses();
  logger.info("tracking_sync.completed", { ...summary });
}

main()
  .catch((error) => {
    logger.error("tracking_sync.failed", { error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
