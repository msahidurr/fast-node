// Niche categories the app curates, per SRS Section 1.1/2.2. Fixed for v1 --
// see the SRS's Appendix B open question on launch category order, which this
// sidesteps by shipping all of them and letting merchants pick.
export const NICHE_CATEGORIES = [
  { key: "leather-goods", label: "Leather goods" },
  { key: "eco-packaging", label: "Eco-friendly packaging" },
  { key: "plus-size-apparel", label: "Plus-size apparel" },
  { key: "home-decor", label: "Home décor" },
  { key: "pet-products", label: "Pet products" },
] as const;

export type CategoryKey = (typeof NICHE_CATEGORIES)[number]["key"];

export function isCategoryKey(value: string): value is CategoryKey {
  return NICHE_CATEGORIES.some((category) => category.key === value);
}

export function categoryLabel(key: string): string {
  return NICHE_CATEGORIES.find((category) => category.key === key)?.label ?? key;
}
