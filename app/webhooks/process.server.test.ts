import { beforeEach, describe, expect, it, vi } from "vitest";
import { computeBackoffMs, processWebhookEvent } from "./process.server";

vi.mock("../db.server", () => ({
  default: {
    webhookEvent: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import db from "../db.server";

const mockedDb = vi.mocked(db, true);

describe("computeBackoffMs", () => {
  it("doubles with each attempt", () => {
    expect(computeBackoffMs(0)).toBe(30_000);
    expect(computeBackoffMs(1)).toBe(60_000);
    expect(computeBackoffMs(2)).toBe(120_000);
  });

  it("caps the exponent so it never overflows", () => {
    expect(computeBackoffMs(100)).toBe(computeBackoffMs(8));
  });
});

describe("processWebhookEvent", () => {
  const baseEvent = {
    id: "evt_1",
    topic: "APP_UNINSTALLED",
    shop: "test.myshopify.com",
    correlationId: "corr_1",
    payload: {},
    status: "PENDING",
    attempts: 0,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("marks the event PROCESSED on success", async () => {
    mockedDb.webhookEvent.findUnique.mockResolvedValue(baseEvent as never);
    const handler = vi.fn().mockResolvedValue(undefined);

    await processWebhookEvent("evt_1", handler);

    expect(handler).toHaveBeenCalledWith({}, { shop: baseEvent.shop, topic: baseEvent.topic, correlationId: baseEvent.correlationId });
    expect(mockedDb.webhookEvent.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "PROCESSED" }) }),
    );
  });

  it("re-queues as PENDING with backoff when the handler throws and attempts remain", async () => {
    mockedDb.webhookEvent.findUnique.mockResolvedValue(baseEvent as never);
    const handler = vi.fn().mockRejectedValue(new Error("partner API down"));

    await processWebhookEvent("evt_1", handler);

    const updateCall = mockedDb.webhookEvent.update.mock.calls.at(-1)?.[0] as {
      data: { status: string; attempts: number };
    };
    expect(updateCall.data.status).toBe("PENDING");
    expect(updateCall.data.attempts).toBe(1);
  });

  it("marks the event FAILED once max attempts are exhausted", async () => {
    mockedDb.webhookEvent.findUnique.mockResolvedValue({ ...baseEvent, attempts: 5 } as never);
    const handler = vi.fn().mockRejectedValue(new Error("still down"));

    await processWebhookEvent("evt_1", handler);

    const updateCall = mockedDb.webhookEvent.update.mock.calls.at(-1)?.[0] as {
      data: { status: string; attempts: number };
    };
    expect(updateCall.data.status).toBe("FAILED");
    expect(updateCall.data.attempts).toBe(6);
  });

  it("is a no-op for an already-PROCESSED event", async () => {
    mockedDb.webhookEvent.findUnique.mockResolvedValue({ ...baseEvent, status: "PROCESSED" } as never);
    const handler = vi.fn();

    await processWebhookEvent("evt_1", handler);

    expect(handler).not.toHaveBeenCalled();
    expect(mockedDb.webhookEvent.update).not.toHaveBeenCalled();
  });
});
