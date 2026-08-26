import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mockRestAdapter } from "./mock-rest.adapter";
import { describePartnerAdapterContract } from "../testing/adapter-contract";

describePartnerAdapterContract(mockRestAdapter, {
  category: "leather-goods",
  region: "US",
  knownSku: "LTH-WALLET-BRN",
  unknownSku: "DOES-NOT-EXIST",
});

describe("mockRestAdapter order status progression", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("advances QUEUED -> IN_PRODUCTION -> SHIPPED (with tracking) as time passes, so FR-5.1/5.2 have something to poll", async () => {
    const { partnerOrderId } = await mockRestAdapter.createOrder({
      shopifyOrderId: "progression-test",
      lineItems: [{ sku: "LTH-WALLET-BRN", quantity: 1 }],
      shippingAddress: { name: "Test", address1: "1 St", city: "Town", countryCode: "US", zip: "00000" },
    });

    expect((await mockRestAdapter.getOrderStatus(partnerOrderId)).status).toBe("QUEUED");

    vi.advanceTimersByTime(16_000);
    expect((await mockRestAdapter.getOrderStatus(partnerOrderId)).status).toBe("IN_PRODUCTION");

    vi.advanceTimersByTime(15_000);
    const shipped = await mockRestAdapter.getOrderStatus(partnerOrderId);
    expect(shipped.status).toBe("SHIPPED");
    expect(shipped.trackingNumber).toBeTruthy();
    expect(shipped.carrier).toBe("Mock Post");
  });
});
