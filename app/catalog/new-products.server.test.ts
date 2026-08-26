import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.server", () => ({
  default: {
    partner: { findMany: vi.fn() },
    partnerCatalogSku: { findUnique: vi.fn(), create: vi.fn() },
    merchantPartner: { findMany: vi.fn() },
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
import { syncNewProducts } from "./new-products.server";

const mockedDb = vi.mocked(db, true);
const mockedGetAdapter = vi.mocked(getAdapter);
const mockedNotifyMerchant = vi.mocked(notifyMerchant);

const PARTNER = { id: "partner_1", partnerKey: "mock-rest", name: "Mock Partner", supportedCategories: ["leather-goods"], regions: ["US"] };
const ITEM = { sku: "NEW-SKU", name: "New Wallet", category: "leather-goods", region: "US", basePrice: 10, variants: [] };

function mockAdapter(getCatalog: ReturnType<typeof vi.fn>) {
  mockedGetAdapter.mockReturnValue({
    partnerKey: "mock-rest",
    getCatalog,
    getInventory: vi.fn(),
    createOrder: vi.fn(),
    getOrderStatus: vi.fn(),
    submitDispute: vi.fn(),
  } as never);
}

describe("syncNewProducts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedDb.partner.findMany.mockResolvedValue([PARTNER] as never);
  });

  it("does nothing for a SKU that's already been seen", async () => {
    mockAdapter(vi.fn().mockResolvedValue([ITEM]));
    mockedDb.partnerCatalogSku.findUnique.mockResolvedValue({ id: "seen_1" } as never);

    const summary = await syncNewProducts();

    expect(mockedDb.partnerCatalogSku.create).not.toHaveBeenCalled();
    expect(mockedNotifyMerchant).not.toHaveBeenCalled();
    expect(summary).toEqual({ checked: 1, newSkus: 0 });
  });

  it("records a new SKU and notifies every connected merchant that picked the category", async () => {
    mockAdapter(vi.fn().mockResolvedValue([ITEM]));
    mockedDb.partnerCatalogSku.findUnique.mockResolvedValue(null);
    mockedDb.merchantPartner.findMany.mockResolvedValue([
      { merchant: { id: "merchant_1" } },
      { merchant: { id: "merchant_2" } },
    ] as never);

    const summary = await syncNewProducts();

    expect(mockedDb.partnerCatalogSku.create).toHaveBeenCalledWith({
      data: { partnerId: "partner_1", sku: "NEW-SKU", category: "leather-goods" },
    });
    expect(mockedNotifyMerchant).toHaveBeenCalledTimes(2);
    expect(mockedNotifyMerchant).toHaveBeenCalledWith(expect.objectContaining({ merchantId: "merchant_1", type: "NEW_PRODUCTS" }));
    expect(summary).toEqual({ checked: 1, newSkus: 1 });
  });

  it("still records a new SKU when no merchant is connected/subscribed to notice it", async () => {
    mockAdapter(vi.fn().mockResolvedValue([ITEM]));
    mockedDb.partnerCatalogSku.findUnique.mockResolvedValue(null);
    mockedDb.merchantPartner.findMany.mockResolvedValue([]);

    const summary = await syncNewProducts();

    expect(mockedDb.partnerCatalogSku.create).toHaveBeenCalledOnce();
    expect(mockedNotifyMerchant).not.toHaveBeenCalled();
    expect(summary.newSkus).toBe(1);
  });
});
