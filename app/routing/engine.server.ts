import type { Prisma, Product } from "@prisma/client";
import db from "../db.server";
import { getAdapter } from "../partners/registry.server";
import { rulesBasedStrategy } from "./strategies/rules-based.strategy";
import type { OrderLineItemSnapshot, RoutingCandidate } from "./types";
import { submitFulfillment } from "./submit.server";
import { updateOrderStatus } from "./order-status.server";
import { notifyMerchant } from "../notifications/notify.server";
import { logger } from "../utils/logger.server";

export interface RouteOrderResult {
  groupsRouted: number;
  groupsFailed: number;
}

// FR-4.1: routes a freshly-ingested Order. Line items are grouped by the
// partner their bound Product belongs to (FR-4.4's split-fulfillment grouping
// falls straight out of this), each group is scored against its (currently
// single -- see types.ts) candidate partner, and a RoutingDecision +
// Fulfillment are persisted per group. Submission (FR-4.3) is kicked off
// immediately for anything successfully routed.
//
// Safe to call more than once for the same order (NFR-3/NFR-6): a group that
// already has a Fulfillment is skipped, so re-running this on an order stuck
// in ROUTING_FAILED/PARTIALLY_SUBMITTED -- e.g. from
// scripts/retry-routing-failures.ts after a partner outage clears -- only
// (re)attempts the groups that never made it through.
export async function routeOrder(orderId: string): Promise<RouteOrderResult> {
  const start = Date.now();
  const order = await db.order.findUniqueOrThrow({ where: { id: orderId } });
  const lineItems = order.lineItems as unknown as OrderLineItemSnapshot[];

  const products = await db.product.findMany({
    where: { merchantId: order.merchantId },
    include: { partner: true },
  });
  const productByVariantGid = new Map<string, (typeof products)[number]>();
  for (const product of products) {
    for (const variantGid of Object.keys(product.variantMap as Record<string, string>)) {
      productByVariantGid.set(variantGid, product);
    }
  }

  const groups = new Map<string, { product: Product & { partner: (typeof products)[number]["partner"] }; items: OrderLineItemSnapshot[] }>();
  for (const item of lineItems) {
    const product = productByVariantGid.get(item.variantGid);
    if (!product) continue; // not one of our imported products -- nothing to route
    const existing = groups.get(product.partnerId);
    if (existing) existing.items.push(item);
    else groups.set(product.partnerId, { product, items: [item] });
  }

  const existingFulfillments = await db.fulfillment.findMany({
    where: { orderId: order.id },
    select: { partnerId: true },
  });
  const alreadyRoutedPartnerIds = new Set(existingFulfillments.map((f) => f.partnerId));

  let groupsRouted = 0;
  let groupsFailed = 0;

  for (const { product, items } of groups.values()) {
    if (alreadyRoutedPartnerIds.has(product.partnerId)) continue; // already routed on a prior call

    const partner = product.partner;
    const adapter = getAdapter(partner.partnerKey);
    const sku = items[0].sku;

    // A partner outage (NFR-3) can surface as this call rejecting, not just
    // as an "unavailable" response -- treat both the same way: a routing
    // failure that's durably recorded (NFR-6) and safe to retry later,
    // rather than an uncaught exception that aborts the whole order (and
    // every other group in it) with nothing written down.
    let inventoryAvailable: boolean;
    let partnerUnavailable = false;
    try {
      inventoryAvailable = (await adapter.getInventory(sku)).available;
    } catch (error) {
      inventoryAvailable = false;
      partnerUnavailable = true;
      logger.error("routing.partner_unavailable", {
        orderId: order.id,
        partnerId: partner.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const candidate: RoutingCandidate = {
      partnerId: partner.id,
      sku,
      available: inventoryAvailable,
      slaHours: partner.slaHours,
      costEstimate: Number(product.baseCost) + Number(partner.shippingEstimate),
      regionSupported: !order.shippingCountryCode || partner.regions.includes(order.shippingCountryCode),
    };

    const decision = partnerUnavailable
      ? { selectedPartnerId: null, reasonCode: "PARTNER_UNAVAILABLE", costEstimate: null, slaEstimateHours: null }
      : rulesBasedStrategy.select([candidate]);

    const routingDecision = await db.routingDecision.create({
      data: {
        orderId: order.id,
        partnerId: decision.selectedPartnerId,
        lineItems: items as unknown as Prisma.InputJsonValue,
        reasonCode: decision.reasonCode,
        costEstimate: decision.costEstimate,
        slaEstimateHours: decision.slaEstimateHours,
      },
    });

    if (!decision.selectedPartnerId) {
      groupsFailed += 1;
      await notifyMerchant({
        merchantId: order.merchantId,
        type: "ROUTING_FAILURE",
        message: `Order ${order.shopifyOrderId}: couldn't route ${items.length} item(s) via ${partner.name} (${decision.reasonCode}).`,
        metadata: { orderId: order.id, routingDecisionId: routingDecision.id } as Prisma.InputJsonValue,
      });
      continue;
    }

    groupsRouted += 1;
    const fulfillment = await db.fulfillment.create({
      data: {
        orderId: order.id,
        partnerId: decision.selectedPartnerId,
        routingDecisionId: routingDecision.id,
        lineItems: items as unknown as Prisma.InputJsonValue,
      },
    });

    await submitFulfillment(fulfillment.id);
  }

  await updateOrderStatus(order.id);

  logger.info("routing.decision_complete", {
    orderId: order.id,
    groupsRouted,
    groupsFailed,
    durationMs: Date.now() - start,
  });

  return { groupsRouted, groupsFailed };
}
