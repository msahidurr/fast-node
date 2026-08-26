import { unauthenticated } from "../shopify.server";
import type { OrderLineItemSnapshot } from "../routing/types";
import { logger } from "../utils/logger.server";

interface FulfillmentOrderLineItemNode {
  id: string;
  lineItem: { variant: { id: string } | null };
}

interface FulfillmentOrderNode {
  id: string;
  lineItems: { edges: { node: FulfillmentOrderLineItemNode }[] };
}

interface OrderFulfillmentOrdersResponse {
  data?: {
    order?: {
      fulfillmentOrders?: { edges: { node: FulfillmentOrderNode }[] };
    } | null;
  };
}

interface FulfillmentCreateResponse {
  data?: {
    fulfillmentCreate?: {
      fulfillment?: { id: string; status: string } | null;
      userErrors?: { field: string[]; message: string }[];
    };
  };
}

// FR-5.2: creates a real Shopify Fulfillment (with tracking) for the given
// order/line items -- this is what actually posts to the order timeline and
// triggers Shopify's native "your order has shipped" customer email. Called
// from a background status poll (app/tracking/status-sync.server.ts), not a
// live admin session, so it authenticates with the merchant's stored offline
// token via unauthenticated.admin() rather than authenticate.admin().
export async function pushTrackingToShopify(
  shop: string,
  shopifyOrderId: string,
  lineItems: OrderLineItemSnapshot[],
  trackingNumber: string,
  carrier: string | undefined,
): Promise<boolean> {
  const { admin } = await unauthenticated.admin(shop);
  const orderGid = `gid://shopify/Order/${shopifyOrderId}`;

  const fulfillmentOrdersResponse = await admin.graphql(
    `#graphql
    query orderFulfillmentOrders($id: ID!) {
      order(id: $id) {
        fulfillmentOrders(first: 10) {
          edges {
            node {
              id
              lineItems(first: 100) {
                edges { node { id lineItem { variant { id } } } }
              }
            }
          }
        }
      }
    }`,
    { variables: { id: orderGid } },
  );
  const fulfillmentOrdersJson = (await fulfillmentOrdersResponse.json()) as OrderFulfillmentOrdersResponse;
  const fulfillmentOrders = fulfillmentOrdersJson.data?.order?.fulfillmentOrders?.edges.map((edge) => edge.node) ?? [];

  const variantGids = new Set(lineItems.map((item) => item.variantGid));
  const lineItemsByFulfillmentOrder: Array<{
    fulfillmentOrderId: string;
    fulfillmentOrderLineItems: { id: string; quantity: number }[];
  }> = [];

  for (const fulfillmentOrder of fulfillmentOrders) {
    const matched = fulfillmentOrder.lineItems.edges
      .map((edge) => edge.node)
      .filter((node) => node.lineItem.variant && variantGids.has(node.lineItem.variant.id));
    if (matched.length === 0) continue;

    lineItemsByFulfillmentOrder.push({
      fulfillmentOrderId: fulfillmentOrder.id,
      fulfillmentOrderLineItems: matched.map((node) => {
        const item = lineItems.find((li) => li.variantGid === node.lineItem.variant?.id);
        return { id: node.id, quantity: item?.quantity ?? 1 };
      }),
    });
  }

  if (lineItemsByFulfillmentOrder.length === 0) {
    logger.error("shopify_fulfillment.no_matching_line_items", { shop, shopifyOrderId });
    return false;
  }

  const createResponse = await admin.graphql(
    `#graphql
    mutation trackedFulfillmentCreate($fulfillment: FulfillmentInput!) {
      fulfillmentCreate(fulfillment: $fulfillment) {
        fulfillment { id status }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        fulfillment: {
          lineItemsByFulfillmentOrder,
          trackingInfo: { number: trackingNumber, company: carrier },
          notifyCustomer: true,
        },
      },
    },
  );

  const createJson = (await createResponse.json()) as FulfillmentCreateResponse;
  const userErrors = createJson.data?.fulfillmentCreate?.userErrors ?? [];
  if (userErrors.length > 0) {
    logger.error("shopify_fulfillment.create_failed", { shop, shopifyOrderId, errors: userErrors });
    return false;
  }

  logger.info("shopify_fulfillment.created", {
    shop,
    shopifyOrderId,
    fulfillmentId: createJson.data?.fulfillmentCreate?.fulfillment?.id,
  });
  return true;
}
