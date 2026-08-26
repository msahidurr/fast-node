import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";

import { authenticate } from "../shopify.server";
import { createTranslator, resolveLocale } from "../i18n/i18n";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "", locale: resolveLocale(request.headers.get("Accept-Language")) };
};

export default function App() {
  const { apiKey, locale } = useLoaderData<typeof loader>();
  const t = createTranslator(locale);

  return (
    <AppProvider embedded apiKey={apiKey}>
      <s-app-nav>
        <s-link href="/app">{t("nav.home")}</s-link>
        <s-link href="/app/onboarding">{t("nav.onboarding")}</s-link>
        <s-link href="/app/catalog">{t("nav.catalog")}</s-link>
        <s-link href="/app/products">{t("nav.products")}</s-link>
        <s-link href="/app/pricing">{t("nav.pricing")}</s-link>
        <s-link href="/app/orders">{t("nav.orders")}</s-link>
        <s-link href="/app/disputes">{t("nav.disputes")}</s-link>
        <s-link href="/app/notifications">{t("nav.notifications")}</s-link>
      </s-app-nav>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
