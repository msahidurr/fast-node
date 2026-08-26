import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.server", () => ({
  default: {
    fulfillment: { findFirst: vi.fn() },
    dispute: { create: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
  },
}));

vi.mock("../partners/registry.server", () => ({
  getAdapter: vi.fn(),
}));

import db from "../db.server";
import { getAdapter } from "../partners/registry.server";
import { fileDispute, resolveDispute } from "./service.server";

const mockedDb = vi.mocked(db, true);
const mockedGetAdapter = vi.mocked(getAdapter);

describe("fileDispute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when the fulfillment doesn't belong to this merchant", async () => {
    mockedDb.fulfillment.findFirst.mockResolvedValue(null);

    await expect(fileDispute("merchant_1", "fulfillment_1", "DAMAGED", "box crushed")).rejects.toThrow(
      /not found/,
    );
  });

  it("submits to the partner adapter and records the dispute locally", async () => {
    mockedDb.fulfillment.findFirst.mockResolvedValue({
      id: "fulfillment_1",
      orderId: "order_1",
      partner: { partnerKey: "mock-rest" },
    } as never);
    const submitDispute = vi.fn().mockResolvedValue({ partnerDisputeId: "MOCK-DSP-1", status: "OPEN" });
    mockedGetAdapter.mockReturnValue({
      partnerKey: "mock-rest",
      getCatalog: vi.fn(),
      getInventory: vi.fn(),
      createOrder: vi.fn(),
      getOrderStatus: vi.fn(),
      submitDispute,
    } as never);

    await fileDispute("merchant_1", "fulfillment_1", "DAMAGED", "box crushed");

    expect(submitDispute).toHaveBeenCalledWith("order_1", "DAMAGED", "box crushed");
    expect(mockedDb.dispute.create).toHaveBeenCalledWith({
      data: {
        orderId: "order_1",
        fulfillmentId: "fulfillment_1",
        type: "DAMAGED",
        details: "box crushed",
        partnerDisputeId: "MOCK-DSP-1",
        status: "OPEN",
      },
    });
  });
});

describe("resolveDispute", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws when the dispute doesn't belong to this merchant", async () => {
    mockedDb.dispute.findFirst.mockResolvedValue(null);

    await expect(resolveDispute("merchant_1", "dispute_1", "RESOLVED", "Reprinted")).rejects.toThrow(/not found/);
  });

  it("updates status and resolution", async () => {
    mockedDb.dispute.findFirst.mockResolvedValue({ id: "dispute_1" } as never);

    await resolveDispute("merchant_1", "dispute_1", "RESOLVED", "Reprinted and reshipped");

    expect(mockedDb.dispute.update).toHaveBeenCalledWith({
      where: { id: "dispute_1" },
      data: { status: "RESOLVED", resolution: "Reprinted and reshipped" },
    });
  });
});
