import type { PartnerAdapter } from "./types";
import { mockRestAdapter } from "./adapters/mock-rest.adapter";
import { csvSftpAdapter } from "./adapters/csv-sftp.adapter";

// The pluggable seam for NFR-8: routing/order core code looks adapters up here
// by Partner.partnerKey and never imports a concrete adapter module directly.
// Onboarding a new partner means writing a new file under app/partners/adapters/
// and registering it here -- nothing in the routing/order core changes.
const registry = new Map<string, PartnerAdapter>();

export function registerAdapter(adapter: PartnerAdapter): void {
  registry.set(adapter.partnerKey, adapter);
}

export function getAdapter(partnerKey: string): PartnerAdapter {
  const adapter = registry.get(partnerKey);
  if (!adapter) {
    throw new Error(`No partner adapter registered for partnerKey "${partnerKey}"`);
  }
  return adapter;
}

export function listRegisteredPartnerKeys(): string[] {
  return Array.from(registry.keys());
}

registerAdapter(mockRestAdapter);
registerAdapter(csvSftpAdapter);
