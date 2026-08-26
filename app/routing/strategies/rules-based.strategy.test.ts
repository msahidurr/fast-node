import { describe, expect, it } from "vitest";
import { rulesBasedStrategy } from "./rules-based.strategy";
import type { RoutingCandidate } from "../types";

function candidate(overrides: Partial<RoutingCandidate> = {}): RoutingCandidate {
  return {
    partnerId: "partner_1",
    sku: "SKU-1",
    available: true,
    slaHours: 48,
    costEstimate: 20,
    regionSupported: true,
    ...overrides,
  };
}

describe("rulesBasedStrategy", () => {
  it("returns NO_CANDIDATES when there are none", () => {
    const result = rulesBasedStrategy.select([]);
    expect(result).toEqual({ selectedPartnerId: null, reasonCode: "NO_CANDIDATES", costEstimate: null, slaEstimateHours: null });
  });

  it("returns OUT_OF_STOCK when every candidate is unavailable but region-supported", () => {
    const result = rulesBasedStrategy.select([candidate({ available: false })]);
    expect(result.selectedPartnerId).toBeNull();
    expect(result.reasonCode).toBe("OUT_OF_STOCK");
  });

  it("returns NO_REGION_MATCH when every candidate is out of region", () => {
    const result = rulesBasedStrategy.select([candidate({ regionSupported: false })]);
    expect(result.selectedPartnerId).toBeNull();
    expect(result.reasonCode).toBe("NO_REGION_MATCH");
  });

  it("picks the cheapest eligible candidate", () => {
    const cheap = candidate({ partnerId: "cheap", costEstimate: 10 });
    const pricey = candidate({ partnerId: "pricey", costEstimate: 25 });

    const result = rulesBasedStrategy.select([pricey, cheap]);

    expect(result.selectedPartnerId).toBe("cheap");
    expect(result.reasonCode).toBe("LOWEST_COST");
    expect(result.costEstimate).toBe(10);
  });

  it("breaks a cost tie by SLA hours", () => {
    const slow = candidate({ partnerId: "slow", costEstimate: 15, slaHours: 96 });
    const fast = candidate({ partnerId: "fast", costEstimate: 15, slaHours: 24 });

    const result = rulesBasedStrategy.select([slow, fast]);

    expect(result.selectedPartnerId).toBe("fast");
    expect(result.slaEstimateHours).toBe(24);
  });

  it("ignores unavailable/out-of-region candidates when a valid one exists", () => {
    const bad = candidate({ partnerId: "bad", available: false, costEstimate: 1 });
    const good = candidate({ partnerId: "good", costEstimate: 30 });

    const result = rulesBasedStrategy.select([bad, good]);

    expect(result.selectedPartnerId).toBe("good");
  });
});
