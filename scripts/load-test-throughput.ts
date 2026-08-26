// NFR-2 verification: "Backend SHALL support at least 500 orders/minute
// platform-wide at launch." NFR-3 verification: "degrade gracefully (queue
// orders) during partner API outages" -- simulates a partner outage by
// swapping in a failing adapter mid-run, confirms nothing is lost (every
// order still gets a durable Order/RoutingDecision/Fulfillment row even when
// submission fails -- NFR-6), then swaps the real adapter back and drains the
// retry backlog to confirm recovery.
//
// Usage: npm run loadtest:throughput [-- --count=500 --batch=25]
import "./load-env";
import db from "../app/db.server";
import { getOrCreateMerchant } from "../app/models/merchant.server";
import { routeOrder } from "../app/routing/engine.server";
import { registerAdapter } from "../app/partners/registry.server";
import { mockRestAdapter } from "../app/partners/adapters/mock-rest.adapter";
import type { PartnerAdapter } from "../app/partners/types";

function argNumber(flag: string, fallback: number): number {
  const raw = process.argv.find((arg) => arg.startsWith(`--${flag}=`))?.split("=")[1];
  return raw ? Number(raw) : fallback;
}

const ORDER_COUNT = argNumber("count", 500);
const BATCH_SIZE = argNumber("batch", 25);
const OUTAGE_ORDER_COUNT = 50;

async function runInBatches<T>(items: T[], batchSize: number, fn: (item: T, index: number) => Promise<void>) {
  for (let i = 0; i < items.length; i += batchSize) {
    await Promise.all(items.slice(i, i + batchSize).map((item, offset) => fn(item, i + offset)));
  }
}

async function main() {
  const shop = `load-test-throughput-${Date.now()}.myshopify.com`;
  const merchant = await getOrCreateMerchant(shop);
  const partner = await db.partner.findUniqueOrThrow({ where: { partnerKey: "mock-rest" } });
  await db.merchantPartner.create({ data: { merchantId: merchant.id, partnerId: partner.id } });

  const product = await db.product.create({
    data: {
      merchantId: merchant.id,
      partnerId: partner.id,
      shopifyProductId: "gid://shopify/Product/loadtest-throughput",
      partnerSku: "LTH-WALLET-BRN",
      category: "leather-goods",
      variantMap: { "gid://shopify/ProductVariant/loadtest": "LTH-WALLET-BRN" },
      baseCost: 18.5,
    },
  });

  async function makeOrder(shopifyOrderId: string) {
    return db.order.create({
      data: {
        merchantId: merchant.id,
        shopifyOrderId,
        shippingAddress: { name: "Load Test", address1: "1 St", city: "Town", countryCode: "US", zip: "00000" },
        shippingCountryCode: "US",
        lineItems: [
          { variantGid: "gid://shopify/ProductVariant/loadtest", sku: "LTH-WALLET-BRN", quantity: 1, title: "Wallet" },
        ],
      },
    });
  }

  // --- Phase A: sustained throughput (NFR-2) ---------------------------------
  console.log(`Phase A: routing ${ORDER_COUNT} orders in batches of ${BATCH_SIZE}...`);
  const orderIds: string[] = [];
  for (let i = 0; i < ORDER_COUNT; i++) {
    orderIds.push((await makeOrder(`throughput-${i}`)).id);
  }

  const start = performance.now();
  let succeeded = 0;
  let failed = 0;
  await runInBatches(orderIds, BATCH_SIZE, async (orderId) => {
    try {
      const result = await routeOrder(orderId);
      if (result.groupsFailed > 0) failed += 1;
      else succeeded += 1;
    } catch {
      failed += 1;
    }
  });
  const elapsedSeconds = (performance.now() - start) / 1000;
  const ordersPerMinute = (ORDER_COUNT / elapsedSeconds) * 60;

  console.log(`  ${succeeded} succeeded, ${failed} failed, in ${elapsedSeconds.toFixed(1)}s`);
  console.log(`  throughput: ${ordersPerMinute.toFixed(0)} orders/minute (NFR-2 budget: 500/minute)`);
  console.log(ordersPerMinute >= 500 ? "  PASS" : "  FAIL");

  // --- Phase B: simulated partner outage (NFR-3/NFR-6) -----------------------
  console.log(`\nPhase B: simulating a mock-rest outage for ${OUTAGE_ORDER_COUNT} orders...`);
  const failingAdapter: PartnerAdapter = {
    partnerKey: "mock-rest",
    async getCatalog() {
      return [];
    },
    async getInventory() {
      throw new Error("simulated partner outage");
    },
    async createOrder() {
      throw new Error("simulated partner outage");
    },
    async getOrderStatus() {
      throw new Error("simulated partner outage");
    },
    async submitDispute() {
      throw new Error("simulated partner outage");
    },
  };
  registerAdapter(failingAdapter); // registry.server.ts's registration is a plain overwrite -- swap it back after

  const outageOrderIds: string[] = [];
  for (let i = 0; i < OUTAGE_ORDER_COUNT; i++) {
    outageOrderIds.push((await makeOrder(`outage-${i}`)).id);
  }
  await runInBatches(outageOrderIds, BATCH_SIZE, async (orderId) => {
    await routeOrder(orderId).catch(() => undefined);
  });

  // A getInventory-stage outage means no candidate was ever viable, so these
  // are recorded as routing failures (PARTNER_UNAVAILABLE), not Fulfillments
  // -- same shape as an OUT_OF_STOCK routing failure. What must be true is
  // that *every* order still got a RoutingDecision recorded, none silently
  // dropped by an uncaught exception.
  const routingDecisionsDuringOutage = await db.routingDecision.findMany({
    where: { orderId: { in: outageOrderIds } },
  });
  const allPartnerUnavailable = routingDecisionsDuringOutage.every(
    (d) => d.reasonCode === "PARTNER_UNAVAILABLE" && d.partnerId === null,
  );
  console.log(`  ${outageOrderIds.length} orders ingested, ${routingDecisionsDuringOutage.length} routing decisions recorded`);
  console.log(
    outageOrderIds.length === routingDecisionsDuringOutage.length && allPartnerUnavailable
      ? "  PASS: every order was durably recorded despite the outage (NFR-6), none silently dropped"
      : "  FAIL: some orders were lost during the outage",
  );

  // --- Recovery: outage ends, retry backlog drains ---------------------------
  // These orders never got a Fulfillment (the outage hit getInventory, before
  // one would've been created) -- recovery means re-routing, not resubmitting,
  // which is exactly what scripts/retry-routing-failures.ts does for orders
  // stuck in ROUTING_FAILED.
  console.log("\nRecovery: restoring the real adapter and re-routing the backlog...");
  registerAdapter(mockRestAdapter);
  await runInBatches(outageOrderIds, BATCH_SIZE, async (orderId) => {
    await routeOrder(orderId);
  });
  const fulfillmentsAfterRecovery = await db.fulfillment.findMany({ where: { orderId: { in: outageOrderIds } } });
  const recovered = fulfillmentsAfterRecovery.filter((f) => f.status === "QUEUED").length;
  console.log(`  ${recovered}/${OUTAGE_ORDER_COUNT} recovered to QUEUED after the simulated outage ended`);
  console.log(recovered === OUTAGE_ORDER_COUNT ? "  PASS" : "  FAIL");

  // Cleanup
  const allOrderIds = [...orderIds, ...outageOrderIds];
  await db.dispute.deleteMany({ where: { orderId: { in: allOrderIds } } });
  await db.fulfillment.deleteMany({ where: { orderId: { in: allOrderIds } } });
  await db.routingDecision.deleteMany({ where: { orderId: { in: allOrderIds } } });
  await db.order.deleteMany({ where: { id: { in: allOrderIds } } });
  await db.merchantNotification.deleteMany({ where: { merchantId: merchant.id } });
  await db.product.delete({ where: { id: product.id } });
  await db.merchantPartner.deleteMany({ where: { merchantId: merchant.id } });
  await db.merchant.delete({ where: { id: merchant.id } });
  console.log("\ncleanup done");
}

main()
  .catch((error) => {
    console.error("LOAD TEST FAILED:", error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
