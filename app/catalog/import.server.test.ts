import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.server", () => ({
  default: { product: { create: vi.fn() } },
}));

vi.mock("./catalog.server", () => ({
  getCatalogGroup: vi.fn(),
}));

vi.mock("./pricing.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./pricing.server")>();
  return { ...actual, resolveMarkupRule: vi.fn() };
});

import db from "../db.server";
import { getCatalogGroup } from "./catalog.server";
import { resolveMarkupRule } from "./pricing.server";
import { importCatalogGroup } from "./import.server";

const mockedDb = vi.mocked(db, true);
const mockedGetCatalogGroup = vi.mocked(getCatalogGroup);
const mockedResolveMarkupRule = vi.mocked(resolveMarkupRule);

const GROUP = {
  partnerId: "partner_1",
  partnerKey: "mock-rest",
  partnerName: "Mock Partner",
  name: "Wallet",
  category: "leather-goods",
  region: "US",
  items: [
    { sku: "A-BRN", name: "Wallet", category: "leather-goods", region: "US", basePrice: 10, variants: [{ option: "Color", value: "Brown" }] },
    { sku: "A-BLK", name: "Wallet", category: "leather-goods", region: "US", basePrice: 12, variants: [{ option: "Color", value: "Black" }] },
  ],
};

function jsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

describe("importCatalogGroup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedResolveMarkupRule.mockResolvedValue({ type: "PERCENTAGE", value: 0 });
  });

  it("throws when the catalog group can't be found", async () => {
    mockedGetCatalogGroup.mockResolvedValue(null);
    const admin = vi.fn();

    await expect(
      importCatalogGroup({
        admin,
        merchantId: "merchant_1",
        partnerId: "partner_1",
        category: "leather-goods",
        region: "US",
        groupName: "Wallet",
      }),
    ).rejects.toThrow(/not found/);
  });

  it("creates a Shopify product with one variant per item, prices marked up, and maps variant ids to partner SKUs", async () => {
    mockedGetCatalogGroup.mockResolvedValue(GROUP as never);
    mockedResolveMarkupRule.mockResolvedValue({ type: "PERCENTAGE", value: 10 });
    mockedDb.product.create.mockResolvedValue({ id: "local_product_1" } as never);

    const admin = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            productCreate: {
              product: {
                id: "gid://shopify/Product/1",
                variants: {
                  edges: [
                    { node: { id: "gid://shopify/ProductVariant/1", selectedOptions: [{ name: "Color", value: "Brown" }] } },
                    { node: { id: "gid://shopify/ProductVariant/2", selectedOptions: [{ name: "Color", value: "Black" }] } },
                  ],
                },
              },
              userErrors: [],
            },
          },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ data: { productVariantsBulkUpdate: { userErrors: [] } } }));

    await importCatalogGroup({
      admin,
      merchantId: "merchant_1",
      partnerId: "partner_1",
      category: "leather-goods",
      region: "US",
      groupName: "Wallet",
    });

    expect(admin).toHaveBeenCalledTimes(2);

    const bulkUpdateCall = admin.mock.calls[1];
    const bulkVariants = (bulkUpdateCall[1] as { variables: { variants: Array<{ id: string; price: string; inventoryItem: { sku: string } }> } })
      .variables.variants;
    expect(bulkVariants).toEqual(
      expect.arrayContaining([
        { id: "gid://shopify/ProductVariant/1", price: "11.00", inventoryItem: { sku: "A-BRN" } },
        { id: "gid://shopify/ProductVariant/2", price: "13.20", inventoryItem: { sku: "A-BLK" } },
      ]),
    );

    expect(mockedDb.product.create).toHaveBeenCalledWith({
      data: {
        merchantId: "merchant_1",
        partnerId: "partner_1",
        shopifyProductId: "gid://shopify/Product/1",
        partnerSku: "A-BRN",
        category: "leather-goods",
        variantMap: {
          "gid://shopify/ProductVariant/1": "A-BRN",
          "gid://shopify/ProductVariant/2": "A-BLK",
        },
        baseCost: 10,
      },
    });
  });

  it("throws when productCreate returns userErrors", async () => {
    mockedGetCatalogGroup.mockResolvedValue(GROUP as never);
    const admin = vi.fn().mockResolvedValueOnce(
      jsonResponse({ data: { productCreate: { product: null, userErrors: [{ field: ["title"], message: "Title can't be blank" }] } } }),
    );

    await expect(
      importCatalogGroup({
        admin,
        merchantId: "merchant_1",
        partnerId: "partner_1",
        category: "leather-goods",
        region: "US",
        groupName: "Wallet",
      }),
    ).rejects.toThrow(/productCreate failed/);
  });
});
