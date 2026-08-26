import db from "../db.server";

// Every shop that installs the app gets a Merchant row for app-specific data
// (markup rules, plan tier, ...) alongside the Session row the Shopify SDK
// already manages for OAuth.
export function getOrCreateMerchant(shop: string) {
  return db.merchant.upsert({
    where: { shop },
    update: {},
    create: { shop },
  });
}
