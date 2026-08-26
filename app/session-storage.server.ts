import type { Session } from "@shopify/shopify-api";
import type { SessionStorage } from "@shopify/shopify-app-session-storage";
import { decryptSecret, encryptSecret, isEncryptionConfigured } from "./utils/crypto.server";
import { logger } from "./utils/logger.server";

let warnedMissingKey = false;

function encryptToken(value?: string): string | undefined {
  if (!value || !isEncryptionConfigured()) return value;
  return encryptSecret(value);
}

function decryptToken(value?: string): string | undefined {
  if (!value || !isEncryptionConfigured()) return value;
  try {
    return decryptSecret(value);
  } catch {
    // Written before encryption was enabled (or ENCRYPTION_KEY rotated) -- treat as
    // plaintext rather than breaking the session.
    return value;
  }
}

function cloneSession(session: Session): Session {
  return Object.assign(Object.create(Object.getPrototypeOf(session)), session) as Session;
}

// Wraps a SessionStorage implementation to encrypt Shopify access/refresh tokens
// at rest (NFR-4). Falls back to plaintext pass-through -- with a one-time
// warning -- when ENCRYPTION_KEY isn't configured, so local dev isn't forced to
// set it up before OAuth works.
export function withEncryption(storage: SessionStorage): SessionStorage {
  if (!isEncryptionConfigured() && !warnedMissingKey) {
    warnedMissingKey = true;
    logger.warn("session_storage.encryption_disabled", {
      reason: "ENCRYPTION_KEY not set; Shopify access tokens will be stored in plaintext",
    });
  }

  return {
    async storeSession(session) {
      const encrypted = cloneSession(session);
      encrypted.accessToken = encryptToken(session.accessToken);
      encrypted.refreshToken = encryptToken(session.refreshToken);
      return storage.storeSession(encrypted);
    },
    async loadSession(id) {
      const session = await storage.loadSession(id);
      if (!session) return undefined;
      session.accessToken = decryptToken(session.accessToken);
      session.refreshToken = decryptToken(session.refreshToken);
      return session;
    },
    deleteSession(id) {
      return storage.deleteSession(id);
    },
    deleteSessions(ids) {
      return storage.deleteSessions(ids);
    },
    async findSessionsByShop(shop) {
      const sessions = await storage.findSessionsByShop(shop);
      return sessions.map((session) => {
        session.accessToken = decryptToken(session.accessToken);
        session.refreshToken = decryptToken(session.refreshToken);
        return session;
      });
    },
  };
}
