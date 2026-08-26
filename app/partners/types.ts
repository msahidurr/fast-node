export interface CatalogItemVariant {
  option: string;
  value: string;
}

export interface CatalogItem {
  sku: string;
  name: string;
  category: string;
  region: string;
  basePrice: number;
  variants: CatalogItemVariant[];
}

export interface InventoryStatus {
  sku: string;
  available: boolean;
  quantity: number | null;
}

export interface OrderLineItemPayload {
  sku: string;
  quantity: number;
  artworkUrl?: string;
}

export interface ShippingAddress {
  name: string;
  address1: string;
  address2?: string;
  city: string;
  provinceCode?: string;
  countryCode: string;
  zip: string;
}

export interface CreateOrderPayload {
  shopifyOrderId: string;
  lineItems: OrderLineItemPayload[];
  shippingAddress: ShippingAddress;
}

export interface CreateOrderResult {
  partnerOrderId: string;
}

export type PartnerOrderStatus = "QUEUED" | "IN_PRODUCTION" | "SHIPPED" | "FAILED";

export interface OrderStatusResult {
  status: PartnerOrderStatus;
  trackingNumber?: string;
  carrier?: string;
}

export interface DisputeResult {
  partnerDisputeId: string;
  status: string;
}

// Section 7.2 adapter contract. Every fulfillment partner integration -- REST,
// GraphQL, or CSV/SFTP -- must satisfy this interface so the routing/order core
// can treat all partners identically without knowing which concrete adapter
// backs any given one (NFR-8).
export interface PartnerAdapter {
  readonly partnerKey: string;
  getCatalog(category: string, region: string): Promise<CatalogItem[]>;
  getInventory(sku: string): Promise<InventoryStatus>;
  createOrder(payload: CreateOrderPayload): Promise<CreateOrderResult>;
  getOrderStatus(partnerOrderId: string): Promise<OrderStatusResult>;
  submitDispute(orderId: string, type: string, details: string): Promise<DisputeResult>;
}
