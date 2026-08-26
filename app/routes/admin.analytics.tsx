import type { LoaderFunctionArgs } from "react-router";
import { useLoaderData } from "react-router";
import { requirePlatformAdmin } from "../admin/auth.server";
import { getNetworkAnalytics } from "../admin/analytics.server";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  requirePlatformAdmin(request);
  return getNetworkAnalytics();
};

function pct(value: number | null): string {
  return value === null ? "-" : `${(value * 100).toFixed(1)}%`;
}

export default function AdminAnalytics() {
  const { merchantCount, partnerCount, totalOrderVolume, partners } = useLoaderData<typeof loader>();

  return (
    <div>
      <h2>Network analytics</h2>
      <p className="muted">
        {merchantCount} merchant(s) -- {partnerCount} partner(s) -- {totalOrderVolume} shipment(s) routed platform-wide.
      </p>

      <table>
        <thead>
          <tr>
            <th>Partner</th>
            <th>Order volume</th>
            <th>Shipped</th>
            <th>Error rate</th>
            <th>SLA adherence</th>
            <th>Currently breaching SLA</th>
          </tr>
        </thead>
        <tbody>
          {partners.map((partner) => (
            <tr key={partner.partnerId}>
              <td>
                {partner.partnerName} {!partner.active && <span className="badge">inactive</span>}
              </td>
              <td>{partner.orderVolume}</td>
              <td>{partner.shippedCount}</td>
              <td>{pct(partner.errorRate)}</td>
              <td>
                {pct(partner.slaAdherenceRate)}
                {partner.slaAdherentCount + partner.slaBreachedCount > 0 && (
                  <span className="muted">
                    {" "}
                    ({partner.slaAdherentCount}/{partner.slaAdherentCount + partner.slaBreachedCount} shipped on time)
                  </span>
                )}
              </td>
              <td>{partner.inFlightBreaches}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
