// Inventory sync worker (FR-2.4). Default interval is 15 minutes, configurable
// via INVENTORY_SYNC_INTERVAL_MINUTES -- but that value only documents the
// cadence an external scheduler should use (cron, k8s CronJob, ...): the
// single-process container from Phase 0 doesn't run its own timer, the same
// way scripts/process-webhook-queue.ts doesn't.
import "./load-env";
import db from "../app/db.server";
import { syncInventory } from "../app/catalog/inventory-sync.server";
import { logger } from "../app/utils/logger.server";

async function main() {
  const summary = await syncInventory();
  logger.info("inventory_sync.completed", { ...summary });
}

main()
  .catch((error) => {
    logger.error("inventory_sync.failed", { error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
