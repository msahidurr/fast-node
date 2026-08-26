import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sendMail = vi.fn().mockResolvedValue(undefined);
vi.mock("nodemailer", () => ({
  default: { createTransport: vi.fn(() => ({ sendMail })) },
}));

import { isEmailConfigured, sendNotificationEmail } from "./email.server";

describe("email.server", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("reports not configured when SMTP_URL/NOTIFICATIONS_FROM_EMAIL are unset", () => {
    delete process.env.SMTP_URL;
    delete process.env.NOTIFICATIONS_FROM_EMAIL;
    expect(isEmailConfigured()).toBe(false);
  });

  it("reports configured when both are set", () => {
    process.env.SMTP_URL = "smtp://localhost:1025";
    process.env.NOTIFICATIONS_FROM_EMAIL = "notifications@example.com";
    expect(isEmailConfigured()).toBe(true);
  });

  it("no-ops without calling nodemailer when not configured", async () => {
    delete process.env.SMTP_URL;
    delete process.env.NOTIFICATIONS_FROM_EMAIL;

    await sendNotificationEmail({ to: "merchant@example.com", subject: "Test", text: "Body" });

    expect(sendMail).not.toHaveBeenCalled();
  });

  it("sends via nodemailer when configured", async () => {
    process.env.SMTP_URL = "smtp://localhost:1025";
    process.env.NOTIFICATIONS_FROM_EMAIL = "notifications@example.com";

    await sendNotificationEmail({ to: "merchant@example.com", subject: "Test", text: "Body" });

    expect(sendMail).toHaveBeenCalledWith({
      from: "notifications@example.com",
      to: "merchant@example.com",
      subject: "Test",
      text: "Body",
    });
  });

  it("swallows a send failure instead of throwing", async () => {
    process.env.SMTP_URL = "smtp://localhost:1025";
    process.env.NOTIFICATIONS_FROM_EMAIL = "notifications@example.com";
    sendMail.mockRejectedValueOnce(new Error("connection refused"));

    await expect(
      sendNotificationEmail({ to: "merchant@example.com", subject: "Test", text: "Body" }),
    ).resolves.toBeUndefined();
  });
});
