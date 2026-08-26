import nodemailer from "nodemailer";
import { logger } from "../utils/logger.server";

export function isEmailConfigured(): boolean {
  return Boolean(process.env.SMTP_URL && process.env.NOTIFICATIONS_FROM_EMAIL);
}

let transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter {
  if (!transporter) {
    transporter = nodemailer.createTransport(process.env.SMTP_URL);
  }
  return transporter;
}

export interface NotificationEmail {
  to: string;
  subject: string;
  text: string;
}

// FR-8.1's email half. Uses plain SMTP (via SMTP_URL) rather than a specific
// vendor API, so any provider works (SES, SendGrid, Mailgun, Postmark, ... all
// expose SMTP credentials) without tying the app to one. Fails safe: with no
// SMTP configured, this logs what would have been sent instead of throwing --
// same fallback shape as encryption (crypto.server.ts) and session storage.
export async function sendNotificationEmail(email: NotificationEmail): Promise<void> {
  if (!isEmailConfigured()) {
    logger.info("notification_email.not_configured", { to: email.to, subject: email.subject });
    return;
  }

  try {
    await getTransporter().sendMail({
      from: process.env.NOTIFICATIONS_FROM_EMAIL,
      to: email.to,
      subject: email.subject,
      text: email.text,
    });
    logger.info("notification_email.sent", { to: email.to, subject: email.subject });
  } catch (error) {
    logger.error("notification_email.failed", {
      to: email.to,
      subject: email.subject,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
