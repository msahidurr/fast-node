import type { Prisma } from "@prisma/client";
import db from "../db.server";
import { getAdapter } from "../partners/registry.server";
import type { ShippingAddress } from "../partners/types";
import type { OrderLineItemSnapshot } from "./types";
import { logger } from "../utils/logger.server";
import { updateOrderStatus } from "./order-status.server";
import { notifyMerchant } from "../notifications/notify.server";

export const MAX_ATTEMPTS = 6;
const BASE_DELAY_MS = 30_000; // 30s, doubling each attempt -- same shape as the webhook queue

export function computeBackoffMs(attempts: number): number {
  const exponent = Math.min(attempts, 8);
  return BASE_DELAY_MS * 2 ** exponent;
}

// FR-4.3: transmits one shipment-group (order + design/artwork data) to its
// partner. FR-4.5: retries with exponential backoff on failure, notifying the
// merchant once attempts are exhausted -- our own queue, not Shopify's, owns
// the retry (see app/webhooks/process.server.ts for the identical rationale).
export async function submitFulfillment(fulfillmentId: string): Promise<void> {
  const fulfillment = await db.fulfillment.findUnique({
    where: { id: fulfillmentId },
    include: { order: true, partner: true },
  });
  if (!fulfillment) return;
  if (fulfillment.status !== "PENDING_SUBMISSION" && fulfillment.status !== "FAILED") return;
  // Exhausted retries stay FAILED permanently (the merchant was already
  // notified) -- a manual override (app.orders.$id.tsx) resets attempts to 0
  // to try again deliberately.
  if (fulfillment.attempts >= MAX_ATTEMPTS) return;

  const adapter = getAdapter(fulfillment.partner.partnerKey);
  const lineItems = fulfillment.lineItems as unknown as OrderLineItemSnapshot[];
  const shippingAddress = (fulfillment.order.shippingAddress ?? undefined) as ShippingAddress | undefined;

  try {
    if (!shippingAddress) {
      throw new Error("Order has no shipping address");
    }

    const result = await adapter.createOrder({
      shopifyOrderId: fulfillment.order.shopifyOrderId,
      lineItems: lineItems.map((item) => ({ sku: item.sku, quantity: item.quantity, artworkUrl: item.artworkUrl })),
      shippingAddress,
    });

    await db.fulfillment.update({
      where: { id: fulfillmentId },
      data: { status: "QUEUED", partnerOrderId: result.partnerOrderId, lastError: null },
    });
    logger.info("fulfillment.submitted", {
      fulfillmentId,
      orderId: fulfillment.orderId,
      correlationId: fulfillment.order.correlationId,
      partnerOrderId: result.partnerOrderId,
    });
  } catch (error) {
    const attempts = fulfillment.attempts + 1;
    const lastError = error instanceof Error ? error.message : String(error);
    const exhausted = attempts >= MAX_ATTEMPTS;

    await db.fulfillment.update({
      where: { id: fulfillmentId },
      data: {
        status: "FAILED",
        attempts,
        lastError,
        nextAttemptAt: new Date(Date.now() + computeBackoffMs(attempts)),
      },
    });
    logger.error("fulfillment.submit_failed", {
      fulfillmentId,
      orderId: fulfillment.orderId,
      correlationId: fulfillment.order.correlationId,
      attempts,
      exhausted,
      lastError,
    });

    if (exhausted) {
      await notifyMerchant({
        merchantId: fulfillment.order.merchantId,
        type: "ROUTING_FAILURE",
        message: `Submitting order ${fulfillment.order.shopifyOrderId} to ${fulfillment.partner.name} failed ${attempts} times and will not retry automatically: ${lastError}`,
        metadata: { fulfillmentId } as Prisma.InputJsonValue,
      });
    }
  }

  await updateOrderStatus(fulfillment.orderId);
}
