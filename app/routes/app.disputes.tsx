import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getOrCreateMerchant } from "../models/merchant.server";
import { fileDispute, resolveDispute } from "../disputes/service.server";

const DISPUTE_TYPES = ["DAMAGED", "MISPRINT", "LOST"];
const DISPUTE_STATUSES = ["OPEN", "IN_REVIEW", "RESOLVED", "REJECTED"];

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await getOrCreateMerchant(session.shop);

  const [disputes, eligibleFulfillments] = await Promise.all([
    db.dispute.findMany({
      where: { order: { merchantId: merchant.id } },
      include: { order: true, fulfillment: { include: { partner: true } } },
      orderBy: { createdAt: "desc" },
    }),
    db.fulfillment.findMany({
      where: { order: { merchantId: merchant.id }, status: { in: ["QUEUED", "IN_PRODUCTION", "SHIPPED", "DELIVERED"] } },
      include: { order: true, partner: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  return {
    disputes: disputes.map((dispute) => ({
      id: dispute.id,
      shopifyOrderId: dispute.order.shopifyOrderId,
      partnerName: dispute.fulfillment?.partner.name ?? "-",
      type: dispute.type,
      status: dispute.status,
      details: dispute.details,
      partnerDisputeId: dispute.partnerDisputeId,
      resolution: dispute.resolution,
    })),
    eligibleFulfillments: eligibleFulfillments.map((fulfillment) => ({
      id: fulfillment.id,
      shopifyOrderId: fulfillment.order.shopifyOrderId,
      partnerName: fulfillment.partner.name,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await getOrCreateMerchant(session.shop);
  const formData = await request.formData();
  const intent = formData.get("intent");

  try {
    if (intent === "file") {
      const fulfillmentId = String(formData.get("fulfillmentId"));
      const type = String(formData.get("type"));
      const details = String(formData.get("details") ?? "");
      await fileDispute(merchant.id, fulfillmentId, type, details);
      return { filed: true as const };
    }

    if (intent === "resolve") {
      const disputeId = String(formData.get("disputeId"));
      const status = String(formData.get("status"));
      const resolution = String(formData.get("resolution") ?? "");
      await resolveDispute(merchant.id, disputeId, status, resolution);
      return { resolved: true as const };
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  return null;
};

type LoaderData = Awaited<ReturnType<typeof loader>>;
type ActionData = Awaited<ReturnType<typeof action>>;

function useActionToast(fetcher: ReturnType<typeof useFetcher<typeof action>>, successMessage: string) {
  const shopify = useAppBridge();
  useEffect(() => {
    const data = fetcher.data as ActionData | undefined;
    if (data && "error" in data && data.error) {
      shopify.toast.show(data.error, { isError: true });
    } else if (data && ("filed" in data || "resolved" in data)) {
      shopify.toast.show(successMessage);
    }
  }, [fetcher.data, shopify, successMessage]);
}

function FileDisputeForm({ fulfillments }: { fulfillments: LoaderData["eligibleFulfillments"] }) {
  const fetcher = useFetcher<typeof action>();
  useActionToast(fetcher, "Dispute filed with partner");
  const isSubmitting = fetcher.state !== "idle";

  if (fulfillments.length === 0) {
    return <s-paragraph>No shipments eligible for a dispute yet.</s-paragraph>;
  }

  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="file" />
      <s-select name="fulfillmentId" label="Shipment">
        {fulfillments.map((fulfillment) => (
          <s-option key={fulfillment.id} value={fulfillment.id}>
            Order #{fulfillment.shopifyOrderId} -- {fulfillment.partnerName}
          </s-option>
        ))}
      </s-select>
      <s-select name="type" label="Issue type">
        {DISPUTE_TYPES.map((type) => (
          <s-option key={type} value={type}>
            {type}
          </s-option>
        ))}
      </s-select>
      <s-text-area name="details" label="Details" rows={3} />
      <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>
        Report to partner
      </s-button>
    </fetcher.Form>
  );
}

function ResolveDisputeForm({ dispute }: { dispute: LoaderData["disputes"][number] }) {
  const fetcher = useFetcher<typeof action>();
  useActionToast(fetcher, "Dispute updated");
  const isSubmitting = fetcher.state !== "idle";

  return (
    <fetcher.Form method="post">
      <input type="hidden" name="intent" value="resolve" />
      <input type="hidden" name="disputeId" value={dispute.id} />
      <s-select name="status" label="Status" labelAccessibilityVisibility="exclusive" value={dispute.status}>
        {DISPUTE_STATUSES.map((status) => (
          <s-option key={status} value={status}>
            {status}
          </s-option>
        ))}
      </s-select>
      <s-text-field
        name="resolution"
        label="Resolution notes"
        labelAccessibilityVisibility="exclusive"
        placeholder="What happened / how it was resolved"
        value={dispute.resolution ?? ""}
      />
      <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>
        Save
      </s-button>
    </fetcher.Form>
  );
}

export default function Disputes() {
  const { disputes, eligibleFulfillments } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Disputes & reprints">
      <s-section heading="Report an issue">
        <s-paragraph>Damaged, misprinted, or lost items (FR-6.1) -- sent to the partner via their adapter.</s-paragraph>
        <FileDisputeForm fulfillments={eligibleFulfillments} />
      </s-section>

      <s-section heading="Dispute history">
        {disputes.length === 0 ? (
          <s-paragraph>No disputes filed yet.</s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {disputes.map((dispute) => (
              <s-box key={dispute.id} padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="small">
                  <s-text>
                    Order #{dispute.shopifyOrderId} -- {dispute.partnerName} -- <s-badge>{dispute.type}</s-badge>{" "}
                    <s-badge>{dispute.status}</s-badge>
                  </s-text>
                  {dispute.details && <s-text>{dispute.details}</s-text>}
                  {dispute.partnerDisputeId && <s-text>Partner reference: {dispute.partnerDisputeId}</s-text>}
                  <ResolveDisputeForm dispute={dispute} />
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}
