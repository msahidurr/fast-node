import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../db.server", () => ({
  default: {
    merchant: { findUnique: vi.fn() },
    merchantNotification: { create: vi.fn() },
  },
}));

vi.mock("./email.server", () => ({
  sendNotificationEmail: vi.fn(),
}));

import db from "../db.server";
import { sendNotificationEmail } from "./email.server";
import { notifyMerchant } from "./notify.server";

const mockedDb = vi.mocked(db, true);
const mockedSendNotificationEmail = vi.mocked(sendNotificationEmail);

describe("notifyMerchant", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedDb.merchantNotification.create.mockResolvedValue({ id: "notif_1" } as never);
  });

  it("always creates the in-app notification", async () => {
    mockedDb.merchant.findUnique.mockResolvedValue({ notificationEmail: null } as never);

    await notifyMerchant({ merchantId: "merchant_1", type: "OUT_OF_STOCK", message: "SKU-1 is out of stock" });

    expect(mockedDb.merchantNotification.create).toHaveBeenCalledWith({
      data: { merchantId: "merchant_1", type: "OUT_OF_STOCK", message: "SKU-1 is out of stock", metadata: undefined },
    });
  });

  it("sends an email when the merchant has a notification email set", async () => {
    mockedDb.merchant.findUnique.mockResolvedValue({ notificationEmail: "ops@example.com" } as never);

    await notifyMerchant({ merchantId: "merchant_1", type: "SLA_BREACH", message: "Order 1 breached SLA" });

    expect(mockedSendNotificationEmail).toHaveBeenCalledWith({
      to: "ops@example.com",
      subject: "[FastNode] sla breach",
      text: "Order 1 breached SLA",
    });
  });

  it("skips the email when no notification email is set", async () => {
    mockedDb.merchant.findUnique.mockResolvedValue({ notificationEmail: null } as never);

    await notifyMerchant({ merchantId: "merchant_1", type: "ROUTING_FAILURE", message: "Couldn't route" });

    expect(mockedSendNotificationEmail).not.toHaveBeenCalled();
  });
});
