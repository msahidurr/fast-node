import db from "../db.server";
import { getAdapter } from "../partners/registry.server";
import { DISPUTE_STATUSES, DISPUTE_TYPES } from "./types";

// FR-6.1: submits a reprint/replacement request to the fulfillment's partner
// via the adapter contract's submitDispute, then records it locally.
export async function fileDispute(merchantId: string, fulfillmentId: string, type: string, details: string) {
  if (!DISPUTE_TYPES.includes(type as (typeof DISPUTE_TYPES)[number])) {
    throw new Error(`Invalid dispute type "${type}"`);
  }

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
  if (!DISPUTE_STATUSES.includes(status as (typeof DISPUTE_STATUSES)[number])) {
    throw new Error(`Invalid dispute status "${status}"`);
  }

  const dispute = await db.dispute.findFirst({ where: { id: disputeId, order: { merchantId } } });
  if (!dispute) {
    throw new Error("Dispute not found");
  }

  return db.dispute.update({ where: { id: disputeId }, data: { status, resolution } });
}
