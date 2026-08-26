import db from "../db.server";

export interface PartnerAnalytics {
  partnerId: string;
  partnerName: string;
  active: boolean;
  orderVolume: number;
  failedCount: number;
  errorRate: number | null;
  shippedCount: number;
  slaAdherentCount: number;
  slaBreachedCount: number;
  slaAdherenceRate: number | null;
  inFlightBreaches: number;
}

export interface NetworkAnalytics {
  merchantCount: number;
  partnerCount: number;
  totalOrderVolume: number;
  partners: PartnerAnalytics[];
}

// FR-7.3: order volume, SLA adherence, and error rates per partner, across
// every merchant on the platform (this is exactly the query a
// merchant-scoped route must never run -- see app/admin/auth.server.ts).
export async function getNetworkAnalytics(): Promise<NetworkAnalytics> {
  const [merchantCount, partners, fulfillments] = await Promise.all([
    db.merchant.count(),
    db.partner.findMany({ orderBy: { name: "asc" } }),
    db.fulfillment.findMany({
      select: { partnerId: true, status: true, createdAt: true, shippedAt: true, slaBreachNotifiedAt: true },
    }),
  ]);

  const partnerAnalytics: PartnerAnalytics[] = partners.map((partner) => {
    const partnerFulfillments = fulfillments.filter((f) => f.partnerId === partner.id);
    const orderVolume = partnerFulfillments.length;
    const failedCount = partnerFulfillments.filter((f) => f.status === "FAILED").length;
    const shippedCount = partnerFulfillments.filter((f) => f.status === "SHIPPED" || f.status === "DELIVERED").length;

    const shippedWithDates = partnerFulfillments.filter((f) => f.shippedAt);
    const slaMs = partner.slaHours * 60 * 60 * 1000;
    const slaAdherentCount = shippedWithDates.filter(
      (f) => f.shippedAt!.getTime() - f.createdAt.getTime() <= slaMs,
    ).length;
    const slaBreachedCount = shippedWithDates.length - slaAdherentCount;

    const inFlightBreaches = partnerFulfillments.filter(
      (f) => f.slaBreachNotifiedAt && f.status !== "SHIPPED" && f.status !== "DELIVERED",
    ).length;

    return {
      partnerId: partner.id,
      partnerName: partner.name,
      active: partner.active,
      orderVolume,
      failedCount,
      errorRate: orderVolume === 0 ? null : failedCount / orderVolume,
      shippedCount,
      slaAdherentCount,
      slaBreachedCount,
      slaAdherenceRate: shippedWithDates.length === 0 ? null : slaAdherentCount / shippedWithDates.length,
      inFlightBreaches,
    };
  });

  return {
    merchantCount,
    partnerCount: partners.length,
    totalOrderVolume: fulfillments.length,
    partners: partnerAnalytics,
  };
}
