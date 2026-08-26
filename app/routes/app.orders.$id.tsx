import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getOrCreateMerchant } from "../models/merchant.server";
import { submitFulfillment } from "../routing/submit.server";
import type { OrderLineItemSnapshot } from "../routing/types";

export const loader = async ({ request, params }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await getOrCreateMerchant(session.shop);

  const order = await db.order.findFirst({
    where: { id: params.id, merchantId: merchant.id },
    include: {
      fulfillments: { include: { partner: true }, orderBy: { createdAt: "asc" } },
      routingDecisions: { include: { partner: true }, orderBy: { createdAt: "asc" } },
    },
  });
  if (!order) throw new Response("Order not found", { status: 404 });

  const connections = await db.merchantPartner.findMany({
    where: { merchantId: merchant.id },
    include: { partner: true },
  });

  // Routing decisions with no fulfillment are either the initial choice behind
  // an existing fulfillment (superseded on override) or a routing failure
  // (no candidate partner) still awaiting a merchant override.
  const fulfilledDecisionIds = new Set(order.fulfillments.map((f) => f.routingDecisionId).filter(Boolean));
  const unresolvedFailures = order.routingDecisions.filter(
    (decision) => !decision.partnerId && !fulfilledDecisionIds.has(decision.id),
  );

  return {
    order: {
      id: order.id,
      shopifyOrderId: order.shopifyOrderId,
      status: order.status,
      lineItems: order.lineItems as unknown as OrderLineItemSnapshot[],
    },
    partnerOptions: connections.map((connection) => ({ id: connection.partner.id, name: connection.partner.name })),
    fulfillments: order.fulfillments.map((fulfillment) => ({
      id: fulfillment.id,
      routingDecisionId: fulfillment.routingDecisionId,
      partnerId: fulfillment.partnerId,
      partnerName: fulfillment.partner.name,
      status: fulfillment.status,
      attempts: fulfillment.attempts,
      lastError: fulfillment.lastError,
      partnerOrderId: fulfillment.partnerOrderId,
      trackingNumber: fulfillment.trackingNumber,
      carrier: fulfillment.carrier,
      lineItems: fulfillment.lineItems as unknown as OrderLineItemSnapshot[],
    })),
    unresolvedFailures: unresolvedFailures.map((decision) => ({
      routingDecisionId: decision.id,
      reasonCode: decision.reasonCode,
      lineItems: decision.lineItems as unknown as OrderLineItemSnapshot[],
    })),
  };
};

export const action = async ({ request, params }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await getOrCreateMerchant(session.shop);
  const order = await db.order.findFirst({ where: { id: params.id, merchantId: merchant.id } });
  if (!order) return { error: "Order not found." };

  const formData = await request.formData();
  const targetPartnerId = String(formData.get("partnerId"));
  const fulfillmentId = formData.get("fulfillmentId");
  const routingDecisionId = String(formData.get("routingDecisionId"));

  const sourceDecision = await db.routingDecision.findFirst({
    where: { id: routingDecisionId, orderId: order.id },
  });
  if (!sourceDecision) return { error: "Routing decision not found." };

  // FR-4.2: record the override as its own decision (audit trail), then point
  // the shipment-group at the forced partner and resubmit.
  const overrideDecision = await db.routingDecision.create({
    data: {
      orderId: order.id,
      partnerId: targetPartnerId,
      lineItems: sourceDecision.lineItems as object,
      reasonCode: "MERCHANT_OVERRIDE",
      isOverride: true,
    },
  });

  const targetFulfillmentId = fulfillmentId
    ? String(fulfillmentId)
    : (
        await db.fulfillment.create({
          data: {
            orderId: order.id,
            partnerId: targetPartnerId,
            routingDecisionId: overrideDecision.id,
            lineItems: sourceDecision.lineItems as object,
          },
        })
      ).id;

  if (fulfillmentId) {
    await db.fulfillment.update({
      where: { id: targetFulfillmentId },
      data: {
        partnerId: targetPartnerId,
        routingDecisionId: overrideDecision.id,
        status: "PENDING_SUBMISSION",
        attempts: 0,
        lastError: null,
        nextAttemptAt: new Date(),
      },
    });
  }

  await submitFulfillment(targetFulfillmentId);

  return { overridden: true as const };
};

type LoaderData = Awaited<ReturnType<typeof loader>>;
type ActionData = Awaited<ReturnType<typeof action>>;

function OverrideForm({
  routingDecisionId,
  fulfillmentId,
  partnerOptions,
}: {
  routingDecisionId: string;
  fulfillmentId?: string;
  partnerOptions: LoaderData["partnerOptions"];
}) {
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    const data = fetcher.data as ActionData | undefined;
    if (data && "overridden" in data && data.overridden) {
      shopify.toast.show("Routing overridden and resubmitted");
    }
    if (data && "error" in data && data.error) {
      shopify.toast.show(data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  return (
    <fetcher.Form method="post">
      <input type="hidden" name="routingDecisionId" value={routingDecisionId} />
      {fulfillmentId && <input type="hidden" name="fulfillmentId" value={fulfillmentId} />}
      <s-select name="partnerId" label="Force partner" labelAccessibilityVisibility="exclusive">
        {partnerOptions.map((partner) => (
          <s-option key={partner.id} value={partner.id}>
            {partner.name}
          </s-option>
        ))}
      </s-select>
      <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>
        Override & resubmit
      </s-button>
    </fetcher.Form>
  );
}

export default function OrderDetail() {
  const { order, fulfillments, unresolvedFailures, partnerOptions } = useLoaderData<typeof loader>();

  return (
    <s-page heading={`Order #${order.shopifyOrderId}`}>
      <s-section heading="Overview">
        <s-badge>{order.status}</s-badge>
        <s-unordered-list>
          {order.lineItems.map((item) => (
            <s-list-item key={item.variantGid}>
              {item.title} x{item.quantity} (SKU {item.sku})
            </s-list-item>
          ))}
        </s-unordered-list>
      </s-section>

      <s-section heading="Shipments">
        {fulfillments.length === 0 && unresolvedFailures.length === 0 && <s-paragraph>Not routed yet.</s-paragraph>}
        <s-stack direction="block" gap="base">
          {fulfillments.map((fulfillment) => (
            <s-box key={fulfillment.id} padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="small">
                <s-text>
                  {fulfillment.partnerName} -- <s-badge>{fulfillment.status}</s-badge>
                  {fulfillment.attempts > 0 && ` (${fulfillment.attempts} attempt(s))`}
                </s-text>
                {fulfillment.partnerOrderId && <s-text>Partner order: {fulfillment.partnerOrderId}</s-text>}
                {fulfillment.trackingNumber && (
                  <s-text>
                    Tracking: {fulfillment.trackingNumber}
                    {fulfillment.carrier ? ` (${fulfillment.carrier})` : ""}
                  </s-text>
                )}
                {fulfillment.lastError && <s-banner tone="critical">{fulfillment.lastError}</s-banner>}
                <s-link href="/app/disputes">Report an issue with this shipment</s-link>
                {partnerOptions.length > 1 && fulfillment.routingDecisionId && (
                  <OverrideForm
                    routingDecisionId={fulfillment.routingDecisionId}
                    fulfillmentId={fulfillment.id}
                    partnerOptions={partnerOptions}
                  />
                )}
              </s-stack>
            </s-box>
          ))}

          {unresolvedFailures.map((failure) => (
            <s-box key={failure.routingDecisionId} padding="base" borderWidth="base" borderRadius="base">
              <s-stack direction="block" gap="small">
                <s-banner tone="critical" heading={`Routing failed: ${failure.reasonCode}`}>
                  <s-paragraph>{failure.lineItems.length} item(s) couldn&apos;t be routed automatically.</s-paragraph>
                </s-banner>
                {partnerOptions.length > 0 && (
                  <OverrideForm routingDecisionId={failure.routingDecisionId} partnerOptions={partnerOptions} />
                )}
              </s-stack>
            </s-box>
          ))}
        </s-stack>
      </s-section>
    </s-page>
  );
}
