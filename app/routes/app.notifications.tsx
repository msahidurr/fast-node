import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getOrCreateMerchant } from "../models/merchant.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await getOrCreateMerchant(session.shop);

  const notifications = await db.merchantNotification.findMany({
    where: { merchantId: merchant.id },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  return {
    notificationEmail: merchant.notificationEmail ?? "",
    notifications: notifications.map((notification) => ({
      id: notification.id,
      type: notification.type,
      message: notification.message,
      read: notification.read,
      createdAt: notification.createdAt.toISOString(),
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await getOrCreateMerchant(session.shop);
  const formData = await request.formData();
  const intent = formData.get("intent");

  if (intent === "mark-read") {
    const id = String(formData.get("id"));
    await db.merchantNotification.updateMany({ where: { id, merchantId: merchant.id }, data: { read: true } });
    return { saved: true as const };
  }

  if (intent === "mark-all-read") {
    await db.merchantNotification.updateMany({ where: { merchantId: merchant.id, read: false }, data: { read: true } });
    return { saved: true as const };
  }

  if (intent === "set-email") {
    const email = String(formData.get("email") ?? "").trim();
    await db.merchant.update({ where: { id: merchant.id }, data: { notificationEmail: email || null } });
    return { saved: true as const };
  }

  return null;
};

function tone(type: string): "critical" | "warning" | "info" {
  if (type === "ROUTING_FAILURE" || type === "DISCONTINUED") return "critical";
  if (type === "OUT_OF_STOCK" || type === "SLA_BREACH") return "warning";
  return "info";
}

export default function Notifications() {
  const { notifications, notificationEmail } = useLoaderData<typeof loader>();
  const emailFetcher = useFetcher<typeof action>();
  const markAllFetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();

  useEffect(() => {
    if (emailFetcher.data && "saved" in emailFetcher.data) {
      shopify.toast.show("Notification email saved");
    }
  }, [emailFetcher.data, shopify]);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return (
    <s-page heading="Notifications">
      <s-section heading="Email address">
        <s-paragraph>FR-8.1 notifications (low stock, routing failures, SLA breaches, new products) go here too.</s-paragraph>
        <emailFetcher.Form method="post">
          <input type="hidden" name="intent" value="set-email" />
          <s-email-field
            name="email"
            label="Notification email"
            labelAccessibilityVisibility="exclusive"
            value={notificationEmail}
            placeholder="ops@yourstore.com"
          />
          <s-button type="submit" {...(emailFetcher.state !== "idle" ? { loading: true } : {})}>
            Save
          </s-button>
        </emailFetcher.Form>
      </s-section>

      <s-section heading={`Recent notifications${unreadCount > 0 ? ` (${unreadCount} unread)` : ""}`}>
        {unreadCount > 0 && (
          <markAllFetcher.Form method="post">
            <input type="hidden" name="intent" value="mark-all-read" />
            <s-button type="submit" variant="tertiary" {...(markAllFetcher.state !== "idle" ? { loading: true } : {})}>
              Mark all as read
            </s-button>
          </markAllFetcher.Form>
        )}

        {notifications.length === 0 ? (
          <s-paragraph>Nothing yet.</s-paragraph>
        ) : (
          <s-stack direction="block" gap="small">
            {notifications.map((notification) => (
              <NotificationRow key={notification.id} notification={notification} />
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}

type LoaderData = Awaited<ReturnType<typeof loader>>;

function NotificationRow({ notification }: { notification: LoaderData["notifications"][number] }) {
  const fetcher = useFetcher<typeof action>();

  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack direction="inline" gap="base">
        <s-badge tone={tone(notification.type)}>{notification.type}</s-badge>
        <s-text>{notification.message}</s-text>
        {!notification.read && (
          <fetcher.Form method="post">
            <input type="hidden" name="intent" value="mark-read" />
            <input type="hidden" name="id" value={notification.id} />
            <s-button type="submit" variant="tertiary" {...(fetcher.state !== "idle" ? { loading: true } : {})}>
              Mark read
            </s-button>
          </fetcher.Form>
        )}
      </s-stack>
    </s-box>
  );
}
