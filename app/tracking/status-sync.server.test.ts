import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.server", () => ({
  default: {
    fulfillment: { findMany: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("../partners/registry.server", () => ({
  getAdapter: vi.fn(),
}));

vi.mock("./shopify-fulfillment.server", () => ({
  pushTrackingToShopify: vi.fn(),
}));

vi.mock("../notifications/notify.server", () => ({
  notifyMerchant: vi.fn(),
}));

import db from "../db.server";
import { getAdapter } from "../partners/registry.server";
import { pushTrackingToShopify } from "./shopify-fulfillment.server";
import { notifyMerchant } from "../notifications/notify.server";
import { syncFulfillmentStatuses } from "./status-sync.server";

const mockedDb = vi.mocked(db, true);
const mockedGetAdapter = vi.mocked(getAdapter);
const mockedPushTracking = vi.mocked(pushTrackingToShopify);
const mockedNotifyMerchant = vi.mocked(notifyMerchant);

function makeFulfillment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "fulfillment_1",
    orderId: "order_1",
    status: "QUEUED",
    partnerOrderId: "MOCK-1",
    trackingNumber: null,
    carrier: null,
    createdAt: new Date(),
    slaBreachNotifiedAt: null,
    lineItems: [{ variantGid: "gid://shopify/ProductVariant/1", sku: "SKU-1", quantity: 1, title: "Item" }],
    partner: { partnerKey: "mock-rest", name: "Mock Partner", slaHours: 48 },
    order: {
      shopifyOrderId: "1001",
      merchantId: "merchant_1",
      merchant: { shop: "test.myshopify.com" },
    },
    ...overrides,
  };
}

function mockAdapter(getOrderStatus: ReturnType<typeof vi.fn>) {
  mockedGetAdapter.mockReturnValue({
    partnerKey: "mock-rest",
    getCatalog: vi.fn(),
    getInventory: vi.fn(),
    createOrder: vi.fn(),
    getOrderStatus,
    submitDispute: vi.fn(),
  } as never);
}

describe("syncFulfillmentStatuses", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does nothing when the partner reports no status change and SLA isn't breached", async () => {
    mockedDb.fulfillment.findMany.mockResolvedValue([makeFulfillment()] as never);
    mockAdapter(vi.fn().mockResolvedValue({ status: "QUEUED" }));

    const summary = await syncFulfillmentStatuses();

    expect(mockedDb.fulfillment.update).not.toHaveBeenCalled();
    expect(summary).toEqual({ checked: 1, statusChanged: 0, shipped: 0, slaBreaches: 0 });
  });

  it("updates local status on a QUEUED -> IN_PRODUCTION transition", async () => {
    mockedDb.fulfillment.findMany.mockResolvedValue([makeFulfillment()] as never);
    mockAdapter(vi.fn().mockResolvedValue({ status: "IN_PRODUCTION" }));

    await syncFulfillmentStatuses();

    expect(mockedDb.fulfillment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "IN_PRODUCTION" }) }),
    );
    expect(mockedPushTracking).not.toHaveBeenCalled();
  });

  it("pushes tracking to Shopify on a transition to SHIPPED with a tracking number", async () => {
    mockedDb.fulfillment.findMany.mockResolvedValue([makeFulfillment()] as never);
    mockAdapter(vi.fn().mockResolvedValue({ status: "SHIPPED", trackingNumber: "1Z999", carrier: "UPS" }));
    mockedPushTracking.mockResolvedValue(true);

    const summary = await syncFulfillmentStatuses();

    expect(mockedPushTracking).toHaveBeenCalledWith("test.myshopify.com", "1001", expect.any(Array), "1Z999", "UPS");
    expect(summary.shipped).toBe(1);
    expect(mockedNotifyMerchant).not.toHaveBeenCalled();
  });

  it("notifies the merchant when pushing tracking to Shopify fails", async () => {
    mockedDb.fulfillment.findMany.mockResolvedValue([makeFulfillment()] as never);
    mockAdapter(vi.fn().mockResolvedValue({ status: "SHIPPED", trackingNumber: "1Z999", carrier: "UPS" }));
    mockedPushTracking.mockResolvedValue(false);

    await syncFulfillmentStatuses();

    expect(mockedNotifyMerchant).toHaveBeenCalledOnce();
  });

  it("notifies the merchant on a partner-reported production FAILED status", async () => {
    mockedDb.fulfillment.findMany.mockResolvedValue([makeFulfillment()] as never);
    mockAdapter(vi.fn().mockResolvedValue({ status: "FAILED" }));

    await syncFulfillmentStatuses();

    expect(mockedNotifyMerchant).toHaveBeenCalledWith(
      expect.objectContaining({ type: "ROUTING_FAILURE" }),
    );
  });

  it("fires an SLA_BREACH notification once when a fulfillment is past its partner's SLA", async () => {
    const createdAt = new Date(Date.now() - 49 * 60 * 60 * 1000); // 49h ago, SLA is 48h
    mockedDb.fulfillment.findMany.mockResolvedValue([makeFulfillment({ createdAt })] as never);
    mockAdapter(vi.fn().mockResolvedValue({ status: "QUEUED" }));

    const summary = await syncFulfillmentStatuses();

    expect(mockedNotifyMerchant).toHaveBeenCalledWith(expect.objectContaining({ type: "SLA_BREACH" }));
    expect(mockedDb.fulfillment.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { slaBreachNotifiedAt: expect.any(Date) } }),
    );
    expect(summary.slaBreaches).toBe(1);
  });

  it("does not re-notify an SLA breach that was already flagged", async () => {
    const createdAt = new Date(Date.now() - 49 * 60 * 60 * 1000);
    mockedDb.fulfillment.findMany.mockResolvedValue([
      makeFulfillment({ createdAt, slaBreachNotifiedAt: new Date() }),
    ] as never);
    mockAdapter(vi.fn().mockResolvedValue({ status: "QUEUED" }));

    await syncFulfillmentStatuses();

    expect(mockedNotifyMerchant).not.toHaveBeenCalled();
  });

  it("notifies the merchant (not crashes) when pushTrackingToShopify throws", async () => {
    mockedDb.fulfillment.findMany.mockResolvedValue([makeFulfillment()] as never);
    mockAdapter(vi.fn().mockResolvedValue({ status: "SHIPPED", trackingNumber: "1Z999", carrier: "UPS" }));
    mockedPushTracking.mockRejectedValue(new Error("SessionNotFoundError"));

    await expect(syncFulfillmentStatuses()).resolves.toBeDefined();
    expect(mockedNotifyMerchant).toHaveBeenCalledOnce();
  });

  it("keeps processing later fulfillments after one throws", async () => {
    mockedDb.fulfillment.findMany.mockResolvedValue([
      makeFulfillment({ id: "fulfillment_1" }),
      makeFulfillment({ id: "fulfillment_2" }),
    ] as never);
    mockedGetAdapter
      .mockImplementationOnce(() => {
        throw new Error("adapter unavailable");
      })
      .mockImplementationOnce(
        () =>
          ({
            partnerKey: "mock-rest",
            getCatalog: vi.fn(),
            getInventory: vi.fn(),
            createOrder: vi.fn(),
            getOrderStatus: vi.fn().mockResolvedValue({ status: "IN_PRODUCTION" }),
            submitDispute: vi.fn(),
          }) as never,
      );

    const summary = await syncFulfillmentStatuses();

    expect(summary.checked).toBe(2);
    expect(summary.statusChanged).toBe(1);
  });
});
