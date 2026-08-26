import type { AdminGraphqlClient } from "@shopify/shopify-app-react-router/server";
import db from "../db.server";
import type { Prisma } from "@prisma/client";
import { getCatalogGroup } from "./catalog.server";
import { applyMarkup, resolveMarkupRule } from "./pricing.server";

interface ImportCatalogGroupArgs {
  admin: AdminGraphqlClient;
  merchantId: string;
  partnerId: string;
  category: string;
  region: string;
  groupName: string;
}

interface ProductCreateVariant {
  id: string;
  selectedOptions: { name: string; value: string }[];
}

interface ProductCreateResponse {
  data?: {
    productCreate?: {
      product?: { id: string; variants: { edges: { node: ProductCreateVariant }[] } } | null;
      userErrors?: { field: string[]; message: string }[];
    };
  };
}

interface VariantsBulkUpdateResponse {
  data?: {
    productVariantsBulkUpdate?: {
      userErrors?: { field: string[]; message: string }[];
    };
  };
}

// Imports a catalog group (FR-2.1) as a single Shopify product with one
// variant per partner SKU (FR-2.2), applying the merchant's markup rule --
// category override if one exists, else the merchant default (FR-3.1;
// product-level overrides can only be set after import, once the Product
// row exists) -- then records the partner-SKU <-> Shopify-variant mapping.
export async function importCatalogGroup({
  admin,
  merchantId,
  partnerId,
  category,
  region,
  groupName,
}: ImportCatalogGroupArgs) {
  const group = await getCatalogGroup(partnerId, category, region, groupName);
  if (!group) {
    throw new Error(`Catalog group "${groupName}" not found for this partner/category/region`);
  }

  const markup = await resolveMarkupRule(merchantId, category);

  const optionName = group.items[0]?.variants[0]?.option ?? "Variant";
  const optionValues = group.items.map((item) => item.variants[0]?.value ?? item.sku);

  const createResponse = await admin(
    `#graphql
    mutation importedProductCreate($product: ProductCreateInput!) {
      productCreate(product: $product) {
        product {
          id
          variants(first: 100) {
            edges { node { id selectedOptions { name value } } }
          }
        }
        userErrors { field message }
      }
    }`,
    {
      variables: {
        product: {
          title: group.name,
          productType: category,
          productOptions: [{ name: optionName, values: optionValues.map((value) => ({ name: value })) }],
        },
      },
    },
  );

  const createJson = (await createResponse.json()) as ProductCreateResponse;
  const userErrors = createJson.data?.productCreate?.userErrors ?? [];
  if (userErrors.length > 0) {
    throw new Error(`productCreate failed: ${userErrors.map((e) => e.message).join(", ")}`);
  }
  const product = createJson.data?.productCreate?.product;
  if (!product) {
    throw new Error("productCreate returned no product");
  }

  const variants = product.variants.edges.map((edge) => edge.node);
  const variantMap: Record<string, string> = {};
  const bulkVariantInputs: Array<{ id: string; price: string; inventoryItem: { sku: string } }> = [];

  for (const item of group.items) {
    const optionValue = item.variants[0]?.value ?? item.sku;
    const variant = variants.find((v) => v.selectedOptions.some((o) => o.value === optionValue));
    if (!variant) continue;

    variantMap[variant.id] = item.sku;
    bulkVariantInputs.push({
      id: variant.id,
      price: applyMarkup(item.basePrice, markup).toFixed(2),
      inventoryItem: { sku: item.sku },
    });
  }

  const updateResponse = await admin(
    `#graphql
    mutation importedProductVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        userErrors { field message }
      }
    }`,
    { variables: { productId: product.id, variants: bulkVariantInputs } },
  );

  const updateJson = (await updateResponse.json()) as VariantsBulkUpdateResponse;
  const updateErrors = updateJson.data?.productVariantsBulkUpdate?.userErrors ?? [];
  if (updateErrors.length > 0) {
    throw new Error(`productVariantsBulkUpdate failed: ${updateErrors.map((e) => e.message).join(", ")}`);
  }

  const baseCost = Math.min(...group.items.map((item) => item.basePrice));

  return db.product.create({
    data: {
      merchantId,
      partnerId,
      shopifyProductId: product.id,
      partnerSku: group.items[0].sku,
      category,
      variantMap: variantMap as Prisma.InputJsonValue,
      baseCost,
    },
  });
}
