import db from "../db.server";
import { getAdapter } from "../partners/registry.server";

// FR-6.1: submits a reprint/replacement request to the fulfillment's partner
// via the adapter contract's submitDispute, then records it locally.
export async function fileDispute(merchantId: string, fulfillmentId: string, type: string, details: string) {
  const fulfillment = await db.fulfillment.findFirst({
    where: { id: fulfillmentId, order: { merchantId } },
    include: { partner: true },
  });
  if (!fulfillment) {
    throw new Error("Fulfillment not found");
  }

  const adapter = getAdapter(fulfillment.partner.partnerKey);
  const result = await adapter.submitDispute(fulfillment.orderId, type, details);

  return db.dispute.create({
    data: {
      orderId: fulfillment.orderId,
      fulfillmentId: fulfillment.id,
      type,
      details,
      partnerDisputeId: result.partnerDisputeId,
      status: "OPEN",
    },
  });
}

// FR-6.2: the adapter contract (Section 7.2) has no dispute-status-polling
// method -- only submitDispute -- so resolution is merchant-recorded after
// they hear back from the partner out of band, not auto-synced.
export async function resolveDispute(merchantId: string, disputeId: string, status: string, resolution: string) {
  const dispute = await db.dispute.findFirst({ where: { id: disputeId, order: { merchantId } } });
  if (!dispute) {
    throw new Error("Dispute not found");
  }

  return db.dispute.update({ where: { id: disputeId }, data: { status, resolution } });
}
