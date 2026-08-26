import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.server", () => ({
  default: {
    product: { findMany: vi.fn(), update: vi.fn() },
    partner: { findUnique: vi.fn() },
  },
}));

vi.mock("../partners/registry.server", () => ({
  getAdapter: vi.fn(),
}));

vi.mock("../notifications/notify.server", () => ({
  notifyMerchant: vi.fn(),
}));

import db from "../db.server";
import { getAdapter } from "../partners/registry.server";
import { notifyMerchant } from "../notifications/notify.server";
import { syncInventory } from "./inventory-sync.server";

const mockedDb = vi.mocked(db, true);
const mockedGetAdapter = vi.mocked(getAdapter);
const mockedNotifyMerchant = vi.mocked(notifyMerchant);

const PARTNER = { id: "partner_1", partnerKey: "mock-rest" };

function makeProduct(overrides: Partial<{ id: string; status: string; variantMap: Record<string, string> }> = {}) {
  return {
    id: "product_1",
    merchantId: "merchant_1",
    partnerId: "partner_1",
    partnerSku: "SKU-1",
    shopifyProductId: "gid://shopify/Product/1",
    status: "ACTIVE",
    variantMap: { "gid://shopify/ProductVariant/1": "SKU-1" },
    ...overrides,
  };
}

function mockAdapter(getInventory: ReturnType<typeof vi.fn>) {
  mockedGetAdapter.mockReturnValue({
    partnerKey: "mock-rest",
    getCatalog: vi.fn(),
    getInventory,
    createOrder: vi.fn(),
    getOrderStatus: vi.fn(),
    submitDispute: vi.fn(),
  } as never);
}

describe("syncInventory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedDb.partner.findUnique.mockResolvedValue(PARTNER as never);
  });

  it("leaves an available product ACTIVE and sends no notification", async () => {
    mockedDb.product.findMany.mockResolvedValue([makeProduct()] as never);
    mockAdapter(vi.fn().mockResolvedValue({ sku: "SKU-1", available: true, quantity: 5 }));

    const summary = await syncInventory();

    expect(mockedDb.product.update).not.toHaveBeenCalled();
    expect(mockedNotifyMerchant).not.toHaveBeenCalled();
    expect(summary).toEqual({ checked: 1, outOfStock: 0, discontinued: 0 });
  });

  it("marks a zero-quantity product OUT_OF_STOCK and notifies the merchant", async () => {
    mockedDb.product.findMany.mockResolvedValue([makeProduct()] as never);
    mockAdapter(vi.fn().mockResolvedValue({ sku: "SKU-1", available: false, quantity: 0 }));

    const summary = await syncInventory();

    expect(mockedDb.product.update).toHaveBeenCalledWith({
      where: { id: "product_1" },
      data: { status: "OUT_OF_STOCK" },
    });
    expect(mockedNotifyMerchant).toHaveBeenCalledOnce();
    expect(summary.outOfStock).toBe(1);
  });

  it("marks a product no longer in the partner catalog DISCONTINUED", async () => {
    mockedDb.product.findMany.mockResolvedValue([makeProduct()] as never);
    mockAdapter(vi.fn().mockResolvedValue({ sku: "SKU-1", available: false, quantity: null }));

    const summary = await syncInventory();

    expect(mockedDb.product.update).toHaveBeenCalledWith({
      where: { id: "product_1" },
      data: { status: "DISCONTINUED" },
    });
    expect(summary.discontinued).toBe(1);
  });

  it("does nothing when status hasn't changed", async () => {
    mockedDb.product.findMany.mockResolvedValue([makeProduct({ status: "OUT_OF_STOCK" })] as never);
    mockAdapter(vi.fn().mockResolvedValue({ sku: "SKU-1", available: false, quantity: 0 }));

    await syncInventory();

    expect(mockedDb.product.update).not.toHaveBeenCalled();
    expect(mockedNotifyMerchant).not.toHaveBeenCalled();
  });
});
