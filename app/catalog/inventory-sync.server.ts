import db from "../db.server";
import { getAdapter } from "../partners/registry.server";
import { notifyMerchant } from "../notifications/notify.server";
import { logger } from "../utils/logger.server";

export interface InventorySyncSummary {
  checked: number;
  outOfStock: number;
  discontinued: number;
}

// FR-2.4/FR-2.5: pulls current availability for every imported Product from
// its partner and flags/notifies the merchant on stockouts or
// discontinuations. Invoked periodically by scripts/sync-inventory.ts (an
// external scheduler, not a long-running process -- see that file).
export async function syncInventory(): Promise<InventorySyncSummary> {
  const products = await db.product.findMany({ where: { status: { not: "DISCONTINUED" } } });
  const summary: InventorySyncSummary = { checked: 0, outOfStock: 0, discontinued: 0 };

  for (const product of products) {
    const partner = await db.partner.findUnique({ where: { id: product.partnerId } });
    if (!partner) continue;

    const adapter = getAdapter(partner.partnerKey);
    const skus = Object.values(product.variantMap as Record<string, string>);
    if (skus.length === 0) continue;

    let anyAvailable = false;
    let anyKnownToPartner = false;

    for (const sku of skus) {
      const inventory = await adapter.getInventory(sku);
      summary.checked += 1;
      if (inventory.quantity !== null) anyKnownToPartner = true;
      if (inventory.available) anyAvailable = true;
    }

    // No variant is known to the partner's catalog anymore -> discontinued.
    // Known but every variant reporting zero -> out of stock.
    const nextStatus = !anyKnownToPartner ? "DISCONTINUED" : anyAvailable ? "ACTIVE" : "OUT_OF_STOCK";
    if (nextStatus === product.status) continue;

    await db.product.update({ where: { id: product.id }, data: { status: nextStatus } });
    logger.info("inventory_sync.status_changed", { productId: product.id, from: product.status, to: nextStatus });

    if (nextStatus === "DISCONTINUED" || nextStatus === "OUT_OF_STOCK") {
      summary[nextStatus === "DISCONTINUED" ? "discontinued" : "outOfStock"] += 1;
      await notifyMerchant({
        merchantId: product.merchantId,
        type: nextStatus,
        message:
          nextStatus === "DISCONTINUED"
            ? `A partner product (SKU ${product.partnerSku}) appears to have been discontinued.`
            : `A partner product (SKU ${product.partnerSku}) is now out of stock.`,
        metadata: { productId: product.id, shopifyProductId: product.shopifyProductId },
      });
    }
  }

  return summary;
}
