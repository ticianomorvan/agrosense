import { expect, it } from "vitest";
import { normalizeReceipt } from "./receipts";

const id = "11111111-1111-4111-8111-111111111111";
const token = "22222222-2222-4222-8222-222222222222";
const payload = {
  phone_number_id: "123456",
  message: {
    id: "wamid.test",
    timestamp: "1789192800",
    to: "5493515551234",
    kapso: {
      direction: "outbound",
      status: "delivered",
      statuses: [
        {
          id: "wamid.test",
          status: "delivered",
          timestamp: "1789192860",
          recipient_id: "5493515551234",
          biz_opaque_callback_data: `agrosense:${id}:${token}`,
        },
      ],
    },
  },
};

it("reads the signed v2 body and raw status history for correlation", () => {
  expect(
    normalizeReceipt(payload, "whatsapp.message.delivered", "123456"),
  ).toEqual({
    phoneNumberId: "123456",
    messageId: "wamid.test",
    status: "delivered",
    occurredAt: new Date(1789192860 * 1000).toISOString(),
    recipient: "5493515551234",
    notificationId: id,
    token,
  });
});

it("ignores unrelated events and a different sending number", () => {
  expect(
    normalizeReceipt({}, "whatsapp.message.received", "123456"),
  ).toBeNull();
  expect(
    normalizeReceipt(payload, "whatsapp.message.delivered", "654321"),
  ).toBeNull();
});

it("does not trust an unsigned event header to upgrade a signed sent body", () => {
  expect(() =>
    normalizeReceipt(
      {
        ...payload,
        message: {
          ...payload.message,
          kapso: { direction: "outbound", status: "sent" },
        },
      },
      "whatsapp.message.delivered",
      "123456",
    ),
  ).toThrow();
});

it("supports receipts without callback data or a phone recipient", () => {
  const result = normalizeReceipt(
    {
      phone_number_id: "123456",
      message: {
        id: "wamid.test",
        timestamp: "1789192800",
        kapso: { direction: "outbound", status: "sent" },
      },
    },
    "whatsapp.message.sent",
    "123456",
  );
  expect(result).toMatchObject({
    notificationId: null,
    token: null,
    recipient: null,
  });
});

it("rejects conflicting callback tokens and mismatched recipients within a receipt", () => {
  expect(() =>
    normalizeReceipt(
      {
        ...payload,
        message: {
          ...payload.message,
          biz_opaque_callback_data: `agrosense:${id}:${id}`,
        },
      },
      "whatsapp.message.delivered",
      "123456",
    ),
  ).toThrow();
  expect(() =>
    normalizeReceipt(
      { ...payload, message: { ...payload.message, to: "5493515559999" } },
      "whatsapp.message.delivered",
      "123456",
    ),
  ).toThrow();
});
