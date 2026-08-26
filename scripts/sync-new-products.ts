// FR-8.1 "new niche products" notifications. Same external-scheduler shape as
// every other worker in this app -- `npm run products:sync-new`.
import "./load-env";
import db from "../app/db.server";
import { syncNewProducts } from "../app/catalog/new-products.server";
import { logger } from "../app/utils/logger.server";

async function main() {
  const summary = await syncNewProducts();
  logger.info("new_products_sync.completed", { ...summary });
}

main()
  .catch((error) => {
    logger.error("new_products_sync.failed", { error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
