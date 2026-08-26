import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.server", () => ({
  default: {
    merchantPartner: { findMany: vi.fn() },
    partner: { findUnique: vi.fn() },
  },
}));

vi.mock("../partners/registry.server", () => ({
  getAdapter: vi.fn(),
}));

import db from "../db.server";
import { getAdapter } from "../partners/registry.server";
import { getCatalogForMerchant, getCatalogGroup } from "./catalog.server";

const mockedDb = vi.mocked(db, true);
const mockedGetAdapter = vi.mocked(getAdapter);

const PARTNER = {
  id: "partner_1",
  partnerKey: "mock-rest",
  name: "Mock Partner",
  active: true,
  supportedCategories: ["leather-goods"],
  regions: ["US"],
};

describe("getCatalogForMerchant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("groups catalog items from connected partners by name/category/region", async () => {
    mockedDb.merchantPartner.findMany.mockResolvedValue([{ partner: PARTNER }] as never);
    mockedGetAdapter.mockReturnValue({
      partnerKey: "mock-rest",
      getCatalog: vi.fn().mockResolvedValue([
        { sku: "A-1", name: "Wallet", category: "leather-goods", region: "US", basePrice: 10, variants: [{ option: "Color", value: "Brown" }] },
        { sku: "A-2", name: "Wallet", category: "leather-goods", region: "US", basePrice: 10, variants: [{ option: "Color", value: "Black" }] },
      ]),
      getInventory: vi.fn(),
      createOrder: vi.fn(),
      getOrderStatus: vi.fn(),
      submitDispute: vi.fn(),
    } as never);

    const groups = await getCatalogForMerchant("merchant_1");

    expect(groups).toHaveLength(1);
    expect(groups[0].name).toBe("Wallet");
    expect(groups[0].items).toHaveLength(2);
    expect(groups[0].items.map((item) => item.sku)).toEqual(["A-1", "A-2"]);
  });

  it("skips categories the partner doesn't actually support", async () => {
    mockedDb.merchantPartner.findMany.mockResolvedValue([{ partner: PARTNER }] as never);
    const getCatalog = vi.fn().mockResolvedValue([]);
    mockedGetAdapter.mockReturnValue({
      partnerKey: "mock-rest",
      getCatalog,
      getInventory: vi.fn(),
      createOrder: vi.fn(),
      getOrderStatus: vi.fn(),
      submitDispute: vi.fn(),
    } as never);

    await getCatalogForMerchant("merchant_1", "eco-packaging");

    expect(getCatalog).not.toHaveBeenCalled();
  });
});

describe("getCatalogGroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns null when the partner is inactive", async () => {
    mockedDb.partner.findUnique.mockResolvedValue({ ...PARTNER, active: false } as never);

    const group = await getCatalogGroup("partner_1", "leather-goods", "US", "Wallet");

    expect(group).toBeNull();
  });

  it("returns null when no catalog item matches the given name", async () => {
    mockedDb.partner.findUnique.mockResolvedValue(PARTNER as never);
    mockedGetAdapter.mockReturnValue({
      partnerKey: "mock-rest",
      getCatalog: vi.fn().mockResolvedValue([]),
      getInventory: vi.fn(),
      createOrder: vi.fn(),
      getOrderStatus: vi.fn(),
      submitDispute: vi.fn(),
    } as never);

    const group = await getCatalogGroup("partner_1", "leather-goods", "US", "Does Not Exist");

    expect(group).toBeNull();
  });
});
