// NFR-1 verification: "Order routing decision SHALL complete within 3 seconds
// of order-creation webhook receipt (95th percentile)." Seeds a throwaway
// merchant + catalog, fires ORDER_COUNT synthetic orders through the real
// routeOrder() (the same function the orders/create webhook handler calls),
// and reports p50/p95/p99/max latency. Cleans up after itself.
//
// Usage: npm run loadtest:routing [-- --count=500]
import "./load-env";
import db from "../app/db.server";
import { routeOrder } from "../app/routing/engine.server";
import { getOrCreateMerchant } from "../app/models/merchant.server";

const ORDER_COUNT = Number(process.argv.find((arg) => arg.startsWith("--count="))?.split("=")[1] ?? 300);

function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[index];
}

async function main() {
  const shop = `load-test-${Date.now()}.myshopify.com`;
  const merchant = await getOrCreateMerchant(shop);

  const partner = await db.partner.findUniqueOrThrow({ where: { partnerKey: "mock-rest" } });
  await db.merchantPartner.create({ data: { merchantId: merchant.id, partnerId: partner.id } });

  const product = await db.product.create({
    data: {
      merchantId: merchant.id,
      partnerId: partner.id,
      shopifyProductId: "gid://shopify/Product/load-test",
      partnerSku: "LTH-WALLET-BRN",
      category: "leather-goods",
      variantMap: { "gid://shopify/ProductVariant/load-test": "LTH-WALLET-BRN" },
      baseCost: 18.5,
    },
  });

  console.log(`Seeding ${ORDER_COUNT} orders...`);
  const orderIds: string[] = [];
  for (let i = 0; i < ORDER_COUNT; i++) {
    const order = await db.order.create({
      data: {
        merchantId: merchant.id,
        shopifyOrderId: `load-test-${i}`,
        shippingAddress: { name: "Load Test", address1: "1 St", city: "Town", countryCode: "US", zip: "00000" },
        shippingCountryCode: "US",
        lineItems: [
          { variantGid: "gid://shopify/ProductVariant/load-test", sku: "LTH-WALLET-BRN", quantity: 1, title: "Wallet" },
        ],
      },
    });
    orderIds.push(order.id);
  }

  console.log("Routing...");
  const latenciesMs: number[] = [];
  for (const orderId of orderIds) {
    const start = performance.now();
    await routeOrder(orderId);
    latenciesMs.push(performance.now() - start);
  }

  const sorted = [...latenciesMs].sort((a, b) => a - b);
  const p50 = percentile(sorted, 50);
  const p95 = percentile(sorted, 95);
  const p99 = percentile(sorted, 99);
  const max = sorted[sorted.length - 1];

  console.log(`\nRouting decision latency over ${ORDER_COUNT} orders:`);
  console.log(`  p50: ${p50.toFixed(1)}ms`);
  console.log(`  p95: ${p95.toFixed(1)}ms  (NFR-1 budget: 3000ms)`);
  console.log(`  p99: ${p99.toFixed(1)}ms`);
  console.log(`  max: ${max.toFixed(1)}ms`);
  console.log(p95 <= 3000 ? "\nPASS: p95 within NFR-1 budget." : "\nFAIL: p95 exceeds NFR-1 budget.");

  await db.fulfillment.deleteMany({ where: { order: { merchantId: merchant.id } } });
  await db.routingDecision.deleteMany({ where: { order: { merchantId: merchant.id } } });
  await db.order.deleteMany({ where: { merchantId: merchant.id } });
  await db.merchantNotification.deleteMany({ where: { merchantId: merchant.id } });
  await db.product.deleteMany({ where: { id: product.id } });
  await db.merchantPartner.deleteMany({ where: { merchantId: merchant.id } });
  await db.merchant.delete({ where: { id: merchant.id } });

  if (p95 > 3000) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error("LOAD TEST FAILED:", error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
