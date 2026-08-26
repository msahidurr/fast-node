// NFR-3: re-attempts routing for orders still stuck in ROUTING_FAILED or
// PARTIALLY_SUBMITTED (e.g. a partner outage during the original attempt).
// routeOrder() is safe to re-call -- groups that already have a Fulfillment
// are skipped, so this only (re)routes what never made it through. Same
// external-scheduler shape as every other worker in this app --
// `npm run routing:retry`.
import "./load-env";
import db from "../app/db.server";
import { routeOrder } from "../app/routing/engine.server";
import { logger } from "../app/utils/logger.server";

async function main() {
  const stuckOrders = await db.order.findMany({
    where: { status: { in: ["ROUTING_FAILED", "PARTIALLY_SUBMITTED"] } },
    select: { id: true },
  });

  logger.info("routing_retry.batch", { count: stuckOrders.length });

  for (const order of stuckOrders) {
    await routeOrder(order.id).catch((error) => {
      logger.error("routing_retry.order_failed", {
        orderId: order.id,
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }
}

main()
  .catch((error) => {
    logger.error("routing_retry.batch_failed", { error: error instanceof Error ? error.message : String(error) });
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
