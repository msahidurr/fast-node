import type { Prisma } from "@prisma/client";
import db from "../db.server";
import { sendNotificationEmail } from "./email.server";

export interface NotifyMerchantArgs {
  merchantId: string;
  type: string; // OUT_OF_STOCK | DISCONTINUED | ROUTING_FAILURE | SLA_BREACH | NEW_PRODUCTS
  message: string;
  metadata?: Prisma.InputJsonValue;
}

// FR-8.1: every merchant notification (low stock, routing failures, SLA
// breaches, new niche products) goes through here so in-app + email always
// stay in sync -- callers shouldn't reach for db.merchantNotification.create
// directly.
export async function notifyMerchant({ merchantId, type, message, metadata }: NotifyMerchantArgs): Promise<void> {
  const [merchant] = await Promise.all([
    db.merchant.findUnique({ where: { id: merchantId }, select: { notificationEmail: true } }),
    db.merchantNotification.create({ data: { merchantId, type, message, metadata } }),
  ]);

  if (merchant?.notificationEmail) {
    await sendNotificationEmail({
      to: merchant.notificationEmail,
      subject: `[FastNode] ${type.replace(/_/g, " ").toLowerCase()}`,
      text: message,
    });
  }
}
