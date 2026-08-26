import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import db from "../db.server";
import { logger } from "../utils/logger.server";

interface IngestArgs {
  webhookId: string | null;
  topic: string;
  shop: string;
  payload: unknown;
}

interface IngestResult {
  eventId: string;
  correlationId: string;
  duplicate: boolean;
}

// Persists an inbound webhook before any processing happens, so delivery survives
// a crash and duplicate deliveries (Shopify retries, or the same webhook id
// arriving twice) are detected instead of double-processed (NFR-6).
export async function ingestWebhook({ webhookId, topic, shop, payload }: IngestArgs): Promise<IngestResult> {
  const correlationId = randomUUID();
  // Some CLI-triggered test deliveries omit the header; fall back to a unique key
  // rather than dropping the idempotency guarantee for real traffic.
  const dedupeKey = webhookId ?? `${topic}:${shop}:${randomUUID()}`;

  try {
    const event = await db.webhookEvent.create({
      data: {
        webhookId: dedupeKey,
        topic,
        shop,
        correlationId,
        payload: payload as Prisma.InputJsonValue,
      },
    });
    logger.info("webhook.ingested", { correlationId, topic, shop, eventId: event.id });
    return { eventId: event.id, correlationId, duplicate: false };
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const existing = await db.webhookEvent.findUniqueOrThrow({ where: { webhookId: dedupeKey } });
      logger.warn("webhook.duplicate", {
        correlationId: existing.correlationId,
        topic,
        shop,
        eventId: existing.id,
      });
      return { eventId: existing.id, correlationId: existing.correlationId, duplicate: true };
    }
    throw error;
  }
}
