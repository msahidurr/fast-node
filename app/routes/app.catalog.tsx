import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, redirect, useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getOrCreateMerchant } from "../models/merchant.server";
import { getCatalogForMerchant } from "../catalog/catalog.server";
import { importCatalogGroup } from "../catalog/import.server";
import { buildCostBreakdown, formatMoney, getShopCurrency, resolveMarkupRule } from "../catalog/pricing.server";
import { categoryLabel } from "../catalog/categories";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const merchant = await getOrCreateMerchant(session.shop);
  if (!merchant.onboardingCompletedAt) {
    throw redirect("/app/onboarding");
  }

  const url = new URL(request.url);
  const categoryFilter = url.searchParams.get("category") || undefined;

  const [groups, importedProducts, currencyCode] = await Promise.all([
    getCatalogForMerchant(merchant.id, categoryFilter),
    db.product.findMany({ where: { merchantId: merchant.id } }),
    getShopCurrency(admin.graphql),
  ]);
  const importedSkus = new Set(importedProducts.map((product) => product.partnerSku));

  const partners = await db.partner.findMany({
    where: { id: { in: [...new Set(groups.map((group) => group.partnerId))] } },
    select: { id: true, shippingEstimate: true },
  });
  const shippingByPartnerId = new Map(partners.map((partner) => [partner.id, Number(partner.shippingEstimate)]));

  const markupByCategory = new Map<string, Awaited<ReturnType<typeof resolveMarkupRule>>>();
  async function markupFor(category: string) {
    const cached = markupByCategory.get(category);
    if (cached) return cached;
    const rule = await resolveMarkupRule(merchant.id, category);
    markupByCategory.set(category, rule);
    return rule;
  }

  const groupViews = await Promise.all(
    groups.map(async (group) => {
      const rule = await markupFor(group.category);
      const shippingEstimate = shippingByPartnerId.get(group.partnerId) ?? 0;

      return {
        partnerId: group.partnerId,
        partnerName: group.partnerName,
        category: group.category,
        region: group.region,
        name: group.name,
        alreadyImported: group.items.some((item) => importedSkus.has(item.sku)),
        // Computed here, not in the component: this module is also bundled for
        // the client, and importing a .server module from rendered JSX (rather
        // than only from loader/action) breaks the client build.
        items: group.items.map((item) => {
          const breakdown = buildCostBreakdown(item.basePrice, shippingEstimate, rule);
          return {
            sku: item.sku,
            variant: item.variants[0] ? `${item.variants[0].option}: ${item.variants[0].value}` : item.sku,
            sellingPrice: formatMoney(breakdown.sellingPrice, currencyCode),
            baseCost: formatMoney(breakdown.baseCost, currencyCode),
            shippingEstimate: formatMoney(breakdown.shippingEstimate, currencyCode),
            appFee: formatMoney(breakdown.appFee, currencyCode),
            margin: formatMoney(breakdown.margin, currencyCode),
          };
        }),
      };
    }),
  );

  return {
    selectedCategories: merchant.selectedCategories,
    categoryFilter: categoryFilter ?? "",
    groups: groupViews,
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const merchant = await getOrCreateMerchant(session.shop);
  const formData = await request.formData();

  const partnerId = String(formData.get("partnerId"));
  const category = String(formData.get("category"));
  const region = String(formData.get("region"));
  const groupName = String(formData.get("groupName"));

  const product = await importCatalogGroup({
    admin: admin.graphql,
    merchantId: merchant.id,
    partnerId,
    category,
    region,
    groupName,
  });

  return { imported: true, productId: product.id, groupName };
};

type LoaderData = Awaited<ReturnType<typeof loader>>;
type CatalogGroupView = LoaderData["groups"][number];
type ActionData = Awaited<ReturnType<typeof action>>;

function CatalogCard({ group }: { group: CatalogGroupView }) {
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const isImporting = fetcher.state !== "idle";

  useEffect(() => {
    const data = fetcher.data as ActionData | undefined;
    if (data?.imported) {
      shopify.toast.show(`Imported "${data.groupName}"`);
    }
  }, [fetcher.data, shopify]);

  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack direction="block" gap="small">
        <s-heading>{group.name}</s-heading>
        <s-text>
          {group.partnerName} · {categoryLabel(group.category)} · {group.region}
        </s-text>
        <s-table variant="auto">
          <s-table-header-row>
            <s-table-header>Variant</s-table-header>
            <s-table-header>Base cost</s-table-header>
            <s-table-header>Shipping</s-table-header>
            <s-table-header>App fee</s-table-header>
            <s-table-header>Selling price</s-table-header>
            <s-table-header>Margin</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {group.items.map((item) => (
              <s-table-row key={item.sku}>
                <s-table-cell>{item.variant}</s-table-cell>
                <s-table-cell>{item.baseCost}</s-table-cell>
                <s-table-cell>{item.shippingEstimate}</s-table-cell>
                <s-table-cell>{item.appFee}</s-table-cell>
                <s-table-cell>{item.sellingPrice}</s-table-cell>
                <s-table-cell>{item.margin}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
        {group.alreadyImported ? (
          <s-badge tone="success">Imported</s-badge>
        ) : (
          <fetcher.Form method="post">
            <input type="hidden" name="partnerId" value={group.partnerId} />
            <input type="hidden" name="category" value={group.category} />
            <input type="hidden" name="region" value={group.region} />
            <input type="hidden" name="groupName" value={group.name} />
            <s-button type="submit" {...(isImporting ? { loading: true } : {})}>
              Import to Shopify
            </s-button>
          </fetcher.Form>
        )}
      </s-stack>
    </s-box>
  );
}

export default function Catalog() {
  const { groups, selectedCategories, categoryFilter } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Partner catalog">
      <s-button slot="primary-action" href="/app/products">
        View imported products
      </s-button>

      <s-section heading="Browse & import">
        <Form method="get">
          <s-select label="Category" name="category" value={categoryFilter}>
            <s-option value="">All connected categories</s-option>
            {selectedCategories.map((key) => (
              <s-option key={key} value={key}>
                {categoryLabel(key)}
              </s-option>
            ))}
          </s-select>
          <s-button type="submit">Filter</s-button>
        </Form>

        {groups.length === 0 ? (
          <s-banner heading="No catalog items available">
            <s-paragraph>
              No partner products match your connected partners/categories yet. Check{" "}
              <s-link href="/app/onboarding?step=partners">connected partners</s-link>.
            </s-paragraph>
          </s-banner>
        ) : (
          <s-stack direction="block" gap="base">
            {groups.map((group) => (
              <CatalogCard key={`${group.partnerId}:${group.category}:${group.region}:${group.name}`} group={group} />
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}
