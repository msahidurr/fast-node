import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { requirePlatformAdmin } from "./auth.server";

function basicAuthHeader(user: string, pass: string): string {
  return `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
}

function requestWithAuth(header?: string): Request {
  return new Request("https://example.com/admin/partners", {
    headers: header ? { Authorization: header } : {},
  });
}

describe("requirePlatformAdmin", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.PLATFORM_ADMIN_USERNAME = "ops";
    process.env.PLATFORM_ADMIN_PASSWORD = "hunter2";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("throws 503 when credentials aren't configured", () => {
    delete process.env.PLATFORM_ADMIN_USERNAME;
    delete process.env.PLATFORM_ADMIN_PASSWORD;

    try {
      requirePlatformAdmin(requestWithAuth());
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      expect((error as Response).status).toBe(503);
    }
  });

  it("throws 401 with a WWW-Authenticate challenge when no Authorization header is present", () => {
    try {
      requirePlatformAdmin(requestWithAuth());
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(Response);
      const response = error as Response;
      expect(response.status).toBe(401);
      expect(response.headers.get("WWW-Authenticate")).toMatch(/Basic/);
    }
  });

  it("throws 401 for a malformed Basic header (no colon)", () => {
    const header = `Basic ${Buffer.from("no-colon-here").toString("base64")}`;
    expect(() => requirePlatformAdmin(requestWithAuth(header))).toThrow();
  });

  it("throws 401 for wrong credentials", () => {
    expect(() => requirePlatformAdmin(requestWithAuth(basicAuthHeader("ops", "wrong")))).toThrow();
    expect(() => requirePlatformAdmin(requestWithAuth(basicAuthHeader("wrong", "hunter2")))).toThrow();
  });

  it("does not throw for correct credentials", () => {
    expect(() => requirePlatformAdmin(requestWithAuth(basicAuthHeader("ops", "hunter2")))).not.toThrow();
  });
});
