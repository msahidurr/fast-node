import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.server", () => ({
  default: {
    merchant: { count: vi.fn() },
    partner: { findMany: vi.fn() },
    fulfillment: { findMany: vi.fn() },
  },
}));

import db from "../db.server";
import { getNetworkAnalytics } from "./analytics.server";

const mockedDb = vi.mocked(db, true);

const PARTNER = { id: "partner_1", name: "Mock Partner", active: true, slaHours: 48 };

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

describe("getNetworkAnalytics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns zeroed-out stats with no data", async () => {
    mockedDb.merchant.count.mockResolvedValue(0);
    mockedDb.partner.findMany.mockResolvedValue([]);
    mockedDb.fulfillment.findMany.mockResolvedValue([]);

    const result = await getNetworkAnalytics();

    expect(result).toEqual({ merchantCount: 0, partnerCount: 0, totalOrderVolume: 0, partners: [] });
  });

  it("computes order volume and error rate per partner", async () => {
    mockedDb.merchant.count.mockResolvedValue(2);
    mockedDb.partner.findMany.mockResolvedValue([PARTNER] as never);
    mockedDb.fulfillment.findMany.mockResolvedValue([
      { partnerId: "partner_1", status: "QUEUED", createdAt: hoursAgo(1), shippedAt: null, slaBreachNotifiedAt: null },
      { partnerId: "partner_1", status: "FAILED", createdAt: hoursAgo(2), shippedAt: null, slaBreachNotifiedAt: null },
      { partnerId: "partner_1", status: "SHIPPED", createdAt: hoursAgo(10), shippedAt: hoursAgo(1), slaBreachNotifiedAt: null },
    ] as never);

    const result = await getNetworkAnalytics();

    expect(result.totalOrderVolume).toBe(3);
    expect(result.partners[0].orderVolume).toBe(3);
    expect(result.partners[0].failedCount).toBe(1);
    expect(result.partners[0].errorRate).toBeCloseTo(1 / 3);
    expect(result.partners[0].shippedCount).toBe(1);
  });

  it("distinguishes SLA-adherent from SLA-breached shipments", async () => {
    mockedDb.merchant.count.mockResolvedValue(1);
    mockedDb.partner.findMany.mockResolvedValue([PARTNER] as never); // 48h SLA
    mockedDb.fulfillment.findMany.mockResolvedValue([
      // shipped in 10h -- within 48h SLA
      { partnerId: "partner_1", status: "SHIPPED", createdAt: hoursAgo(10), shippedAt: hoursAgo(0), slaBreachNotifiedAt: null },
      // took 60h to ship -- breached the 48h SLA
      { partnerId: "partner_1", status: "SHIPPED", createdAt: hoursAgo(60), shippedAt: hoursAgo(0), slaBreachNotifiedAt: new Date() },
      // still in flight, not shipped -- excluded from the adherence rate entirely
      { partnerId: "partner_1", status: "QUEUED", createdAt: hoursAgo(1), shippedAt: null, slaBreachNotifiedAt: null },
    ] as never);

    const result = await getNetworkAnalytics();
    const partner = result.partners[0];

    expect(partner.slaAdherentCount).toBe(1);
    expect(partner.slaBreachedCount).toBe(1);
    expect(partner.slaAdherenceRate).toBeCloseTo(0.5);
  });

  it("counts currently in-flight SLA breaches separately from historical adherence", async () => {
    mockedDb.merchant.count.mockResolvedValue(1);
    mockedDb.partner.findMany.mockResolvedValue([PARTNER] as never);
    mockedDb.fulfillment.findMany.mockResolvedValue([
      { partnerId: "partner_1", status: "IN_PRODUCTION", createdAt: hoursAgo(60), shippedAt: null, slaBreachNotifiedAt: hoursAgo(1) },
      { partnerId: "partner_1", status: "SHIPPED", createdAt: hoursAgo(60), shippedAt: hoursAgo(0), slaBreachNotifiedAt: hoursAgo(1) },
    ] as never);

    const result = await getNetworkAnalytics();

    expect(result.partners[0].inFlightBreaches).toBe(1); // only the still-in-flight one
  });

  it("reports null rates when there's no data to compute them from", async () => {
    mockedDb.merchant.count.mockResolvedValue(0);
    mockedDb.partner.findMany.mockResolvedValue([PARTNER] as never);
    mockedDb.fulfillment.findMany.mockResolvedValue([]);

    const result = await getNetworkAnalytics();

    expect(result.partners[0].errorRate).toBeNull();
    expect(result.partners[0].slaAdherenceRate).toBeNull();
  });
});
