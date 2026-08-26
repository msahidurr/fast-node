import { useEffect } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { useAppBridge } from "@shopify/app-bridge-react";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getOrCreateMerchant } from "../models/merchant.server";
import { generateMockup, MOCKUP_TEMPLATES } from "../catalog/mockup.server";
import { buildCostBreakdown, formatMoney, getShopCurrency, resolveMarkupRule } from "../catalog/pricing.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const merchant = await getOrCreateMerchant(session.shop);
  const [products, currencyCode] = await Promise.all([
    db.product.findMany({
      where: { merchantId: merchant.id },
      include: { partner: true },
      orderBy: { createdAt: "desc" },
    }),
    getShopCurrency(admin.graphql),
  ]);

  return {
    templates: MOCKUP_TEMPLATES.map((template) => ({ key: template.key, label: template.label })),
    products: await Promise.all(
      products.map(async (product) => {
        const rule = await resolveMarkupRule(merchant.id, product.category, product.id);
        const breakdown = buildCostBreakdown(Number(product.baseCost), Number(product.partner.shippingEstimate), rule);
        return {
          id: product.id,
          partnerSku: product.partnerSku,
          category: product.category,
          status: product.status,
          partnerName: product.partner.name,
          mockupUrl: product.mockupUrl,
          sellingPrice: formatMoney(breakdown.sellingPrice, currencyCode),
          baseCost: formatMoney(breakdown.baseCost, currencyCode),
          shippingEstimate: formatMoney(breakdown.shippingEstimate, currencyCode),
          appFee: formatMoney(breakdown.appFee, currencyCode),
          margin: formatMoney(breakdown.margin, currencyCode),
        };
      }),
    ),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await getOrCreateMerchant(session.shop);
  const formData = await request.formData();

  const productId = String(formData.get("productId"));
  const templateKey = String(formData.get("templateKey"));
  const artwork = formData.get("artwork");

  if (!(artwork instanceof File) || artwork.size === 0) {
    return { error: "Choose an artwork file first." };
  }

  const product = await db.product.findFirst({ where: { id: productId, merchantId: merchant.id } });
  if (!product) {
    return { error: "Product not found." };
  }

  const buffer = Buffer.from(await artwork.arrayBuffer());
  const mockup = await generateMockup(templateKey, buffer);
  await db.product.update({ where: { id: product.id }, data: { mockupUrl: mockup.url } });

  return { success: true as const, url: mockup.url };
};

type LoaderData = Awaited<ReturnType<typeof loader>>;
type ProductView = LoaderData["products"][number];
type TemplateView = LoaderData["templates"][number];
type ActionData = Awaited<ReturnType<typeof action>>;

function statusTone(status: string): "success" | "warning" | "critical" {
  if (status === "ACTIVE") return "success";
  if (status === "OUT_OF_STOCK") return "warning";
  return "critical";
}

function ProductRow({ product, templates }: { product: ProductView; templates: TemplateView[] }) {
  const fetcher = useFetcher<typeof action>();
  const shopify = useAppBridge();
  const isSubmitting = fetcher.state !== "idle";

  useEffect(() => {
    const data = fetcher.data as ActionData | undefined;
    if (data && "success" in data && data.success) {
      shopify.toast.show("Mockup generated");
    }
    if (data && "error" in data && data.error) {
      shopify.toast.show(data.error, { isError: true });
    }
  }, [fetcher.data, shopify]);

  return (
    <s-box padding="base" borderWidth="base" borderRadius="base">
      <s-stack direction="inline" gap="base">
        <s-stack direction="block" gap="small">
          <s-heading>{product.partnerSku}</s-heading>
          <s-text>
            {product.partnerName} · {product.category}
          </s-text>
          <s-badge tone={statusTone(product.status)}>{product.status}</s-badge>
        </s-stack>
        {product.mockupUrl && <s-thumbnail src={product.mockupUrl} alt="Generated mockup" />}
      </s-stack>
      <s-table variant="auto">
        <s-table-header-row>
          <s-table-header>Base cost</s-table-header>
          <s-table-header>Shipping</s-table-header>
          <s-table-header>App fee</s-table-header>
          <s-table-header>Selling price</s-table-header>
          <s-table-header>Margin</s-table-header>
        </s-table-header-row>
        <s-table-body>
          <s-table-row>
            <s-table-cell>{product.baseCost}</s-table-cell>
            <s-table-cell>{product.shippingEstimate}</s-table-cell>
            <s-table-cell>{product.appFee}</s-table-cell>
            <s-table-cell>{product.sellingPrice}</s-table-cell>
            <s-table-cell>{product.margin}</s-table-cell>
          </s-table-row>
        </s-table-body>
      </s-table>
      <s-link href="/app/pricing">Adjust markup</s-link>
      <fetcher.Form method="post" encType="multipart/form-data">
        <input type="hidden" name="productId" value={product.id} />
        <s-select name="templateKey" label="Mockup template">
          {templates.map((template) => (
            <s-option key={template.key} value={template.key}>
              {template.label}
            </s-option>
          ))}
        </s-select>
        <s-drop-zone name="artwork" label="Artwork" accept="image/*" />
        <s-button type="submit" {...(isSubmitting ? { loading: true } : {})}>
          Generate mockup
        </s-button>
      </fetcher.Form>
    </s-box>
  );
}

export default function Products() {
  const { products, templates } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Imported products">
      <s-section heading="Products">
        {products.length === 0 ? (
          <s-paragraph>
            Nothing imported yet. Go to the <s-link href="/app/catalog">catalog</s-link> to import a product.
          </s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {products.map((product) => (
              <ProductRow key={product.id} product={product} templates={templates} />
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}
