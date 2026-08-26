import db from "../db.server";
import { getAdapter } from "../partners/registry.server";
import { pushTrackingToShopify } from "./shopify-fulfillment.server";
import { notifyMerchant } from "../notifications/notify.server";
import type { OrderLineItemSnapshot } from "../routing/types";
import { logger } from "../utils/logger.server";

export interface StatusSyncSummary {
  checked: number;
  statusChanged: number;
  shipped: number;
  slaBreaches: number;
}

const IN_FLIGHT_STATUSES = ["QUEUED", "IN_PRODUCTION"];

// FR-5.1/FR-5.2: polls each in-flight Fulfillment's partner for production
// status (there's no inventory-webhook-style push in the adapter contract --
// see Phase 2's flag on the same gap for stock). A transition to SHIPPED
// pushes tracking to Shopify, which posts to the order timeline and triggers
// the native customer email. Anything still in flight past the partner's SLA
// fires an SLA_BREACH notification once (FR-8.1). Invoked periodically by
// scripts/sync-fulfillment-status.ts, same external-scheduler shape as every
// other worker in this app.
export async function syncFulfillmentStatuses(): Promise<StatusSyncSummary> {
  const fulfillments = await db.fulfillment.findMany({
    where: { status: { in: IN_FLIGHT_STATUSES }, partnerOrderId: { not: null } },
    include: { partner: true, order: { include: { merchant: true } } },
  });

  const summary: StatusSyncSummary = { checked: 0, statusChanged: 0, shipped: 0, slaBreaches: 0 };

  for (const fulfillment of fulfillments) {
    summary.checked += 1;

    // One fulfillment's partner/Shopify call failing (e.g. no offline session
    // yet for that shop, or the partner API erroring) shouldn't abort the
    // rest of the batch -- log and move on to the next one.
    try {
      const adapter = getAdapter(fulfillment.partner.partnerKey);
      const result = await adapter.getOrderStatus(fulfillment.partnerOrderId as string);

      if (result.status !== fulfillment.status) {
        summary.statusChanged += 1;
        await db.fulfillment.update({
          where: { id: fulfillment.id },
          data: {
            status: result.status,
            trackingNumber: result.trackingNumber ?? fulfillment.trackingNumber,
            carrier: result.carrier ?? fulfillment.carrier,
            shippedAt: result.status === "SHIPPED" ? new Date() : fulfillment.shippedAt,
          },
        });
        logger.info("fulfillment_status.changed", {
          fulfillmentId: fulfillment.id,
          orderId: fulfillment.orderId,
          correlationId: fulfillment.order.correlationId,
          from: fulfillment.status,
          to: result.status,
        });

        if (result.status === "SHIPPED") {
          summary.shipped += 1;
          if (result.trackingNumber) {
            const lineItems = fulfillment.lineItems as unknown as OrderLineItemSnapshot[];
            const pushed = await pushTrackingToShopify(
              fulfillment.order.merchant.shop,
              fulfillment.order.shopifyOrderId,
              lineItems,
              result.trackingNumber,
              result.carrier,
            ).catch((error) => {
              logger.error("shopify_fulfillment.push_threw", {
                fulfillmentId: fulfillment.id,
                orderId: fulfillment.orderId,
                correlationId: fulfillment.order.correlationId,
                error: error instanceof Error ? error.message : String(error),
              });
              return false;
            });
            if (!pushed) {
              await notifyMerchant({
                merchantId: fulfillment.order.merchantId,
                type: "ROUTING_FAILURE",
                message: `Order ${fulfillment.order.shopifyOrderId} shipped from ${fulfillment.partner.name}, but writing tracking back to Shopify failed -- check it manually.`,
                metadata: { fulfillmentId: fulfillment.id },
              });
            }
          }
        } else if (result.status === "FAILED") {
          // A partner-reported production failure, distinct from a submission
          // failure (which lives in attempts/nextAttemptAt) -- left untouched
          // here since retrying a production failure isn't this app's call.
          await notifyMerchant({
            merchantId: fulfillment.order.merchantId,
            type: "ROUTING_FAILURE",
            message: `${fulfillment.partner.name} reported a production failure for order ${fulfillment.order.shopifyOrderId}.`,
            metadata: { fulfillmentId: fulfillment.id },
          });
        }
      }

      const slaDeadline = new Date(fulfillment.createdAt.getTime() + fulfillment.partner.slaHours * 60 * 60 * 1000);
      if (!fulfillment.slaBreachNotifiedAt && result.status !== "SHIPPED" && new Date() > slaDeadline) {
        summary.slaBreaches += 1;
        await notifyMerchant({
          merchantId: fulfillment.order.merchantId,
          type: "SLA_BREACH",
          message: `Order ${fulfillment.order.shopifyOrderId} has been with ${fulfillment.partner.name} past its ${fulfillment.partner.slaHours}h SLA.`,
          metadata: { fulfillmentId: fulfillment.id },
        });
        await db.fulfillment.update({ where: { id: fulfillment.id }, data: { slaBreachNotifiedAt: new Date() } });
      }
    } catch (error) {
      logger.error("fulfillment_status.sync_failed", {
        fulfillmentId: fulfillment.id,
        orderId: fulfillment.orderId,
        correlationId: fulfillment.order.correlationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return summary;
}
