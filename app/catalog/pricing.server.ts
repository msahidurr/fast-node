import type { AdminGraphqlClient } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";

export interface MarkupRule {
  type: string; // PERCENTAGE | FIXED
  value: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

// Applies a markup rule to a partner's base cost to get the price shown/
// charged in Shopify (FR-3.1).
export function applyMarkup(baseCost: number, rule: MarkupRule): number {
  const price = rule.type === "FIXED" ? baseCost + rule.value : baseCost * (1 + rule.value / 100);
  return round2(price);
}

// Resolves the markup rule that applies to a given product/category, in
// precedence order PRODUCT > CATEGORY > Merchant default (FR-3.1).
export async function resolveMarkupRule(
  merchantId: string,
  category: string,
  productId?: string,
): Promise<MarkupRule> {
  if (productId) {
    const productRule = await db.markupRule.findFirst({
      where: { merchantId, scope: "PRODUCT", productId },
    });
    if (productRule) return { type: productRule.type, value: Number(productRule.value) };
  }

  const categoryRule = await db.markupRule.findFirst({
    where: { merchantId, scope: "CATEGORY", category },
  });
  if (categoryRule) return { type: categoryRule.type, value: Number(categoryRule.value) };

  const merchant = await db.merchant.findUniqueOrThrow({ where: { id: merchantId } });
  return { type: merchant.defaultMarkupType, value: Number(merchant.defaultMarkupValue) };
}

// Platform fee taken on every sale, as a percentage of the marked-up selling
// price -- configurable since this is the app's own revenue model, not partner
// cost. Purely a display figure for now (FR-3.2); no billing integration
// charges it yet, see Phase 3 flags.
const APP_FEE_PERCENT = Number(process.env.APP_FEE_PERCENT ?? 5);

export interface CostBreakdown {
  baseCost: number;
  shippingEstimate: number;
  appFee: number;
  sellingPrice: number;
  margin: number;
}

// FR-3.2: base production cost, shipping estimate, app fee, resulting margin.
export function buildCostBreakdown(baseCost: number, shippingEstimate: number, rule: MarkupRule): CostBreakdown {
  const sellingPrice = applyMarkup(baseCost, rule);
  const appFee = round2(sellingPrice * (APP_FEE_PERCENT / 100));
  const margin = round2(sellingPrice - baseCost - shippingEstimate - appFee);
  return { baseCost, shippingEstimate, appFee, sellingPrice, margin };
}

// FR-3.3: multi-currency display consistent with the merchant's Shopify store.
export async function getShopCurrency(admin: AdminGraphqlClient): Promise<string> {
  const response = await admin(`#graphql
    query shopCurrency {
      shop { currencyCode }
    }`);
  const json = (await response.json()) as { data?: { shop?: { currencyCode?: string } } };
  return json.data?.shop?.currencyCode ?? "USD";
}

export function formatMoney(amount: number, currencyCode: string): string {
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: currencyCode }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currencyCode}`;
  }
}
