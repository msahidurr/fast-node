import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { decryptPartnerConfig, encryptPartnerConfig } from "./config.server";

describe("partner config encryption", () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });

  it("round-trips a partner config object", () => {
    const config = { apiKey: "sk_live_abc123", endpoint: "https://partner.example.com" };
    const encrypted = encryptPartnerConfig(config);

    expect(encrypted).not.toContain("sk_live_abc123");
    expect(decryptPartnerConfig(encrypted)).toEqual(config);
  });
});
