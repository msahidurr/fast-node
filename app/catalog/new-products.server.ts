import db from "../db.server";
import { getAdapter } from "../partners/registry.server";
import { notifyMerchant } from "../notifications/notify.server";
import { logger } from "../utils/logger.server";

export interface NewProductsSyncSummary {
  checked: number;
  newSkus: number;
}

// FR-8.1: notifies merchants when a connected partner's catalog gains a SKU
// in a category they picked at onboarding. First-seen bookkeeping lives in
// PartnerCatalogSku, pre-seeded alongside each Partner (prisma/seed.ts) so
// "new" means "new since setup", not "everything that already existed".
// Invoked periodically by scripts/sync-new-products.ts.
export async function syncNewProducts(): Promise<NewProductsSyncSummary> {
  const partners = await db.partner.findMany({ where: { active: true } });
  const summary: NewProductsSyncSummary = { checked: 0, newSkus: 0 };

  for (const partner of partners) {
    const adapter = getAdapter(partner.partnerKey);

    for (const category of partner.supportedCategories) {
      for (const region of partner.regions) {
        const items = await adapter.getCatalog(category, region);
        summary.checked += items.length;

        for (const item of items) {
          const existing = await db.partnerCatalogSku.findUnique({
            where: { partnerId_sku: { partnerId: partner.id, sku: item.sku } },
          });
          if (existing) continue;

          await db.partnerCatalogSku.create({ data: { partnerId: partner.id, sku: item.sku, category } });
          summary.newSkus += 1;

          const connections = await db.merchantPartner.findMany({
            where: { partnerId: partner.id, merchant: { selectedCategories: { has: category } } },
            include: { merchant: true },
          });
          for (const connection of connections) {
            await notifyMerchant({
              merchantId: connection.merchant.id,
              type: "NEW_PRODUCTS",
              message: `${partner.name} added a new ${category} product: "${item.name}" (SKU ${item.sku}).`,
              metadata: { partnerId: partner.id, sku: item.sku },
            });
          }
          logger.info("new_products.notified", {
            partnerId: partner.id,
            sku: item.sku,
            merchantCount: connections.length,
          });
        }
      }
    }
  }

  return summary;
}
