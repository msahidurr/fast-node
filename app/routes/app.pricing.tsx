import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { useFetcher, useLoaderData } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { getOrCreateMerchant } from "../models/merchant.server";
import { categoryLabel } from "../catalog/categories";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await getOrCreateMerchant(session.shop);

  const [categoryRules, products] = await Promise.all([
    db.markupRule.findMany({ where: { merchantId: merchant.id, scope: "CATEGORY" } }),
    db.product.findMany({ where: { merchantId: merchant.id }, include: { markupRule: true } }),
  ]);
  const categoryRuleByKey = new Map(categoryRules.map((rule) => [rule.category, rule]));

  return {
    global: { type: merchant.defaultMarkupType, value: Number(merchant.defaultMarkupValue) },
    categories: merchant.selectedCategories.map((key) => {
      const rule = categoryRuleByKey.get(key);
      return {
        key,
        label: categoryLabel(key),
        override: rule ? { type: rule.type, value: Number(rule.value) } : null,
      };
    }),
    products: products.map((product) => ({
      id: product.id,
      partnerSku: product.partnerSku,
      category: product.category,
      override: product.markupRule ? { type: product.markupRule.type, value: Number(product.markupRule.value) } : null,
    })),
  };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  const merchant = await getOrCreateMerchant(session.shop);
  const formData = await request.formData();
  const intent = formData.get("intent");
  const type = String(formData.get("type") ?? "PERCENTAGE");
  const value = Number(formData.get("value") ?? 0);

  if (intent === "set-global") {
    await db.merchant.update({
      where: { id: merchant.id },
      data: { defaultMarkupType: type, defaultMarkupValue: value },
    });
    return { saved: "global" as const };
  }

  if (intent === "set-category") {
    const category = String(formData.get("category"));
    await db.markupRule.upsert({
      where: { merchantId_category: { merchantId: merchant.id, category } },
      update: { type, value },
      create: { merchantId: merchant.id, scope: "CATEGORY", category, type, value },
    });
    return { saved: "category" as const, category };
  }

  if (intent === "clear-category") {
    const category = String(formData.get("category"));
    await db.markupRule.deleteMany({ where: { merchantId: merchant.id, scope: "CATEGORY", category } });
    return { saved: "category" as const, category };
  }

  if (intent === "set-product") {
    const productId = String(formData.get("productId"));
    const product = await db.product.findFirst({ where: { id: productId, merchantId: merchant.id } });
    if (!product) return { error: "Product not found." };
    await db.markupRule.upsert({
      where: { productId },
      update: { type, value },
      create: { merchantId: merchant.id, scope: "PRODUCT", productId, type, value },
    });
    return { saved: "product" as const, productId };
  }

  if (intent === "clear-product") {
    const productId = String(formData.get("productId"));
    await db.markupRule.deleteMany({ where: { merchantId: merchant.id, scope: "PRODUCT", productId } });
    return { saved: "product" as const, productId };
  }

  return null;
};

type LoaderData = Awaited<ReturnType<typeof loader>>;

function MarkupForm({
  intent,
  hiddenFields,
  defaultType,
  defaultValue,
  hasOverride,
  clearIntent,
}: {
  intent: string;
  hiddenFields: Record<string, string>;
  defaultType: string;
  defaultValue: number;
  hasOverride: boolean;
  clearIntent?: string;
}) {
  const setFetcher = useFetcher();
  const clearFetcher = useFetcher();

  return (
    <s-stack direction="inline" gap="small">
      <setFetcher.Form method="post">
        <input type="hidden" name="intent" value={intent} />
        {Object.entries(hiddenFields).map(([name, value]) => (
          <input key={name} type="hidden" name={name} value={value} />
        ))}
        <s-select name="type" label="Type" labelAccessibilityVisibility="exclusive" value={defaultType}>
          <s-option value="PERCENTAGE">Percentage</s-option>
          <s-option value="FIXED">Fixed amount</s-option>
        </s-select>
        <s-number-field
          name="value"
          label="Value"
          labelAccessibilityVisibility="exclusive"
          value={String(defaultValue)}
          min={0}
          step={0.01}
        />
        <s-button type="submit" {...(setFetcher.state !== "idle" ? { loading: true } : {})}>
          Save
        </s-button>
      </setFetcher.Form>
      {hasOverride && clearIntent && (
        <clearFetcher.Form method="post">
          <input type="hidden" name="intent" value={clearIntent} />
          {Object.entries(hiddenFields).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <s-button type="submit" variant="tertiary" {...(clearFetcher.state !== "idle" ? { loading: true } : {})}>
            Use default
          </s-button>
        </clearFetcher.Form>
      )}
    </s-stack>
  );
}

export default function Pricing() {
  const { global, categories, products } = useLoaderData<typeof loader>();

  return (
    <s-page heading="Pricing & margin">
      <s-section heading="Global default markup">
        <s-paragraph>Applied to any product/category without its own override (FR-3.1).</s-paragraph>
        <MarkupForm
          intent="set-global"
          hiddenFields={{}}
          defaultType={global.type}
          defaultValue={global.value}
          hasOverride={false}
        />
      </s-section>

      <s-section heading="Category overrides">
        {categories.length === 0 ? (
          <s-paragraph>No categories selected yet -- pick some during onboarding.</s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {categories.map((category: LoaderData["categories"][number]) => (
              <s-box key={category.key} padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="small">
                  <s-text>
                    {category.label} {category.override ? "" : "(using global default)"}
                  </s-text>
                  <MarkupForm
                    intent="set-category"
                    clearIntent="clear-category"
                    hiddenFields={{ category: category.key }}
                    defaultType={category.override?.type ?? global.type}
                    defaultValue={category.override?.value ?? global.value}
                    hasOverride={Boolean(category.override)}
                  />
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>

      <s-section heading="Product overrides">
        {products.length === 0 ? (
          <s-paragraph>
            No products imported yet -- go to the <s-link href="/app/catalog">catalog</s-link>.
          </s-paragraph>
        ) : (
          <s-stack direction="block" gap="base">
            {products.map((product: LoaderData["products"][number]) => (
              <s-box key={product.id} padding="base" borderWidth="base" borderRadius="base">
                <s-stack direction="block" gap="small">
                  <s-text>
                    {product.partnerSku} ({categoryLabel(product.category)})
                    {product.override ? "" : " -- using category/global default"}
                  </s-text>
                  <MarkupForm
                    intent="set-product"
                    clearIntent="clear-product"
                    hiddenFields={{ productId: product.id }}
                    defaultType={product.override?.type ?? global.type}
                    defaultValue={product.override?.value ?? global.value}
                    hasOverride={Boolean(product.override)}
                  />
                </s-stack>
              </s-box>
            ))}
          </s-stack>
        )}
      </s-section>
    </s-page>
  );
}
