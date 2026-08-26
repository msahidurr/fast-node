import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.server", () => ({
  default: {
    partner: { findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("../partners/registry.server", () => ({
  listRegisteredPartnerKeys: vi.fn(),
}));

vi.mock("../partners/config.server", () => ({
  encryptPartnerConfig: vi.fn((config: unknown) => `encrypted(${JSON.stringify(config)})`),
}));

import db from "../db.server";
import { listRegisteredPartnerKeys } from "../partners/registry.server";
import { createPartner, getAvailablePartnerKeys, updatePartner } from "./partner-management.server";

const mockedDb = vi.mocked(db, true);
const mockedListKeys = vi.mocked(listRegisteredPartnerKeys);

const BASE_INPUT = {
  partnerKey: "mock-rest",
  name: "Mock Partner",
  integrationType: "REST",
  pricingFeedFormat: "API",
  supportedCategories: ["leather-goods"],
  regions: ["US"],
  slaHours: 48,
  shippingEstimate: 4.99,
};

describe("getAvailablePartnerKeys", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("excludes partnerKeys that already have a Partner row", async () => {
    mockedListKeys.mockReturnValue(["mock-rest", "csv-sftp", "new-partner"]);
    mockedDb.partner.findMany.mockResolvedValue([{ partnerKey: "mock-rest" }, { partnerKey: "csv-sftp" }] as never);

    const available = await getAvailablePartnerKeys();

    expect(available).toEqual(["new-partner"]);
  });
});

describe("createPartner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedListKeys.mockReturnValue(["mock-rest", "csv-sftp"]);
  });

  it("throws when no adapter is registered for the given partnerKey", async () => {
    await expect(createPartner({ ...BASE_INPUT, partnerKey: "unregistered-partner" })).rejects.toThrow(
      /No adapter registered/,
    );
    expect(mockedDb.partner.create).not.toHaveBeenCalled();
  });

  it("creates the partner without credentials when none are given", async () => {
    mockedDb.partner.create.mockResolvedValue({ id: "partner_1" } as never);

    await createPartner(BASE_INPUT);

    expect(mockedDb.partner.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ partnerKey: "mock-rest", apiConfigEncrypted: null }),
    });
  });

  it("encrypts the credentials JSON when provided", async () => {
    mockedDb.partner.create.mockResolvedValue({ id: "partner_1" } as never);

    await createPartner({ ...BASE_INPUT, configJson: '{"apiKey":"secret"}' });

    expect(mockedDb.partner.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ apiConfigEncrypted: 'encrypted({"apiKey":"secret"})' }),
    });
  });
});

describe("updatePartner", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("only includes fields that were actually provided", async () => {
    mockedDb.partner.update.mockResolvedValue({ id: "partner_1" } as never);

    await updatePartner("partner_1", { name: "New Name" });

    expect(mockedDb.partner.update).toHaveBeenCalledWith({ where: { id: "partner_1" }, data: { name: "New Name" } });
  });

  it("encrypts credentials JSON when provided", async () => {
    mockedDb.partner.update.mockResolvedValue({ id: "partner_1" } as never);

    await updatePartner("partner_1", { configJson: '{"apiKey":"secret"}' });

    expect(mockedDb.partner.update).toHaveBeenCalledWith({
      where: { id: "partner_1" },
      data: { apiConfigEncrypted: 'encrypted({"apiKey":"secret"})' },
    });
  });

  it("updates the active flag independently", async () => {
    mockedDb.partner.update.mockResolvedValue({ id: "partner_1" } as never);

    await updatePartner("partner_1", { active: false });

    expect(mockedDb.partner.update).toHaveBeenCalledWith({ where: { id: "partner_1" }, data: { active: false } });
  });
});
