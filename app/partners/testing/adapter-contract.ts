import { describe, expect, it } from "vitest";
import type { PartnerAdapter } from "../types";

export interface AdapterContractSample {
  category: string;
  region: string;
  knownSku: string;
  unknownSku: string;
}

// Shared spec run against every reference adapter so they're proven
// interchangeable from the routing/order core's point of view (NFR-8) --
// see registry.server.test.ts for the accompanying pluggability check.
export function describePartnerAdapterContract(adapter: PartnerAdapter, sample: AdapterContractSample): void {
  describe(`PartnerAdapter contract: ${adapter.partnerKey}`, () => {
    it("getCatalog returns items matching the requested category/region", async () => {
      const items = await adapter.getCatalog(sample.category, sample.region);
      expect(items.length).toBeGreaterThan(0);
      for (const item of items) {
        expect(item.category).toBe(sample.category);
        expect(item.region).toBe(sample.region);
        expect(typeof item.sku).toBe("string");
        expect(typeof item.basePrice).toBe("number");
      }
    });

    it("getInventory reports availability for a known sku", async () => {
      const status = await adapter.getInventory(sample.knownSku);
      expect(status.sku).toBe(sample.knownSku);
      expect(typeof status.available).toBe("boolean");
    });

    it("getInventory reports unavailable for an unknown sku", async () => {
      const status = await adapter.getInventory(sample.unknownSku);
      expect(status.available).toBe(false);
    });

    it("createOrder + getOrderStatus round-trip", async () => {
      const { partnerOrderId } = await adapter.createOrder({
        shopifyOrderId: `test-order-${Date.now()}`,
        lineItems: [{ sku: sample.knownSku, quantity: 1 }],
        shippingAddress: {
          name: "Test Buyer",
          address1: "123 Test St",
          city: "Testville",
          countryCode: "US",
          zip: "00000",
        },
      });
      expect(partnerOrderId).toBeTruthy();

      const status = await adapter.getOrderStatus(partnerOrderId);
      expect(["QUEUED", "IN_PRODUCTION", "SHIPPED", "FAILED"]).toContain(status.status);
    });

    it("getOrderStatus rejects an unknown partner order id", async () => {
      await expect(adapter.getOrderStatus("does-not-exist")).rejects.toThrow();
    });

    it("submitDispute returns a dispute id and status", async () => {
      const result = await adapter.submitDispute("order-1", "DAMAGED", "box crushed in transit");
      expect(result.partnerDisputeId).toBeTruthy();
      expect(typeof result.status).toBe("string");
    });
  });
}
