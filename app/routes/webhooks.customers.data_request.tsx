import type { ActionFunctionArgs } from "react-router";
import { handleShopifyWebhook } from "../webhooks/route-handler.server";
import { handleCustomersDataRequest } from "../webhooks/handlers.server";

export const action = async ({ request }: ActionFunctionArgs) =>
  handleShopifyWebhook(request, handleCustomersDataRequest);
