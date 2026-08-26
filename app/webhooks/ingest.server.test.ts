import { beforeEach, describe, expect, it, vi } from "vitest";
import { Prisma } from "@prisma/client";

vi.mock("../db.server", () => ({
  default: {
    webhookEvent: {
      create: vi.fn(),
      findUniqueOrThrow: vi.fn(),
    },
  },
}));

import db from "../db.server";
import { ingestWebhook } from "./ingest.server";

const mockedDb = vi.mocked(db, true);

describe("ingestWebhook", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("creates a new WebhookEvent and returns duplicate: false", async () => {
    mockedDb.webhookEvent.create.mockResolvedValue({ id: "evt_1" } as never);

    const result = await ingestWebhook({
      webhookId: "wh_123",
      topic: "APP_UNINSTALLED",
      shop: "test.myshopify.com",
      payload: { foo: "bar" },
    });

    expect(result.duplicate).toBe(false);
    expect(result.eventId).toBe("evt_1");
    expect(mockedDb.webhookEvent.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ webhookId: "wh_123" }) }),
    );
  });

  it("returns the existing event and duplicate: true on a unique constraint violation", async () => {
    const conflictError = new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
      code: "P2002",
      clientVersion: "test",
    });
    mockedDb.webhookEvent.create.mockRejectedValue(conflictError);
    mockedDb.webhookEvent.findUniqueOrThrow.mockResolvedValue({
      id: "evt_existing",
      correlationId: "corr_existing",
    } as never);

    const result = await ingestWebhook({
      webhookId: "wh_123",
      topic: "APP_UNINSTALLED",
      shop: "test.myshopify.com",
      payload: {},
    });

    expect(result.duplicate).toBe(true);
    expect(result.eventId).toBe("evt_existing");
    expect(result.correlationId).toBe("corr_existing");
  });

  it("falls back to a synthetic dedupe key when no webhook id header is present", async () => {
    mockedDb.webhookEvent.create.mockResolvedValue({ id: "evt_2" } as never);

    await ingestWebhook({ webhookId: null, topic: "APP_UNINSTALLED", shop: "test.myshopify.com", payload: {} });

    const createArg = mockedDb.webhookEvent.create.mock.calls.at(-1)?.[0] as {
      data: { webhookId: string };
    };
    expect(createArg.data.webhookId).toContain("APP_UNINSTALLED:test.myshopify.com:");
  });
});
