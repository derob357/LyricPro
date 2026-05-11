import { describe, it, expect, vi } from "vitest";

vi.mock("stripe", () => {
  return {
    default: vi.fn().mockImplementation(() => ({})),
  };
});

import { handleInvoicePaymentFailed } from "./stripe-integration";

describe("handleInvoicePaymentFailed", () => {
  it("returns past_due signal with subscription id and amount", async () => {
    const invoice = {
      id: "in_test_777",
      subscription: "sub_test_777",
      amount_due: 999,
    } as never;
    const result = await handleInvoicePaymentFailed(invoice);
    expect(result).toEqual({
      type: "invoice_payment_failed",
      subscriptionId: "sub_test_777",
      invoiceId: "in_test_777",
      amountDue: 999,
    });
  });

  it("handles subscription as object instead of string", async () => {
    const invoice = {
      id: "in_test_888",
      subscription: { id: "sub_test_888" },
      amount_due: 1500,
    } as never;
    const result = await handleInvoicePaymentFailed(invoice);
    expect(result?.subscriptionId).toBe("sub_test_888");
  });

  it("returns undefined subscriptionId for one-off invoices not tied to a subscription", async () => {
    const invoice = {
      id: "in_test_999",
      subscription: null,
      amount_due: 500,
    } as never;
    const result = await handleInvoicePaymentFailed(invoice);
    expect(result?.subscriptionId).toBeUndefined();
  });
});
