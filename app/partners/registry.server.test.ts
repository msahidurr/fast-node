import { describe, expect, it } from "vitest";
import { getAdapter, listRegisteredPartnerKeys, registerAdapter } from "./registry.server";
import type { PartnerAdapter } from "./types";

describe("partner adapter registry", () => {
  it("has both reference adapters registered by default", () => {
    expect(listRegisteredPartnerKeys()).toEqual(expect.arrayContaining(["mock-rest", "csv-sftp"]));
  });

  it("throws a clear error for an unregistered partner key", () => {
    expect(() => getAdapter("does-not-exist")).toThrow(/No partner adapter registered/);
  });

  // Demonstrates NFR-8: a brand new partner integration can be plugged in by
  // registering an adapter object that satisfies PartnerAdapter -- nothing
  // about the registry (the routing/order core's lookup point) changes.
  it("supports registering a third adapter at runtime", async () => {
    const thirdPartyAdapter: PartnerAdapter = {
      partnerKey: "third-party-test",
      async getCatalog() {
        return [];
      },
      async getInventory(sku) {
        return { sku, available: true, quantity: 1 };
      },
      async createOrder() {
        return { partnerOrderId: "THIRD-1" };
      },
      async getOrderStatus() {
        return { status: "QUEUED" };
      },
      async submitDispute() {
        return { partnerDisputeId: "THIRD-DSP-1", status: "OPEN" };
      },
    };

    registerAdapter(thirdPartyAdapter);

    expect(getAdapter("third-party-test")).toBe(thirdPartyAdapter);
    const inventory = await getAdapter("third-party-test").getInventory("ANY-SKU");
    expect(inventory.available).toBe(true);
  });
});
