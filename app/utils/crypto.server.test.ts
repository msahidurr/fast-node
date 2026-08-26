import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./crypto.server";

describe("crypto.server", () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });

  it("round-trips a plaintext secret", () => {
    const plaintext = "partner-api-key-123";
    const encrypted = encryptSecret(plaintext);
    expect(encrypted).not.toContain(plaintext);
    expect(decryptSecret(encrypted)).toBe(plaintext);
  });

  it("produces a different ciphertext each time (random iv)", () => {
    const plaintext = "same-secret";
    expect(encryptSecret(plaintext)).not.toBe(encryptSecret(plaintext));
  });

  it("throws when ENCRYPTION_KEY is missing", () => {
    delete process.env.ENCRYPTION_KEY;
    expect(() => encryptSecret("x")).toThrow(/ENCRYPTION_KEY is not set/);
  });

  it("throws when ENCRYPTION_KEY is the wrong length", () => {
    process.env.ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");
    expect(() => encryptSecret("x")).toThrow(/32 bytes/);
  });

  it("fails to decrypt with a different key (auth tag mismatch)", () => {
    const encrypted = encryptSecret("secret");
    process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
    expect(() => decryptSecret(encrypted)).toThrow();
  });
});
