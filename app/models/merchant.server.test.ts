import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.server", () => ({
  default: { merchant: { upsert: vi.fn() } },
}));

import db from "../db.server";
import { getOrCreateMerchant } from "./merchant.server";

const mockedDb = vi.mocked(db, true);

describe("getOrCreateMerchant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("upserts by shop, leaving an existing row untouched", async () => {
    mockedDb.merchant.upsert.mockResolvedValue({ id: "m1", shop: "test.myshopify.com" } as never);

    await getOrCreateMerchant("test.myshopify.com");

    expect(mockedDb.merchant.upsert).toHaveBeenCalledWith({
      where: { shop: "test.myshopify.com" },
      update: {},
      create: { shop: "test.myshopify.com" },
    });
  });
});
