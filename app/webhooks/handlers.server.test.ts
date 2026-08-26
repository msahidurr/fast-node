import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.server", () => ({
  default: {
    session: { deleteMany: vi.fn(), updateMany: vi.fn() },
    merchant: { findUnique: vi.fn(), delete: vi.fn() },
    order: { findMany: vi.fn(), updateMany: vi.fn(), deleteMany: vi.fn(), upsert: vi.fn() },
    product: { findMany: vi.fn(), deleteMany: vi.fn() },
    dispute: { deleteMany: vi.fn() },
    fulfillment: { deleteMany: vi.fn() },
    routingDecision: { deleteMany: vi.fn() },
    markupRule: { deleteMany: vi.fn() },
    merchantNotification: { deleteMany: vi.fn() },
    merchantPartner: { deleteMany: vi.fn() },
  },
}));

vi.mock("../routing/engine.server", () => ({
  routeOrder: vi.fn(),
}));

import db from "../db.server";
import { routeOrder } from "../routing/engine.server";
import {
  handleAppUninstalled,
  handleCustomersDataRequest,
  handleCustomersRedact,
  handleOrderCreate,
  handleScopesUpdate,
  handleShopRedact,
} from "./handlers.server";

const mockedDb = vi.mocked(db, true);
const mockedRouteOrder = vi.mocked(routeOrder);

const CTX = { shop: "test.myshopify.com", topic: "TEST", correlationId: "corr_1" };

describe("handleAppUninstalled", () => {
  it("deletes sessions for the shop", async () => {
    await handleAppUninstalled({}, CTX);
    expect(mockedDb.session.deleteMany).toHaveBeenCalledWith({ where: { shop: CTX.shop } });
  });
});

describe("handleScopesUpdate", () => {
  it("updates the session's stored scope", async () => {
    await handleScopesUpdate({ current: ["read_products", "write_products"] }, CTX);
    expect(mockedDb.session.updateMany).toHaveBeenCalledWith({
      where: { shop: CTX.shop },
      data: { scope: "read_products,write_products" },
    });
  });
});

describe("handleCustomersDataRequest", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does nothing when no orders are requested", async () => {
    await handleCustomersDataRequest({ orders_requested: [] }, CTX);
    expect(mockedDb.merchant.findUnique).not.toHaveBeenCalled();
  });

  it("does nothing when the merchant isn't found", async () => {
    mockedDb.merchant.findUnique.mockResolvedValue(null);
    await handleCustomersDataRequest({ orders_requested: [1001] }, CTX);
    expect(mockedDb.order.findMany).not.toHaveBeenCalled();
  });

  it("looks up matching orders for the merchant", async () => {
    mockedDb.merchant.findUnique.mockResolvedValue({ id: "merchant_1" } as never);
    mockedDb.order.findMany.mockResolvedValue([{ id: "order_1", shopifyOrderId: "1001" }] as never);

    await handleCustomersDataRequest({ orders_requested: [1001] }, CTX);

    expect(mockedDb.order.findMany).toHaveBeenCalledWith({
      where: { merchantId: "merchant_1", shopifyOrderId: { in: ["1001"] } },
      select: { id: true, shopifyOrderId: true },
    });
  });
});

describe("handleCustomersRedact", () => {
  beforeEach(() => vi.clearAllMocks());

  it("never deletes the merchant's own Session", async () => {
    mockedDb.merchant.findUnique.mockResolvedValue({ id: "merchant_1" } as never);
    await handleCustomersRedact({ orders_to_redact: [1001] }, CTX);
    expect(mockedDb.session.deleteMany).not.toHaveBeenCalled();
  });

  it("does nothing when no orders are named", async () => {
    await handleCustomersRedact({ orders_to_redact: [] }, CTX);
    expect(mockedDb.merchant.findUnique).not.toHaveBeenCalled();
  });

  it("redacts the shipping address on the named orders", async () => {
    mockedDb.merchant.findUnique.mockResolvedValue({ id: "merchant_1" } as never);

    await handleCustomersRedact({ orders_to_redact: [1001, 1002] }, CTX);

    expect(mockedDb.order.updateMany).toHaveBeenCalledWith({
      where: { merchantId: "merchant_1", shopifyOrderId: { in: ["1001", "1002"] } },
      data: expect.objectContaining({ shippingCountryCode: null }),
    });
  });
});

describe("handleShopRedact", () => {
  beforeEach(() => vi.clearAllMocks());

  it("deletes the Session even when there's no Merchant row", async () => {
    mockedDb.merchant.findUnique.mockResolvedValue(null);

    await handleShopRedact({}, CTX);

    expect(mockedDb.merchant.delete).not.toHaveBeenCalled();
    expect(mockedDb.session.deleteMany).toHaveBeenCalledWith({ where: { shop: CTX.shop } });
  });

  it("cascades through every shop-scoped table before deleting the Merchant, then the Session", async () => {
    mockedDb.merchant.findUnique.mockResolvedValue({ id: "merchant_1" } as never);
    const calls: string[] = [];
    const record =
      (name: string) =>
      async () => {
        calls.push(name);
        return {} as never;
      };
    mockedDb.dispute.deleteMany.mockImplementation(record("dispute") as never);
    mockedDb.fulfillment.deleteMany.mockImplementation(record("fulfillment") as never);
    mockedDb.routingDecision.deleteMany.mockImplementation(record("routingDecision") as never);
    mockedDb.order.deleteMany.mockImplementation(record("order") as never);
    mockedDb.markupRule.deleteMany.mockImplementation(record("markupRule") as never);
    mockedDb.product.deleteMany.mockImplementation(record("product") as never);
    mockedDb.merchantNotification.deleteMany.mockImplementation(record("merchantNotification") as never);
    mockedDb.merchantPartner.deleteMany.mockImplementation(record("merchantPartner") as never);
    mockedDb.merchant.delete.mockImplementation(record("merchant") as never);
    mockedDb.session.deleteMany.mockImplementation(record("session") as never);

    await handleShopRedact({}, CTX);

    // Children before parents: Order-dependent tables before Order, Merchant
    // last among its own tables, Session (independent) can come after.
    expect(calls.indexOf("dispute")).toBeLessThan(calls.indexOf("order"));
    expect(calls.indexOf("fulfillment")).toBeLessThan(calls.indexOf("order"));
    expect(calls.indexOf("routingDecision")).toBeLessThan(calls.indexOf("order"));
    expect(calls.indexOf("markupRule")).toBeLessThan(calls.indexOf("product"));
    expect(calls.indexOf("order")).toBeLessThan(calls.indexOf("merchant"));
    expect(calls.indexOf("product")).toBeLessThan(calls.indexOf("merchant"));
    expect(calls.indexOf("merchantNotification")).toBeLessThan(calls.indexOf("merchant"));
    expect(calls.indexOf("merchantPartner")).toBeLessThan(calls.indexOf("merchant"));
    expect(calls).toContain("session");
  });
});

describe("handleOrderCreate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does nothing when the shop has no Merchant row", async () => {
    mockedDb.merchant.findUnique.mockResolvedValue(null);
    await handleOrderCreate({ id: 1001, line_items: [] }, CTX);
    expect(mockedRouteOrder).not.toHaveBeenCalled();
  });

  it("skips line items that don't match an imported product, and does nothing if none match", async () => {
    mockedDb.merchant.findUnique.mockResolvedValue({ id: "merchant_1" } as never);
    mockedDb.product.findMany.mockResolvedValue([] as never);

    await handleOrderCreate(
      { id: 1001, line_items: [{ variant_id: 999, quantity: 1, title: "Unmanaged item" }] },
      CTX,
    );

    expect(mockedDb.order.upsert).not.toHaveBeenCalled();
    expect(mockedRouteOrder).not.toHaveBeenCalled();
  });

  it("creates the Order with matched line items (including mockup artwork) and routes it", async () => {
    mockedDb.merchant.findUnique.mockResolvedValue({ id: "merchant_1" } as never);
    mockedDb.product.findMany.mockResolvedValue([
      { variantMap: { "gid://shopify/ProductVariant/501": "SKU-A" }, mockupUrl: "/mockups/a.png" },
    ] as never);
    mockedDb.order.upsert.mockResolvedValue({ id: "order_1" } as never);

    await handleOrderCreate(
      {
        id: 1001,
        line_items: [{ variant_id: 501, quantity: 2, title: "Item A" }],
        shipping_address: { name: "Buyer", address1: "1 St", city: "Town", country_code: "US", zip: "00000" },
      },
      CTX,
    );

    expect(mockedDb.order.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          merchantId: "merchant_1",
          shopifyOrderId: "1001",
          lineItems: [
            { variantGid: "gid://shopify/ProductVariant/501", sku: "SKU-A", quantity: 2, title: "Item A", artworkUrl: "/mockups/a.png" },
          ],
        }),
      }),
    );
    expect(mockedRouteOrder).toHaveBeenCalledWith("order_1");
  });
});
