import { randomBytes } from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import type { Session } from "@shopify/shopify-api";
import { withEncryption } from "./session-storage.server";

function makeFakeStorage(): SessionStorage & { data: Map<string, Session> } {
  const data = new Map<string, Session>();
  return {
    data,
    async storeSession(session) {
      data.set(session.id, session);
      return true;
    },
    async loadSession(id) {
      return data.get(id);
    },
    async deleteSession(id) {
      return data.delete(id);
    },
    async deleteSessions(ids) {
      ids.forEach((id) => data.delete(id));
      return true;
    },
    async findSessionsByShop(shop) {
      return Array.from(data.values()).filter((s) => s.shop === shop);
    },
  };
}

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "sess_1",
    shop: "test.myshopify.com",
    state: "state",
    isOnline: false,
    accessToken: "shpat_plain_token",
    ...overrides,
  } as Session;
}

describe("withEncryption", () => {
  beforeEach(() => {
    process.env.ENCRYPTION_KEY = randomBytes(32).toString("base64");
  });

  it("stores the access token encrypted, not in plaintext", async () => {
    const fake = makeFakeStorage();
    const storage = withEncryption(fake);

    await storage.storeSession(makeSession());

    expect(fake.data.get("sess_1")?.accessToken).not.toBe("shpat_plain_token");
  });

  it("decrypts the access token on load", async () => {
    const fake = makeFakeStorage();
    const storage = withEncryption(fake);

    await storage.storeSession(makeSession());
    const loaded = await storage.loadSession("sess_1");

    expect(loaded?.accessToken).toBe("shpat_plain_token");
  });

  it("decrypts across findSessionsByShop", async () => {
    const fake = makeFakeStorage();
    const storage = withEncryption(fake);

    await storage.storeSession(makeSession());
    const [found] = await storage.findSessionsByShop("test.myshopify.com");

    expect(found.accessToken).toBe("shpat_plain_token");
  });

  it("passes tokens through unchanged when ENCRYPTION_KEY is not set", async () => {
    delete process.env.ENCRYPTION_KEY;
    const fake = makeFakeStorage();
    const storage = withEncryption(fake);

    await storage.storeSession(makeSession());

    expect(fake.data.get("sess_1")?.accessToken).toBe("shpat_plain_token");
  });

  it("treats an already-plaintext token as-is instead of throwing on decrypt", async () => {
    const fake = makeFakeStorage();
    fake.data.set("sess_1", makeSession({ accessToken: "legacy-plaintext-token" }));
    const storage = withEncryption(fake);

    const loaded = await storage.loadSession("sess_1");

    expect(loaded?.accessToken).toBe("legacy-plaintext-token");
  });
});
