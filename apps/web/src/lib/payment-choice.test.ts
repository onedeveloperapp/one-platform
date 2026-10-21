import { resolvePaymentChoice } from "./payment-choice";
import { describe, expect, it } from "vitest";

const yearlyBrl = { planPeriod: "yearly", planKind: "recurring" as const, currency: "BRL", maxInstallments: 12 };
const accessBrl = { planPeriod: null, planKind: "access" as const, currency: "BRL", maxInstallments: 12 };

describe("resolvePaymentChoice", () => {
  it("passes a card purchase on an annual BRL plan through with its instalments", () => {
    expect(resolvePaymentChoice({ ...yearlyBrl, method: "credit_card", installments: 5 })).toEqual({
      method: "credit_card",
      installments: 5,
    });
  });

  it("clamps a crafted request to the instalments actually on offer", () => {
    expect(
      resolvePaymentChoice({ ...yearlyBrl, maxInstallments: 6, method: "credit_card", installments: 12 }).installments,
    ).toBe(6);
    expect(resolvePaymentChoice({ ...yearlyBrl, method: "credit_card", installments: 0 }).installments).toBe(1);
    expect(resolvePaymentChoice({ ...yearlyBrl, method: "credit_card", installments: -3 }).installments).toBe(1);
  });

  it("never exceeds the providers' ceiling, whatever the setting says", () => {
    expect(
      resolvePaymentChoice({ ...yearlyBrl, maxInstallments: 48, method: "credit_card", installments: 48 }).installments,
    ).toBe(12);
  });

  it("turns instalments off when the setting is 1", () => {
    expect(
      resolvePaymentChoice({ ...yearlyBrl, maxInstallments: 1, method: "credit_card", installments: 5 }).installments,
    ).toBe(1);
  });

  it("refuses to split a MONTHLY plan — that would sell a year of cycles for one month", () => {
    expect(
      resolvePaymentChoice({ ...yearlyBrl, planPeriod: "monthly", method: "credit_card", installments: 5 })
        .installments,
    ).toBe(1);
  });

  it("splits the one-time access on a card, up to the ceiling", () => {
    expect(resolvePaymentChoice({ ...accessBrl, method: "credit_card", installments: 12 })).toEqual({
      method: "credit_card",
      installments: 12,
    });
    expect(
      resolvePaymentChoice({ ...accessBrl, maxInstallments: 1, method: "credit_card", installments: 12 }).installments,
    ).toBe(1);
    expect(resolvePaymentChoice({ ...accessBrl, method: "pix", installments: 12 }).installments).toBe(1);
  });

  it("refuses to split a one-time purchase that is not the access", () => {
    expect(
      resolvePaymentChoice({ ...yearlyBrl, planPeriod: null, method: "credit_card", installments: 3 }).installments,
    ).toBe(1);
  });

  it("refuses to split a Pix purchase, which Asaas would turn into five manual charges", () => {
    expect(resolvePaymentChoice({ ...yearlyBrl, method: "pix", installments: 5 })).toEqual({
      method: "pix",
      installments: 1,
    });
  });

  it("lets Stripe choose the method in USD, without instalments", () => {
    expect(
      resolvePaymentChoice({
        planPeriod: "yearly",
        planKind: "recurring",
        currency: "USD",
        maxInstallments: 12,
        method: "pix",
        installments: 5,
      }),
    ).toEqual({ method: undefined, installments: 1 });
  });

  it("ignores a method it does not know instead of forwarding it to the provider", () => {
    expect(resolvePaymentChoice({ ...yearlyBrl, method: "boleto", installments: 1 }).method).toBeUndefined();
    expect(resolvePaymentChoice({ ...yearlyBrl, method: null, installments: 1 }).method).toBeUndefined();
  });

  it("survives junk in the instalment field", () => {
    expect(resolvePaymentChoice({ ...yearlyBrl, method: "credit_card", installments: Number.NaN }).installments).toBe(
      1,
    );
    expect(resolvePaymentChoice({ ...yearlyBrl, method: "credit_card", installments: 2.9 }).installments).toBe(2);
  });
});
