import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getOrCreateMerchant } from "../models/merchant.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await getOrCreateMerchant(session.shop);

  const [partnerCount, productCount, orderCount, unreadNotifications] = await Promise.all([
    db.merchantPartner.count({ where: { merchantId: merchant.id } }),
    db.product.count({ where: { merchantId: merchant.id } }),
    db.order.count({ where: { merchantId: merchant.id } }),
    db.merchantNotification.count({ where: { merchantId: merchant.id, read: false } }),
  ]);

  return {
    onboarded: Boolean(merchant.onboardingCompletedAt),
    partnerCount,
    productCount,
    orderCount,
    unreadNotifications,
  };
};

function StatBox({ value, label }: { value: number; label: string }) {
  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-heading>{value}</s-heading>
      <s-text>{label}</s-text>
    </s-box>
  );
}

export default function Index() {
  const { onboarded, partnerCount, productCount, orderCount, unreadNotifications } = useLoaderData<typeof loader>();

  if (!onboarded) {
    return (
      <s-page heading="Welcome to FastNode">
        <s-button slot="primary-action" href="/app/onboarding">
          Start onboarding
        </s-button>
        <s-section heading="Get started">
          <s-paragraph>
            Connect a niche fulfillment partner, pick your categories, and set a default markup -- takes a few
            minutes.
          </s-paragraph>
        </s-section>
      </s-page>
    );
  }

  return (
    <s-page heading="Dashboard">
      <s-button slot="primary-action" href="/app/catalog">
        Browse catalog
      </s-button>

      <s-section heading="Overview">
        <s-stack direction="inline" gap="base">
          <StatBox value={partnerCount} label="Connected partner(s)" />
          <StatBox value={productCount} label="Imported product(s)" />
          <StatBox value={orderCount} label="Order(s) routed" />
          <StatBox value={unreadNotifications} label="Unread notification(s)" />
        </s-stack>
      </s-section>

      <s-section heading="Quick links">
        <s-unordered-list>
          <s-list-item>
            <s-link href="/app/catalog">Browse the partner catalog</s-link>
          </s-list-item>
          <s-list-item>
            <s-link href="/app/orders">View orders</s-link>
          </s-list-item>
          <s-list-item>
            <s-link href="/app/pricing">Adjust pricing</s-link>
          </s-list-item>
          <s-list-item>
            <s-link href="/app/notifications">Check notifications</s-link>
          </s-list-item>
        </s-unordered-list>
      </s-section>
    </s-page>
  );
}
