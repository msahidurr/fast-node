import db from "../db.server";
import { getAdapter } from "../partners/registry.server";
import type { CatalogItem } from "../partners/types";

// One buyable "product" as it'll appear in Shopify: every partner catalog row
// sharing the same partner/category/region/name becomes one variant of it
// (FR-2.2's variant mapping starts here, at import time).
export interface CatalogGroup {
  partnerId: string;
  partnerKey: string;
  partnerName: string;
  name: string;
  category: string;
  region: string;
  items: CatalogItem[];
}

function groupKey(partnerId: string, item: CatalogItem): string {
  return `${partnerId}:${item.category}:${item.region}:${item.name}`;
}

// Aggregates live catalog data (FR-2.1) across every partner the merchant
// connected during onboarding, optionally filtered to one category.
export async function getCatalogForMerchant(merchantId: string, category?: string): Promise<CatalogGroup[]> {
  const connections = await db.merchantPartner.findMany({
    where: { merchantId },
    include: { partner: true },
  });

  const groups = new Map<string, CatalogGroup>();

  for (const { partner } of connections) {
    if (!partner.active) continue;
    const adapter = getAdapter(partner.partnerKey);
    const categories = category ? [category] : partner.supportedCategories;

    for (const cat of categories) {
      if (!partner.supportedCategories.includes(cat)) continue;
      for (const region of partner.regions) {
        const items = await adapter.getCatalog(cat, region);
        for (const item of items) {
          const key = groupKey(partner.id, item);
          const existing = groups.get(key);
          if (existing) {
            existing.items.push(item);
          } else {
            groups.set(key, {
              partnerId: partner.id,
              partnerKey: partner.partnerKey,
              partnerName: partner.name,
              name: item.name,
              category: item.category,
              region: item.region,
              items: [item],
            });
          }
        }
      }
    }
  }

  return Array.from(groups.values());
}

// Re-fetches one specific group server-side (never trusts client-submitted
// price/variant data for an import).
export async function getCatalogGroup(
  partnerId: string,
  category: string,
  region: string,
  name: string,
): Promise<CatalogGroup | null> {
  const partner = await db.partner.findUnique({ where: { id: partnerId } });
  if (!partner || !partner.active) return null;

  const adapter = getAdapter(partner.partnerKey);
  const items = (await adapter.getCatalog(category, region)).filter((item) => item.name === name);
  if (items.length === 0) return null;

  return {
    partnerId: partner.id,
    partnerKey: partner.partnerKey,
    partnerName: partner.name,
    name,
    category,
    region,
    items,
  };
}
