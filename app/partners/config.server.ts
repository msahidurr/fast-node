import { decryptSecret, encryptSecret } from "../utils/crypto.server";

// Encrypts a Partner's adapter-specific config (API keys, SFTP credentials, ...)
// for storage in Partner.apiConfigEncrypted (NFR-4).
export function encryptPartnerConfig(config: Record<string, unknown>): string {
  return encryptSecret(JSON.stringify(config));
}

export function decryptPartnerConfig<T = Record<string, unknown>>(encrypted: string): T {
  return JSON.parse(decryptSecret(encrypted)) as T;
}
