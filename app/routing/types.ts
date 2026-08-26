// A line item snapshot as stored on Order.lineItems and RoutingDecision/
// Fulfillment.lineItems -- enriched at ingest time (see
// app/webhooks/handlers.server.ts#handleOrderCreate) with the partner SKU and
// mockup artwork it resolved to, so nothing downstream has to re-derive them.
export interface OrderLineItemSnapshot {
  variantGid: string;
  sku: string;
  quantity: number;
  title: string;
  artworkUrl?: string;
}

// One partner the routing engine could send a shipment-group to. Today a
// SKU is bound to exactly one partner at import time (see Phase 4 flags), so
// there's only ever one candidate per group -- but the strategy interface
// below takes an array so a future "same SKU available from N partners"
// catalog model can plug in without changing the engine or strategy shape
// (the SRS's own risk mitigation: start rules-based, add scoring/ML later).
export interface RoutingCandidate {
  partnerId: string;
  sku: string;
  available: boolean;
  slaHours: number;
  costEstimate: number;
  regionSupported: boolean;
}

export interface RoutingResult {
  selectedPartnerId: string | null;
  reasonCode: string;
  costEstimate: number | null;
  slaEstimateHours: number | null;
}

export interface RoutingStrategy {
  readonly name: string;
  select(candidates: RoutingCandidate[]): RoutingResult;
}
