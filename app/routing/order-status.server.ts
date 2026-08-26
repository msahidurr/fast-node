import db from "../db.server";

const SUBMITTED_STATUSES = new Set(["QUEUED", "IN_PRODUCTION", "SHIPPED", "DELIVERED"]);

// Rolls up an Order's overall status from its Fulfillments. Called after
// routing and after every submission attempt (including retries), so it
// reflects the current state even as FAILED fulfillments get retried later.
export async function updateOrderStatus(orderId: string): Promise<void> {
  const [order, fulfillments] = await Promise.all([
    db.order.findUnique({ where: { id: orderId } }),
    db.fulfillment.findMany({ where: { orderId } }),
  ]);
  if (!order) return;

  const lineItemCount = (order.lineItems as unknown[]).length;
  const routedItemCount = fulfillments.reduce(
    (sum, fulfillment) => sum + (fulfillment.lineItems as unknown[]).length,
    0,
  );

  let status: string;
  if (fulfillments.length === 0) {
    status = "ROUTING_FAILED";
  } else if (routedItemCount >= lineItemCount && fulfillments.every((f) => SUBMITTED_STATUSES.has(f.status))) {
    status = "SUBMITTED";
  } else {
    status = "PARTIALLY_SUBMITTED";
  }

  if (status !== order.status) {
    await db.order.update({ where: { id: orderId }, data: { status } });
  }
}
