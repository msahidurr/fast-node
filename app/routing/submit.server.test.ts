import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.server", () => ({
  default: {
    fulfillment: { findUnique: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("../partners/registry.server", () => ({
  getAdapter: vi.fn(),
}));

vi.mock("./order-status.server", () => ({
  updateOrderStatus: vi.fn(),
}));

vi.mock("../notifications/notify.server", () => ({
  notifyMerchant: vi.fn(),
}));

import db from "../db.server";
import { getAdapter } from "../partners/registry.server";
import { notifyMerchant } from "../notifications/notify.server";
import { computeBackoffMs, MAX_ATTEMPTS, submitFulfillment } from "./submit.server";

const mockedDb = vi.mocked(db, true);
const mockedGetAdapter = vi.mocked(getAdapter);
const mockedNotifyMerchant = vi.mocked(notifyMerchant);

function makeFulfillment(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: "fulfillment_1",
    orderId: "order_1",
    partnerId: "partner_1",
    status: "PENDING_SUBMISSION",
    attempts: 0,
    lineItems: [{ variantGid: "gid://shopify/ProductVariant/1", sku: "SKU-1", quantity: 1, title: "Item" }],
    order: {
      shopifyOrderId: "1001",
      merchantId: "merchant_1",
      shippingAddress: { name: "Buyer", address1: "1 St", city: "Town", countryCode: "US", zip: "00000" },
    },
    partner: { partnerKey: "mock-rest", name: "Mock Partner" },
    ...overrides,
  };
}

function mockAdapter(createOrder: ReturnType<typeof vi.fn>) {
  mockedGetAdapter.mockReturnValue({
    partnerKey: "mock-rest",
    getCatalog: vi.fn(),
    getInventory: vi.fn(),
    createOrder,
    getOrderStatus: vi.fn(),
    submitDispute: vi.fn(),
  } as never);
}

describe("computeBackoffMs", () => {
  it("doubles with each attempt and caps the exponent", () => {
    expect(computeBackoffMs(1)).toBe(60_000);
    expect(computeBackoffMs(100)).toBe(computeBackoffMs(8));
  });
});

describe("submitFulfillment", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks the fulfillment QUEUED with the partner order id on success", async () => {
    mockedDb.fulfillment.findUnique.mockResolvedValue(makeFulfillment() as never);
    mockAdapter(vi.fn().mockResolvedValue({ partnerOrderId: "MOCK-1" }));

    await submitFulfillment("fulfillment_1");

    expect(mockedDb.fulfillment.update).toHaveBeenCalledWith({
      where: { id: "fulfillment_1" },
      data: { status: "QUEUED", partnerOrderId: "MOCK-1", lastError: null },
    });
  });

  it("marks the fulfillment FAILED with an incremented attempt count on error", async () => {
    mockedDb.fulfillment.findUnique.mockResolvedValue(makeFulfillment({ attempts: 1 }) as never);
    mockAdapter(vi.fn().mockRejectedValue(new Error("partner API down")));

    await submitFulfillment("fulfillment_1");

    const call = mockedDb.fulfillment.update.mock.calls.at(-1)?.[0] as {
      data: { status: string; attempts: number; lastError: string };
    };
    expect(call.data.status).toBe("FAILED");
    expect(call.data.attempts).toBe(2);
    expect(call.data.lastError).toBe("partner API down");
  });

  it("notifies the merchant once attempts are exhausted", async () => {
    mockedDb.fulfillment.findUnique.mockResolvedValue(makeFulfillment({ attempts: MAX_ATTEMPTS - 1 }) as never);
    mockAdapter(vi.fn().mockRejectedValue(new Error("still down")));

    await submitFulfillment("fulfillment_1");

    expect(mockedNotifyMerchant).toHaveBeenCalledOnce();
  });

  it("does not notify before attempts are exhausted", async () => {
    mockedDb.fulfillment.findUnique.mockResolvedValue(makeFulfillment({ attempts: 0 }) as never);
    mockAdapter(vi.fn().mockRejectedValue(new Error("down")));

    await submitFulfillment("fulfillment_1");

    expect(mockedNotifyMerchant).not.toHaveBeenCalled();
  });

  it("fails without calling the adapter when the order has no shipping address", async () => {
    const createOrder = vi.fn();
    mockedDb.fulfillment.findUnique.mockResolvedValue(
      makeFulfillment({ order: { shopifyOrderId: "1001", merchantId: "merchant_1", shippingAddress: null } }) as never,
    );
    mockAdapter(createOrder);

    await submitFulfillment("fulfillment_1");

    expect(createOrder).not.toHaveBeenCalled();
    const call = mockedDb.fulfillment.update.mock.calls.at(-1)?.[0] as { data: { status: string; lastError: string } };
    expect(call.data.status).toBe("FAILED");
    expect(call.data.lastError).toMatch(/shipping address/i);
  });

  it("is a no-op for a fulfillment that already exhausted its retries", async () => {
    mockedDb.fulfillment.findUnique.mockResolvedValue(makeFulfillment({ status: "FAILED", attempts: MAX_ATTEMPTS }) as never);
    const createOrder = vi.fn();
    mockAdapter(createOrder);

    await submitFulfillment("fulfillment_1");

    expect(createOrder).not.toHaveBeenCalled();
    expect(mockedDb.fulfillment.update).not.toHaveBeenCalled();
  });

  it("is a no-op for a fulfillment that's already QUEUED", async () => {
    mockedDb.fulfillment.findUnique.mockResolvedValue(makeFulfillment({ status: "QUEUED" }) as never);
    const createOrder = vi.fn();
    mockAdapter(createOrder);

    await submitFulfillment("fulfillment_1");

    expect(createOrder).not.toHaveBeenCalled();
  });
});
