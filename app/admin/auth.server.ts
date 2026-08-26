import { timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

function unauthorizedResponse(): Response {
  return new Response("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="FastNode Platform Admin"' },
  });
}

// Platform admin (FR-7.1/FR-7.3) is a *different* audience from every other
// route in this app: it operates across merchants/partners, not within one
// shop's embedded session, so it can't use authenticate.admin() -- there's no
// Shopify identity for "the platform operator". Gated by HTTP Basic Auth
// against an env-configured credential pair instead: simple, but a real
// access-control check, not a stub. A production deployment serving multiple
// admin operators would want proper accounts/RBAC/audit logging on top of
// this -- flagged as a Phase 6 scope boundary, not solved here.
export function requirePlatformAdmin(request: Request): void {
  const configuredUser = process.env.PLATFORM_ADMIN_USERNAME;
  const configuredPass = process.env.PLATFORM_ADMIN_PASSWORD;
  if (!configuredUser || !configuredPass) {
    throw new Response(
      "Platform admin access is not configured. Set PLATFORM_ADMIN_USERNAME and PLATFORM_ADMIN_PASSWORD.",
      { status: 503 },
    );
  }

  const authHeader = request.headers.get("Authorization");
  if (!authHeader?.startsWith("Basic ")) {
    throw unauthorizedResponse();
  }

  const decoded = Buffer.from(authHeader.slice(6), "base64").toString("utf8");
  const separatorIndex = decoded.indexOf(":");
  if (separatorIndex === -1) {
    throw unauthorizedResponse();
  }
  const user = decoded.slice(0, separatorIndex);
  const pass = decoded.slice(separatorIndex + 1);

  if (!safeEqual(user, configuredUser) || !safeEqual(pass, configuredPass)) {
    throw unauthorizedResponse();
  }
}
