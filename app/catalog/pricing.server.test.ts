import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.server", () => ({
  default: {
    markupRule: { findFirst: vi.fn() },
    merchant: { findUniqueOrThrow: vi.fn() },
  },
}));

import db from "../db.server";
import { applyMarkup, buildCostBreakdown, formatMoney, getShopCurrency, resolveMarkupRule } from "./pricing.server";

const mockedDb = vi.mocked(db, true);

describe("applyMarkup", () => {
  it("applies a percentage markup", () => {
    expect(applyMarkup(10, { type: "PERCENTAGE", value: 50 })).toBe(15);
  });

  it("applies a fixed markup", () => {
    expect(applyMarkup(10, { type: "FIXED", value: 2.5 })).toBe(12.5);
  });

  it("rounds to two decimal places", () => {
    expect(applyMarkup(9.99, { type: "PERCENTAGE", value: 33 })).toBe(13.29);
  });
});

describe("resolveMarkupRule", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prefers a product-scoped rule over category or default", async () => {
    mockedDb.markupRule.findFirst.mockResolvedValueOnce({ type: "FIXED", value: 3 } as never);

    const rule = await resolveMarkupRule("merchant_1", "leather-goods", "product_1");

    expect(rule).toEqual({ type: "FIXED", value: 3 });
    expect(mockedDb.markupRule.findFirst).toHaveBeenCalledWith({
      where: { merchantId: "merchant_1", scope: "PRODUCT", productId: "product_1" },
    });
  });

  it("falls back to a category-scoped rule when no product rule exists", async () => {
    mockedDb.markupRule.findFirst
      .mockResolvedValueOnce(null) // product lookup
      .mockResolvedValueOnce({ type: "PERCENTAGE", value: 20 } as never); // category lookup

    const rule = await resolveMarkupRule("merchant_1", "leather-goods", "product_1");

    expect(rule).toEqual({ type: "PERCENTAGE", value: 20 });
  });

  it("falls back to the merchant default when no product or category rule exists", async () => {
    mockedDb.markupRule.findFirst.mockResolvedValue(null);
    mockedDb.merchant.findUniqueOrThrow.mockResolvedValue({
      defaultMarkupType: "PERCENTAGE",
      defaultMarkupValue: 15,
    } as never);

    const rule = await resolveMarkupRule("merchant_1", "leather-goods");

    expect(rule).toEqual({ type: "PERCENTAGE", value: 15 });
  });

  it("skips the product lookup entirely when no productId is given", async () => {
    mockedDb.markupRule.findFirst.mockResolvedValue({ type: "FIXED", value: 1 } as never);

    await resolveMarkupRule("merchant_1", "leather-goods");

    expect(mockedDb.markupRule.findFirst).toHaveBeenCalledTimes(1);
    expect(mockedDb.markupRule.findFirst).toHaveBeenCalledWith({
      where: { merchantId: "merchant_1", scope: "CATEGORY", category: "leather-goods" },
    });
  });
});

describe("buildCostBreakdown", () => {
  it("computes selling price, app fee, and margin", () => {
    const breakdown = buildCostBreakdown(10, 5, { type: "PERCENTAGE", value: 50 });

    expect(breakdown.baseCost).toBe(10);
    expect(breakdown.shippingEstimate).toBe(5);
    expect(breakdown.sellingPrice).toBe(15);
    expect(breakdown.appFee).toBe(0.75); // 5% of 15
    expect(breakdown.margin).toBe(-0.75); // 15 - 10 - 5 - 0.75
  });
});

describe("formatMoney", () => {
  it("formats an amount in the given currency", () => {
    expect(formatMoney(15, "USD")).toBe("$15.00");
  });

  it("falls back to a plain number + code for an invalid currency", () => {
    expect(formatMoney(15, "NOT_A_CURRENCY")).toBe("15.00 NOT_A_CURRENCY");
  });
});

describe("getShopCurrency", () => {
  it("returns the shop's currency code", async () => {
    const admin = vi.fn().mockResolvedValue({
      json: async () => ({ data: { shop: { currencyCode: "CAD" } } }),
    });

    expect(await getShopCurrency(admin as never)).toBe("CAD");
  });

  it("falls back to USD when the response has no currency", async () => {
    const admin = vi.fn().mockResolvedValue({ json: async () => ({}) });

    expect(await getShopCurrency(admin as never)).toBe("USD");
  });
});
