import { PrismaClient } from "@prisma/client";
import { getAdapter } from "../app/partners/registry.server";

const db = new PrismaClient();

// Seeds the two reference partners from Phase 1's adapter layer so onboarding
// and catalog browsing have real rows to work with. Their supportedCategories/
// regions must line up with what each adapter's getCatalog() actually returns
// (see app/partners/adapters/*.ts).
async function main() {
  const mockRest = await db.partner.upsert({
    where: { partnerKey: "mock-rest" },
    update: {},
    create: {
      partnerKey: "mock-rest",
      name: "Mock REST Sandbox Partner",
      integrationType: "REST",
      pricingFeedFormat: "API",
      supportedCategories: ["leather-goods", "eco-packaging"],
      regions: ["US", "EU"],
      slaHours: 48,
      shippingEstimate: 4.99,
    },
  });

  const csvSftp = await db.partner.upsert({
    where: { partnerKey: "csv-sftp" },
    update: {},
    create: {
      partnerKey: "csv-sftp",
      name: "CSV/SFTP Sandbox Partner",
      integrationType: "SFTP",
      pricingFeedFormat: "CSV",
      supportedCategories: ["pet-products", "home-decor"],
      regions: ["US"],
      slaHours: 72,
      shippingEstimate: 6.5,
    },
  });

  // Pre-seed "already seen" catalog SKUs so app/catalog/new-products.server.ts
  // only ever notifies merchants about products added *after* setup, not the
  // entire existing catalog on its first run (FR-8.1).
  for (const partner of [mockRest, csvSftp]) {
    const adapter = getAdapter(partner.partnerKey);
    for (const category of partner.supportedCategories) {
      for (const region of partner.regions) {
        const items = await adapter.getCatalog(category, region);
        for (const item of items) {
          await db.partnerCatalogSku.upsert({
            where: { partnerId_sku: { partnerId: partner.id, sku: item.sku } },
            update: {},
            create: { partnerId: partner.id, sku: item.sku, category },
          });
        }
      }
    }
  }
}

main()
  .then(() => db.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await db.$disconnect();
    process.exitCode = 1;
  });
