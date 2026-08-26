import { authenticate } from "../shopify.server";
import { ingestWebhook } from "./ingest.server";
import { processWebhookEvent, type WebhookHandler } from "./process.server";

// Shared entrypoint for every webhook route: authenticates + verifies HMAC via
// the Shopify SDK, durably records the event (idempotent on Shopify's webhook
// id), then processes it inline. Always acks Shopify with 200 -- failures are
// retried from our own queue, not Shopify's redelivery.
export async function handleShopifyWebhook(request: Request, handler: WebhookHandler): Promise<Response> {
  const { payload, topic, shop } = await authenticate.webhook(request);
  const webhookId = request.headers.get("X-Shopify-Webhook-Id");

  const { eventId, duplicate } = await ingestWebhook({ webhookId, topic, shop, payload });
  if (!duplicate) {
    await processWebhookEvent(eventId, handler);
  }

  return new Response();
}
