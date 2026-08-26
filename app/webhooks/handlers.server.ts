import { Prisma } from "@prisma/client";
import db from "../db.server";
import type { WebhookHandler } from "./process.server";
import { routeOrder } from "../routing/engine.server";
import type { OrderLineItemSnapshot } from "../routing/types";
import type { ShippingAddress } from "../partners/types";
import { logger } from "../utils/logger.server";

export const handleAppUninstalled: WebhookHandler = async (_payload, { shop }) => {
  await db.session.deleteMany({ where: { shop } });
};

export const handleScopesUpdate: WebhookHandler = async (payload, { shop }) => {
  const current = (payload as { current?: string[] }).current ?? [];
  await db.session.updateMany({ where: { shop }, data: { scope: current.join(",") } });
};

interface CustomersDataRequestPayload {
  customer?: { id?: number; email?: string };
  orders_requested?: number[];
}

// FR-1.4: the app holds no customer-facing PII beyond order shipping details
// (see handleCustomersRedact below), and Shopify's contract for this webhook is
// that the app locates/prepares its data on the named customer -- there's no
// automated customer-facing delivery mechanism, so this logs what was found for
// the merchant to act on manually. A merchant-facing export UI would be new
// scope beyond anything in the SRS.
export const handleCustomersDataRequest: WebhookHandler = async (payload, { shop, correlationId }) => {
  const { orders_requested: ordersRequested = [] } = payload as CustomersDataRequestPayload;
  if (ordersRequested.length === 0) return;

  const merchant = await db.merchant.findUnique({ where: { shop } });
  if (!merchant) return;

  const orders = await db.order.findMany({
    where: { merchantId: merchant.id, shopifyOrderId: { in: ordersRequested.map(String) } },
    select: { id: true, shopifyOrderId: true },
  });

  logger.info("gdpr.customers_data_request", {
    correlationId,
    shop,
    matchedOrderIds: orders.map((order) => order.shopifyOrderId),
  });
};

interface CustomersRedactPayload {
  customer?: { id?: number; email?: string };
  orders_to_redact?: number[];
}

// FR-1.4: Order.shippingAddress carries customer PII (name/address) since
// Phase 4's routing engine started persisting it. Redact wipes that field (and
// the denormalized country code) for the named orders; line item data (SKU/
// quantity/title) isn't customer PII and is kept for the merchant's own
// records. This is scoped to the named *customer's* orders only -- it must
// never touch the merchant's own Session (that's shop/redact's job, below;
// an earlier version of this handler mistakenly deleted it here too, logging
// the merchant out of the app every time one of their customers requested
// redaction).
export const handleCustomersRedact: WebhookHandler = async (payload, { shop }) => {
  const { orders_to_redact: ordersToRedact = [] } = payload as CustomersRedactPayload;
  if (ordersToRedact.length === 0) return;

  const merchant = await db.merchant.findUnique({ where: { shop } });
  if (!merchant) return;

  await db.order.updateMany({
    where: { merchantId: merchant.id, shopifyOrderId: { in: ordersToRedact.map(String) } },
    data: { shippingAddress: Prisma.DbNull, shippingCountryCode: null },
  });
};

// FR-1.4: Shopify fires this ~48h after uninstall and expects the shop's data
// gone. Every table added since Phase 1 is shop-scoped through Merchant, so
// this has grown from "delete the Session" (all Phase 0 had) into a real
// cascade -- deleted in FK-dependency order (children before parents; the
// migrations use ON DELETE RESTRICT, not CASCADE, so this order isn't
// optional). Partner rows are platform-wide, not per-shop, and are never
// touched here.
export const handleShopRedact: WebhookHandler = async (_payload, { shop }) => {
  const merchant = await db.merchant.findUnique({ where: { shop } });

  if (merchant) {
    await db.dispute.deleteMany({ where: { order: { merchantId: merchant.id } } });
    await db.fulfillment.deleteMany({ where: { order: { merchantId: merchant.id } } });
    await db.routingDecision.deleteMany({ where: { order: { merchantId: merchant.id } } });
    await db.order.deleteMany({ where: { merchantId: merchant.id } });
    await db.markupRule.deleteMany({ where: { merchantId: merchant.id } });
    await db.product.deleteMany({ where: { merchantId: merchant.id } });
    await db.merchantNotification.deleteMany({ where: { merchantId: merchant.id } });
    await db.merchantPartner.deleteMany({ where: { merchantId: merchant.id } });
    await db.merchant.delete({ where: { id: merchant.id } });
  }

  await db.session.deleteMany({ where: { shop } });
};

interface ShopifyWebhookLineItem {
  variant_id: number | null;
  quantity: number;
  title: string;
  sku?: string;
}

interface ShopifyWebhookAddress {
  first_name?: string;
  last_name?: string;
  name?: string;
  address1?: string;
  address2?: string;
  city?: string;
  province_code?: string;
  country_code?: string;
  zip?: string;
}

interface ShopifyOrderPayload {
  id: number;
  line_items: ShopifyWebhookLineItem[];
  shipping_address?: ShopifyWebhookAddress;
}

// FR-4.1's trigger: ingests the Shopify order, matches its line items against
// this merchant's imported catalog (unmatched items aren't ours to fulfill and
// are dropped), snapshots what the routing engine needs, then hands off to it.
export const handleOrderCreate: WebhookHandler = async (payload, { shop }) => {
  const merchant = await db.merchant.findUnique({ where: { shop } });
  if (!merchant) return;

  const orderPayload = payload as ShopifyOrderPayload;

  const products = await db.product.findMany({ where: { merchantId: merchant.id } });
  const productByVariantGid = new Map<string, (typeof products)[number]>();
  for (const product of products) {
    for (const variantGid of Object.keys(product.variantMap as Record<string, string>)) {
      productByVariantGid.set(variantGid, product);
    }
  }

  const lineItems: OrderLineItemSnapshot[] = orderPayload.line_items
    .filter((item) => item.variant_id != null)
    .map((item) => {
      const variantGid = `gid://shopify/ProductVariant/${item.variant_id}`;
      const product = productByVariantGid.get(variantGid);
      const sku = product ? (product.variantMap as Record<string, string>)[variantGid] : undefined;
      return {
        variantGid,
        sku: sku ?? "",
        quantity: item.quantity,
        title: item.title,
        artworkUrl: product?.mockupUrl ?? undefined,
      };
    })
    .filter((item) => item.sku); // only items sourced through a connected partner

  if (lineItems.length === 0) return; // nothing in this order is ours to fulfill

  const address = orderPayload.shipping_address;
  const shippingAddress: ShippingAddress | null = address
    ? {
        name: address.name ?? [address.first_name, address.last_name].filter(Boolean).join(" "),
        address1: address.address1 ?? "",
        address2: address.address2,
        city: address.city ?? "",
        provinceCode: address.province_code,
        countryCode: address.country_code ?? "",
        zip: address.zip ?? "",
      }
    : null;

  const shopifyOrderId = String(orderPayload.id);
  const order = await db.order.upsert({
    where: { merchantId_shopifyOrderId: { merchantId: merchant.id, shopifyOrderId } },
    update: {},
    create: {
      merchantId: merchant.id,
      shopifyOrderId,
      lineItems: lineItems as unknown as Prisma.InputJsonValue,
      shippingAddress: (shippingAddress as unknown as Prisma.InputJsonValue) ?? Prisma.DbNull,
      shippingCountryCode: address?.country_code ?? null,
    },
  });

  await routeOrder(order.id);
};

// Keyed by the SDK's normalized topic (topic.toUpperCase().replace(/\/|\./g, "_")),
// used by the retry worker to re-dispatch a persisted event by its stored topic.
export const WEBHOOK_HANDLERS: Record<string, WebhookHandler> = {
  APP_UNINSTALLED: handleAppUninstalled,
  APP_SCOPES_UPDATE: handleScopesUpdate,
  CUSTOMERS_DATA_REQUEST: handleCustomersDataRequest,
  CUSTOMERS_REDACT: handleCustomersRedact,
  SHOP_REDACT: handleShopRedact,
  ORDERS_CREATE: handleOrderCreate,
};
