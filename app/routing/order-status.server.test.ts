import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.server", () => ({
  default: {
    order: { findUnique: vi.fn(), update: vi.fn() },
    fulfillment: { findMany: vi.fn() },
  },
}));

import db from "../db.server";
import { updateOrderStatus } from "./order-status.server";

const mockedDb = vi.mocked(db, true);

function makeOrder(overrides: Partial<{ status: string; lineItems: unknown[] }> = {}) {
  return { id: "order_1", status: "PENDING_ROUTING", lineItems: [{}, {}], ...overrides };
}

describe("updateOrderStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks the order ROUTING_FAILED when there are no fulfillments", async () => {
    mockedDb.order.findUnique.mockResolvedValue(makeOrder() as never);
    mockedDb.fulfillment.findMany.mockResolvedValue([]);

    await updateOrderStatus("order_1");

    expect(mockedDb.order.update).toHaveBeenCalledWith({ where: { id: "order_1" }, data: { status: "ROUTING_FAILED" } });
  });

  it("marks the order SUBMITTED when every line item is covered by a submitted fulfillment", async () => {
    mockedDb.order.findUnique.mockResolvedValue(makeOrder() as never);
    mockedDb.fulfillment.findMany.mockResolvedValue([
      { status: "QUEUED", lineItems: [{}, {}] },
    ] as never);

    await updateOrderStatus("order_1");

    expect(mockedDb.order.update).toHaveBeenCalledWith({ where: { id: "order_1" }, data: { status: "SUBMITTED" } });
  });

  it("marks the order PARTIALLY_SUBMITTED when only some items are covered", async () => {
    mockedDb.order.findUnique.mockResolvedValue(makeOrder() as never);
    mockedDb.fulfillment.findMany.mockResolvedValue([{ status: "QUEUED", lineItems: [{}] }] as never);

    await updateOrderStatus("order_1");

    expect(mockedDb.order.update).toHaveBeenCalledWith({
      where: { id: "order_1" },
      data: { status: "PARTIALLY_SUBMITTED" },
    });
  });

  it("marks the order PARTIALLY_SUBMITTED when a fulfillment is still pending/failed", async () => {
    mockedDb.order.findUnique.mockResolvedValue(makeOrder() as never);
    mockedDb.fulfillment.findMany.mockResolvedValue([{ status: "FAILED", lineItems: [{}, {}] }] as never);

    await updateOrderStatus("order_1");

    expect(mockedDb.order.update).toHaveBeenCalledWith({
      where: { id: "order_1" },
      data: { status: "PARTIALLY_SUBMITTED" },
    });
  });

  it("skips the write when status hasn't changed", async () => {
    mockedDb.order.findUnique.mockResolvedValue(makeOrder({ status: "SUBMITTED" }) as never);
    mockedDb.fulfillment.findMany.mockResolvedValue([{ status: "QUEUED", lineItems: [{}, {}] }] as never);

    await updateOrderStatus("order_1");

    expect(mockedDb.order.update).not.toHaveBeenCalled();
  });
});
