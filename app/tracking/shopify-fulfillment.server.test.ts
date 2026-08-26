import { beforeEach, describe, expect, it, vi } from "vitest";

const adminGraphql = vi.fn();
vi.mock("../shopify.server", () => ({
  unauthenticated: { admin: vi.fn(async () => ({ admin: { graphql: adminGraphql }, session: {} })) },
}));

import { pushTrackingToShopify } from "./shopify-fulfillment.server";

function jsonResponse(body: unknown) {
  return { json: async () => body } as Response;
}

const LINE_ITEMS = [{ variantGid: "gid://shopify/ProductVariant/1", sku: "SKU-1", quantity: 2, title: "Item" }];

describe("pushTrackingToShopify", () => {
  beforeEach(() => {
    adminGraphql.mockReset();
  });

  it("creates a fulfillment for the matching fulfillment order line items and returns true", async () => {
    adminGraphql
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            order: {
              fulfillmentOrders: {
                edges: [
                  {
                    node: {
                      id: "gid://shopify/FulfillmentOrder/1",
                      lineItems: {
                        edges: [
                          { node: { id: "gid://shopify/FulfillmentOrderLineItem/1", lineItem: { variant: { id: "gid://shopify/ProductVariant/1" } } } },
                          { node: { id: "gid://shopify/FulfillmentOrderLineItem/2", lineItem: { variant: { id: "gid://shopify/ProductVariant/999" } } } },
                        ],
                      },
                    },
                  },
                ],
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: { fulfillmentCreate: { fulfillment: { id: "gid://shopify/Fulfillment/1", status: "SUCCESS" }, userErrors: [] } } }),
      );

    const result = await pushTrackingToShopify("test.myshopify.com", "1001", LINE_ITEMS, "1Z999", "UPS");

    expect(result).toBe(true);
    const createCall = adminGraphql.mock.calls[1];
    const variables = (createCall[1] as { variables: { fulfillment: { lineItemsByFulfillmentOrder: unknown; trackingInfo: unknown } } })
      .variables.fulfillment;
    expect(variables.lineItemsByFulfillmentOrder).toEqual([
      {
        fulfillmentOrderId: "gid://shopify/FulfillmentOrder/1",
        fulfillmentOrderLineItems: [{ id: "gid://shopify/FulfillmentOrderLineItem/1", quantity: 2 }],
      },
    ]);
    expect(variables.trackingInfo).toEqual({ number: "1Z999", company: "UPS" });
  });

  it("returns false and skips fulfillmentCreate when no fulfillment order line items match", async () => {
    adminGraphql.mockResolvedValueOnce(
      jsonResponse({ data: { order: { fulfillmentOrders: { edges: [] } } } }),
    );

    const result = await pushTrackingToShopify("test.myshopify.com", "1001", LINE_ITEMS, "1Z999", "UPS");

    expect(result).toBe(false);
    expect(adminGraphql).toHaveBeenCalledTimes(1);
  });

  it("returns false when fulfillmentCreate reports userErrors", async () => {
    adminGraphql
      .mockResolvedValueOnce(
        jsonResponse({
          data: {
            order: {
              fulfillmentOrders: {
                edges: [
                  {
                    node: {
                      id: "gid://shopify/FulfillmentOrder/1",
                      lineItems: {
                        edges: [{ node: { id: "gid://shopify/FulfillmentOrderLineItem/1", lineItem: { variant: { id: "gid://shopify/ProductVariant/1" } } } }],
                      },
                    },
                  },
                ],
              },
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({ data: { fulfillmentCreate: { fulfillment: null, userErrors: [{ field: [], message: "Already fulfilled" }] } } }),
      );

    const result = await pushTrackingToShopify("test.myshopify.com", "1001", LINE_ITEMS, "1Z999", "UPS");

    expect(result).toBe(false);
  });
});
