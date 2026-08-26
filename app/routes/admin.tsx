import type { LoaderFunctionArgs } from "react-router";
import { Link, Outlet } from "react-router";
import { requirePlatformAdmin } from "../admin/auth.server";

// Platform admin (FR-7.1/FR-7.3) is deliberately outside app/routes/app.* --
// it's not a Shopify-embedded, merchant-scoped surface (see auth.server.ts),
// so it doesn't get Shopify's App Bridge / Polaris web components either
// (those are injected by the embedded iframe host, which this page isn't
// running inside). Plain HTML/CSS instead of pretending otherwise.
export const loader = async ({ request }: LoaderFunctionArgs) => {
  requirePlatformAdmin(request);
  return null;
};

export default function AdminLayout() {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", color: "#1a1a1a", maxWidth: 1000, margin: "0 auto", padding: "24px" }}>
      <style>{`
        table { border-collapse: collapse; width: 100%; margin: 12px 0; }
        th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid #e1e1e1; font-size: 14px; }
        th { background: #f6f6f7; }
        nav a { margin-right: 16px; font-weight: 600; text-decoration: none; color: #2c6ecb; }
        nav a.active { color: #1a1a1a; }
        fieldset { border: 1px solid #e1e1e1; border-radius: 8px; padding: 16px; margin: 16px 0; }
        label { display: block; margin: 8px 0 4px; font-size: 13px; font-weight: 600; }
        input, select, textarea { width: 100%; max-width: 420px; padding: 6px 8px; font-size: 14px; box-sizing: border-box; }
        button { margin-top: 12px; padding: 8px 16px; font-size: 14px; cursor: pointer; }
        .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 12px; background: #f0f0f0; }
        .muted { color: #6b6b6b; font-size: 13px; }
      `}</style>
      <header>
        <h1>FastNode Platform Admin</h1>
        <nav>
          <Link to="/admin/partners">Partners</Link>
          <Link to="/admin/analytics">Analytics</Link>
        </nav>
      </header>
      <hr />
      <Outlet />
    </div>
  );
}
