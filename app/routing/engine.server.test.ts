import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.server", () => ({
  default: {
    order: { findUniqueOrThrow: vi.fn() },
    product: { findMany: vi.fn() },
    routingDecision: { create: vi.fn() },
    fulfillment: { create: vi.fn(), findMany: vi.fn() },
  },
}));

vi.mock("../partners/registry.server", () => ({
  getAdapter: vi.fn(),
}));

vi.mock("./submit.server", () => ({
  submitFulfillment: vi.fn(),
}));

vi.mock("./order-status.server", () => ({
  updateOrderStatus: vi.fn(),
}));

vi.mock("../notifications/notify.server", () => ({
  notifyMerchant: vi.fn(),
}));

import db from "../db.server";
import { getAdapter } from "../partners/registry.server";
import { submitFulfillment } from "./submit.server";
import { updateOrderStatus } from "./order-status.server";
import { notifyMerchant } from "../notifications/notify.server";
import { routeOrder } from "./engine.server";

const mockedDb = vi.mocked(db, true);
const mockedGetAdapter = vi.mocked(getAdapter);
const mockedSubmitFulfillment = vi.mocked(submitFulfillment);
const mockedUpdateOrderStatus = vi.mocked(updateOrderStatus);
const mockedNotifyMerchant = vi.mocked(notifyMerchant);

const PARTNER_A = { id: "partner_a", partnerKey: "mock-rest", name: "Partner A", slaHours: 48, shippingEstimate: 5, regions: ["US"] };
const PARTNER_B = { id: "partner_b", partnerKey: "csv-sftp", name: "Partner B", slaHours: 72, shippingEstimate: 6, regions: ["US"] };

function makeOrder(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "order_1",
    merchantId: "merchant_1",
    shopifyOrderId: "1001",
    shippingCountryCode: "US",
    lineItems: [
      { variantGid: "gid://shopify/ProductVariant/1", sku: "SKU-A", quantity: 1, title: "Item A" },
      { variantGid: "gid://shopify/ProductVariant/2", sku: "SKU-B", quantity: 2, title: "Item B" },
      { variantGid: "gid://shopify/ProductVariant/999", sku: "SKU-UNKNOWN", quantity: 1, title: "Not ours" },
    ],
    ...overrides,
  };
}

function adapterReturning(available: boolean) {
  return {
    partnerKey: "mock",
    getCatalog: vi.fn(),
    getInventory: vi.fn().mockResolvedValue({ sku: "x", available, quantity: available ? 5 : 0 }),
    createOrder: vi.fn(),
    getOrderStatus: vi.fn(),
    submitDispute: vi.fn(),
  };
}

describe("routeOrder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedDb.routingDecision.create.mockResolvedValue({ id: "decision_x" } as never);
    mockedDb.fulfillment.create.mockResolvedValue({ id: "fulfillment_x" } as never);
    mockedDb.fulfillment.findMany.mockResolvedValue([]);
  });

  it("groups line items by their product's partner, creates a RoutingDecision + Fulfillment per group, and submits each", async () => {
    mockedDb.order.findUniqueOrThrow.mockResolvedValue(makeOrder() as never);
    mockedDb.product.findMany.mockResolvedValue([
      { id: "product_a", partnerId: "partner_a", partner: PARTNER_A, baseCost: 10, variantMap: { "gid://shopify/ProductVariant/1": "SKU-A" } },
      { id: "product_b", partnerId: "partner_b", partner: PARTNER_B, baseCost: 12, variantMap: { "gid://shopify/ProductVariant/2": "SKU-B" } },
    ] as never);
    mockedGetAdapter.mockImplementation(() => adapterReturning(true) as never);

    const result = await routeOrder("order_1");

    expect(result).toEqual({ groupsRouted: 2, groupsFailed: 0 });
    expect(mockedDb.routingDecision.create).toHaveBeenCalledTimes(2);
    expect(mockedDb.fulfillment.create).toHaveBeenCalledTimes(2);
    expect(mockedSubmitFulfillment).toHaveBeenCalledTimes(2);
    expect(mockedUpdateOrderStatus).toHaveBeenCalledWith("order_1");

    // The unmatched line item (not in our catalog) shouldn't appear in any group.
    const allRoutedItems = mockedDb.fulfillment.create.mock.calls.flatMap(
      (call) => (call[0] as unknown as { data: { lineItems: Array<{ sku: string }> } }).data.lineItems,
    );
    expect(allRoutedItems.map((item) => item.sku).sort()).toEqual(["SKU-A", "SKU-B"]);
  });

  it("records a routing failure and notifies the merchant when the partner is out of stock, without creating a Fulfillment", async () => {
    mockedDb.order.findUniqueOrThrow.mockResolvedValue(
      makeOrder({
        lineItems: [{ variantGid: "gid://shopify/ProductVariant/1", sku: "SKU-A", quantity: 1, title: "Item A" }],
      }) as never,
    );
    mockedDb.product.findMany.mockResolvedValue([
      { id: "product_a", partnerId: "partner_a", partner: PARTNER_A, baseCost: 10, variantMap: { "gid://shopify/ProductVariant/1": "SKU-A" } },
    ] as never);
    mockedGetAdapter.mockImplementation(() => adapterReturning(false) as never);

    const result = await routeOrder("order_1");

    expect(result).toEqual({ groupsRouted: 0, groupsFailed: 1 });
    expect(mockedDb.fulfillment.create).not.toHaveBeenCalled();
    expect(mockedSubmitFulfillment).not.toHaveBeenCalled();
    expect(mockedNotifyMerchant).toHaveBeenCalledOnce();
  });

  it("does nothing when no line items match this merchant's imported catalog", async () => {
    mockedDb.order.findUniqueOrThrow.mockResolvedValue(
      makeOrder({ lineItems: [{ variantGid: "gid://shopify/ProductVariant/999", sku: "SKU-UNKNOWN", quantity: 1, title: "Not ours" }] }) as never,
    );
    mockedDb.product.findMany.mockResolvedValue([] as never);

    const result = await routeOrder("order_1");

    expect(result).toEqual({ groupsRouted: 0, groupsFailed: 0 });
    expect(mockedDb.routingDecision.create).not.toHaveBeenCalled();
  });

  it("records a PARTNER_UNAVAILABLE routing failure -- and doesn't crash -- when the adapter itself throws (NFR-3/NFR-6)", async () => {
    mockedDb.order.findUniqueOrThrow.mockResolvedValue(
      makeOrder({
        lineItems: [{ variantGid: "gid://shopify/ProductVariant/1", sku: "SKU-A", quantity: 1, title: "Item A" }],
      }) as never,
    );
    mockedDb.product.findMany.mockResolvedValue([
      { id: "product_a", partnerId: "partner_a", partner: PARTNER_A, baseCost: 10, variantMap: { "gid://shopify/ProductVariant/1": "SKU-A" } },
    ] as never);
    mockedGetAdapter.mockReturnValue({
      partnerKey: "mock-rest",
      getCatalog: vi.fn(),
      getInventory: vi.fn().mockRejectedValue(new Error("simulated partner outage")),
      createOrder: vi.fn(),
      getOrderStatus: vi.fn(),
      submitDispute: vi.fn(),
    } as never);

    const result = await routeOrder("order_1");

    expect(result).toEqual({ groupsRouted: 0, groupsFailed: 1 });
    expect(mockedDb.routingDecision.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ reasonCode: "PARTNER_UNAVAILABLE", partnerId: null }) }),
    );
    expect(mockedNotifyMerchant).toHaveBeenCalledOnce();
    expect(mockedDb.fulfillment.create).not.toHaveBeenCalled();
  });

  it("skips a group that already has a Fulfillment, so re-calling routeOrder on a retry is safe", async () => {
    mockedDb.order.findUniqueOrThrow.mockResolvedValue(
      makeOrder({
        lineItems: [
          { variantGid: "gid://shopify/ProductVariant/1", sku: "SKU-A", quantity: 1, title: "Item A" },
          { variantGid: "gid://shopify/ProductVariant/2", sku: "SKU-B", quantity: 2, title: "Item B" },
        ],
      }) as never,
    );
    mockedDb.product.findMany.mockResolvedValue([
      { id: "product_a", partnerId: "partner_a", partner: PARTNER_A, baseCost: 10, variantMap: { "gid://shopify/ProductVariant/1": "SKU-A" } },
      { id: "product_b", partnerId: "partner_b", partner: PARTNER_B, baseCost: 12, variantMap: { "gid://shopify/ProductVariant/2": "SKU-B" } },
    ] as never);
    // partner_a already has a Fulfillment from a prior call -- only partner_b should be (re)routed.
    mockedDb.fulfillment.findMany.mockResolvedValue([{ partnerId: "partner_a" }] as never);
    mockedGetAdapter.mockImplementation(() => adapterReturning(true) as never);

    const result = await routeOrder("order_1");

    expect(result).toEqual({ groupsRouted: 1, groupsFailed: 0 });
    expect(mockedDb.routingDecision.create).toHaveBeenCalledTimes(1);
    expect(mockedDb.fulfillment.create).toHaveBeenCalledTimes(1);
    expect(mockedDb.fulfillment.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ partnerId: "partner_b" }) }),
    );
  });
});
