import { randomUUID } from "node:crypto";
import { logger } from "../../utils/logger.server";
import type {
  CatalogItem,
  CreateOrderPayload,
  CreateOrderResult,
  DisputeResult,
  InventoryStatus,
  OrderStatusResult,
  PartnerAdapter,
} from "../types";

const CATALOG: CatalogItem[] = [
  {
    sku: "LTH-WALLET-BRN",
    name: "Leather Bifold Wallet",
    category: "leather-goods",
    region: "US",
    basePrice: 18.5,
    variants: [{ option: "Color", value: "Brown" }],
  },
  {
    sku: "LTH-WALLET-BLK",
    name: "Leather Bifold Wallet",
    category: "leather-goods",
    region: "US",
    basePrice: 18.5,
    variants: [{ option: "Color", value: "Black" }],
  },
  {
    sku: "ECO-MAILER-M",
    name: "Compostable Mailer Bag (M)",
    category: "eco-packaging",
    region: "EU",
    basePrice: 0.42,
    variants: [{ option: "Size", value: "Medium" }],
  },
];

const INVENTORY: Record<string, number> = {
  "LTH-WALLET-BRN": 120,
  "LTH-WALLET-BLK": 0,
  "ECO-MAILER-M": 5000,
};

const ORDERS = new Map<string, { createdAt: number }>();

// How long a mock order stays in each stage before "advancing" -- short enough
// to actually exercise Phase 5's status-polling/tracking pipeline (FR-5.1/
// FR-5.2) against this sandbox within a dev session, unlike a partner that
// never changes state on its own.
const IN_PRODUCTION_AFTER_MS = 15_000;
const SHIPPED_AFTER_MS = 30_000;

// Reference adapter for a sandbox partner that exposes a real REST/GraphQL API.
// Stands in for the HTTP calls a live partner integration would make -- swap
// each method body for a fetch() against the partner's endpoints when
// onboarding one for real. Nothing outside app/partners/ needs to change to add
// this (or any other) adapter (NFR-8) -- see registry.server.ts.
export const mockRestAdapter: PartnerAdapter = {
  partnerKey: "mock-rest",

  async getCatalog(category: string, region: string): Promise<CatalogItem[]> {
    return CATALOG.filter((item) => item.category === category && item.region === region);
  },

  async getInventory(sku: string): Promise<InventoryStatus> {
    const quantity = INVENTORY[sku];
    return { sku, available: (quantity ?? 0) > 0, quantity: quantity ?? null };
  },

  async createOrder(payload: CreateOrderPayload): Promise<CreateOrderResult> {
    const partnerOrderId = `MOCK-${randomUUID()}`;
    ORDERS.set(partnerOrderId, { createdAt: Date.now() });
    logger.info("mock_rest_adapter.order_created", {
      partnerOrderId,
      shopifyOrderId: payload.shopifyOrderId,
      lineItemCount: payload.lineItems.length,
    });
    return { partnerOrderId };
  },

  async getOrderStatus(partnerOrderId: string): Promise<OrderStatusResult> {
    const record = ORDERS.get(partnerOrderId);
    if (!record) {
      throw new Error(`Unknown mock-rest partner order id: ${partnerOrderId}`);
    }

    const elapsedMs = Date.now() - record.createdAt;
    if (elapsedMs >= SHIPPED_AFTER_MS) {
      return { status: "SHIPPED", trackingNumber: `MOCKTRACK-${partnerOrderId.slice(5, 13)}`, carrier: "Mock Post" };
    }
    if (elapsedMs >= IN_PRODUCTION_AFTER_MS) {
      return { status: "IN_PRODUCTION" };
    }
    return { status: "QUEUED" };
  },

  async submitDispute(orderId: string, type: string, details: string): Promise<DisputeResult> {
    logger.info("mock_rest_adapter.dispute_submitted", { orderId, type, details });
    return { partnerDisputeId: `MOCK-DSP-${orderId}-${type}`, status: "OPEN" };
  },
};
