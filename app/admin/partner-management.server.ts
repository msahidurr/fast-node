import db from "../db.server";
import { encryptPartnerConfig } from "../partners/config.server";
import { listRegisteredPartnerKeys } from "../partners/registry.server";

export interface PartnerInput {
  partnerKey: string;
  name: string;
  integrationType: string;
  pricingFeedFormat: string;
  supportedCategories: string[];
  regions: string[];
  slaHours: number;
  shippingEstimate: number;
  configJson?: string;
}

// A partner's adapter *code* has to already exist (NFR-8: adding a partner is
// data, not a routing/order-core change) -- this is the boundary of what
// platform-admin onboarding tooling can actually do without a deploy.
export async function getAvailablePartnerKeys(): Promise<string[]> {
  const used = new Set((await db.partner.findMany({ select: { partnerKey: true } })).map((p) => p.partnerKey));
  return listRegisteredPartnerKeys().filter((key) => !used.has(key));
}

// FR-7.1: onboards a new fulfillment partner -- categories, regions, SLA, and
// pricing feed format, plus (optionally) encrypted adapter credentials
// (NFR-4, reusing app/partners/config.server.ts from Phase 1).
export async function createPartner(input: PartnerInput) {
  const registered = listRegisteredPartnerKeys();
  if (!registered.includes(input.partnerKey)) {
    throw new Error(
      `No adapter registered for partnerKey "${input.partnerKey}" -- see app/partners/registry.server.ts.`,
    );
  }

  return db.partner.create({
    data: {
      partnerKey: input.partnerKey,
      name: input.name,
      integrationType: input.integrationType,
      pricingFeedFormat: input.pricingFeedFormat,
      supportedCategories: input.supportedCategories,
      regions: input.regions,
      slaHours: input.slaHours,
      shippingEstimate: input.shippingEstimate,
      apiConfigEncrypted: input.configJson ? encryptPartnerConfig(JSON.parse(input.configJson)) : null,
    },
  });
}

export async function updatePartner(
  partnerId: string,
  input: Partial<PartnerInput> & { active?: boolean },
) {
  const data: Record<string, unknown> = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.integrationType !== undefined) data.integrationType = input.integrationType;
  if (input.pricingFeedFormat !== undefined) data.pricingFeedFormat = input.pricingFeedFormat;
  if (input.supportedCategories !== undefined) data.supportedCategories = input.supportedCategories;
  if (input.regions !== undefined) data.regions = input.regions;
  if (input.slaHours !== undefined) data.slaHours = input.slaHours;
  if (input.shippingEstimate !== undefined) data.shippingEstimate = input.shippingEstimate;
  if (input.active !== undefined) data.active = input.active;
  if (input.configJson) data.apiConfigEncrypted = encryptPartnerConfig(JSON.parse(input.configJson));

  return db.partner.update({ where: { id: partnerId }, data });
}
