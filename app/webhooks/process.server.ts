import db from "../db.server";
import { logger } from "../utils/logger.server";

const MAX_ATTEMPTS = 6;
const BASE_DELAY_MS = 30_000; // 30s, doubling each attempt

export function computeBackoffMs(attempts: number): number {
  const exponent = Math.min(attempts, 8); // cap so the delay can't overflow/misbehave
  return BASE_DELAY_MS * 2 ** exponent;
}

export type WebhookHandler = (
  payload: unknown,
  ctx: { shop: string; topic: string; correlationId: string },
) => Promise<void>;

// Runs a single WebhookEvent through its handler and updates its durable status,
// so the retry worker (scripts/process-webhook-queue.ts) can pick failures back
// up on the computed backoff schedule instead of losing them (NFR-3, NFR-6).
// Never throws: a webhook route should still ack Shopify with 200 even when the
// handler fails, since our own queue -- not Shopify's redelivery -- owns retries.
export async function processWebhookEvent(eventId: string, handler: WebhookHandler): Promise<void> {
  const event = await db.webhookEvent.findUnique({ where: { id: eventId } });
  if (!event || event.status === "PROCESSED") return;

  await db.webhookEvent.update({ where: { id: eventId }, data: { status: "PROCESSING" } });

  try {
    await handler(event.payload, { shop: event.shop, topic: event.topic, correlationId: event.correlationId });
    await db.webhookEvent.update({
      where: { id: eventId },
      data: { status: "PROCESSED", processedAt: new Date() },
    });
    logger.info("webhook.processed", {
      correlationId: event.correlationId,
      topic: event.topic,
      shop: event.shop,
      eventId,
    });
  } catch (error) {
    const attempts = event.attempts + 1;
    const lastError = error instanceof Error ? error.message : String(error);
    const exhausted = attempts >= MAX_ATTEMPTS;
    await db.webhookEvent.update({
      where: { id: eventId },
      data: {
        status: exhausted ? "FAILED" : "PENDING",
        attempts,
        lastError,
        nextAttemptAt: new Date(Date.now() + computeBackoffMs(attempts)),
      },
    });
    logger.error("webhook.failed", {
      correlationId: event.correlationId,
      topic: event.topic,
      shop: event.shop,
      eventId,
      attempts,
      exhausted,
      lastError,
    });
  }
}
