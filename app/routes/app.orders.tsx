import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getOrCreateMerchant } from "../models/merchant.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await getOrCreateMerchant(session.shop);

  const orders = await db.order.findMany({
    where: { merchantId: merchant.id },
    orderBy: { createdAt: "desc" },
    include: { fulfillments: { include: { partner: true } } },
  });

  const statusCounts = orders.reduce<Record<string, number>>((counts, order) => {
    counts[order.status] = (counts[order.status] ?? 0) + 1;
    return counts;
  }, {});

  return {
    statusCounts,
    orders: orders.map((order) => ({
      id: order.id,
      shopifyOrderId: order.shopifyOrderId,
      status: order.status,
      partners: [...new Set(order.fulfillments.map((f) => f.partner.name))],
      shipmentSummary: order.fulfillments.map((f) => f.status).join(", "),
    })),
  };
};

function statusTone(status: string): "success" | "warning" | "critical" | "info" {
  if (status === "SUBMITTED") return "success";
  if (status === "PARTIALLY_SUBMITTED") return "warning";
  if (status === "ROUTING_FAILED") return "critical";
  return "info";
}

export default function Orders() {
  const { orders, statusCounts } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Orders">
      {orders.length === 0 ? (
        <s-section heading="No orders yet">
          <s-paragraph>Orders placed through this Shopify store will appear here once routed.</s-paragraph>
        </s-section>
      ) : (
        <>
          <s-section heading="Overview">
            <s-stack direction="inline" gap="base">
              {Object.entries(statusCounts).map(([status, count]) => (
                <s-badge key={status} tone={statusTone(status)}>
                  {count} {status}
                </s-badge>
              ))}
            </s-stack>
          </s-section>

          <s-section heading="Orders, across every connected partner">
            <s-table variant="auto">
              <s-table-header-row>
                <s-table-header>Order</s-table-header>
                <s-table-header>Status</s-table-header>
                <s-table-header>Partner(s)</s-table-header>
                <s-table-header>Shipments</s-table-header>
                <s-table-header></s-table-header>
              </s-table-header-row>
              <s-table-body>
                {orders.map((order) => (
                  <s-table-row key={order.id}>
                    <s-table-cell>#{order.shopifyOrderId}</s-table-cell>
                    <s-table-cell>
                      <s-badge tone={statusTone(order.status)}>{order.status}</s-badge>
                    </s-table-cell>
                    <s-table-cell>{order.partners.join(", ") || "-"}</s-table-cell>
                    <s-table-cell>{order.shipmentSummary || "-"}</s-table-cell>
                    <s-table-cell>
                      <s-link href={`/app/orders/${order.id}`}>View</s-link>
                    </s-table-cell>
                  </s-table-row>
                ))}
              </s-table-body>
            </s-table>
          </s-section>
        </>
      )}
    </s-page>
  );
}
