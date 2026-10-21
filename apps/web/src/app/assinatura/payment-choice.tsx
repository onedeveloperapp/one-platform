"use client";

import { useLocale, useTranslations } from "next-intl";

import { Box, Typography } from "@mui/material";

import NiCheck from "@/icons/nexture/ni-check";
import NiCreditCard from "@/icons/nexture/ni-credit-card";
import NiMoney from "@/icons/nexture/ni-money";
import { splitInstallments } from "@/lib/installments";
import { cn } from "@/lib/utils";
import type { PaymentMethod } from "@flyee/billing/types";

/**
 * Where the customer picks how to pay a BRL purchase (Asaas) — the step that
 * used to happen on the provider's invoice page.
 *
 * Moving it here is what removes boleto. Asaas has no way to offer a SUBSET of
 * methods on a charge, so the only way to not show boleto is to decide the
 * method BEFORE the charge exists.
 *
 *  - **A default is already chosen**: card, the method that renews by itself.
 *  - **The whole card is the target**, not a 20px radio.
 *  - **Installments show the instalment value, not the count.** "5x de R$ 458"
 *    is the number she is deciding about.
 */
export type PaymentChoiceValue = { method: PaymentMethod; installments: number };

export default function PaymentChoice({
  value,
  onChange,
  pixAvailable,
  maxInstallments,
  oneTime,
  priceCents,
  disabled,
}: {
  value: PaymentChoiceValue;
  onChange: (next: PaymentChoiceValue) => void;
  /** Pix is offered only where the account can actually charge it. */
  pixAvailable: boolean;
  /** The configured ceiling for this purchase; 1 when it cannot be split. */
  maxInstallments: number;
  /** A one-time purchase (the kit): nothing renews, by card or by PIX. */
  oneTime: boolean;
  priceCents: number;
  disabled?: boolean;
}) {
  const t = useTranslations("product");
  const locale = useLocale();
  const money = new Intl.NumberFormat(locale, { style: "currency", currency: "BRL" });
  const splittable = maxInstallments > 1;

  const methods: { id: PaymentMethod; title: string; hint: string; icon: React.ReactNode }[] = [
    {
      id: "credit_card",
      title: t("checkout-method-card"),
      // A purchase that can be split says so first: the one-time access can be.
      hint: splittable
        ? t("checkout-method-card-hint-split")
        : oneTime
          ? t("checkout-method-card-hint-once")
          : t("checkout-method-card-hint-renews"),
      icon: <NiCreditCard size="medium" />,
    },
    ...(pixAvailable
      ? [
          {
            id: "pix" as const,
            title: "PIX",
            // Beside a card that renews by itself, silence here would sell by
            // association a recurrence PIX does not have.
            hint: oneTime ? t("checkout-method-pix-hint-once") : t("checkout-method-pix-hint-renews"),
            icon: <NiMoney size="medium" />,
          },
        ]
      : []),
  ];

  const showInstallments = splittable && value.method === "credit_card";

  return (
    <Box className="flex flex-col gap-4">
      <Box
        role="radiogroup"
        aria-label={t("checkout-method-label")}
        className={cn("grid gap-3", methods.length > 1 ? "sm:grid-cols-2" : "sm:grid-cols-1")}
      >
        {methods.map((method) => {
          const selected = value.method === method.id;
          return (
            <Box
              key={method.id}
              component="button"
              type="button"
              role="radio"
              aria-checked={selected}
              disabled={disabled}
              onClick={() => onChange({ method: method.id, installments: 1 })}
              className={cn(
                "flex cursor-pointer flex-col items-start gap-1 rounded-2xl border p-4 text-left transition-colors",
                "disabled:cursor-not-allowed disabled:opacity-60",
                selected ? "border-primary bg-primary/5" : "border-grey-200 hover:border-grey-300 bg-transparent",
              )}
            >
              <Box className="flex w-full flex-row items-center gap-2">
                <span className={cn("flex", selected ? "text-primary" : "text-text-secondary")}>{method.icon}</span>
                <Typography variant="subtitle1" component="span" className="mb-0 font-semibold">
                  {method.title}
                </Typography>
                {selected && <NiCheck size="small" className="text-primary ml-auto" />}
              </Box>
              <Typography variant="body2" className="text-text-secondary">
                {method.hint}
              </Typography>
            </Box>
          );
        })}
      </Box>

      {showInstallments && (
        <Box className="flex flex-col gap-2">
          <Typography variant="body2" className="text-text-secondary">
            {t("checkout-installments-label")}
          </Typography>
          <Box role="radiogroup" aria-label={t("checkout-installments-aria")} className="flex flex-row flex-wrap gap-2">
            {Array.from({ length: maxInstallments }, (_, index) => index + 1).map((count) => {
              const selected = value.installments === count;
              // Rounded DOWN per instalment so the label never promises a
              // smaller total than the provider will charge; the remainder
              // lands on the last one, which is what Asaas does too (named
              // below when it differs).
              const perInstallment = splitInstallments(priceCents, count).each / 100;
              return (
                <Box
                  key={count}
                  component="button"
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  disabled={disabled}
                  onClick={() => onChange({ method: "credit_card", installments: count })}
                  className={cn(
                    "cursor-pointer rounded-xl border px-3 py-2 text-sm transition-colors",
                    "disabled:cursor-not-allowed disabled:opacity-60",
                    selected ? "border-primary bg-primary/5 text-primary" : "border-grey-200 text-text-secondary",
                  )}
                >
                  {count === 1
                    ? t("checkout-installments-once", { amount: money.format(priceCents / 100) })
                    : t("checkout-installments-split", { count, amount: money.format(perInstallment) })}
                </Box>
              );
            })}
          </Box>
          {value.installments > 1 &&
            splitInstallments(priceCents, value.installments).last !==
              splitInstallments(priceCents, value.installments).each && (
              // The cents that do not divide go to the last installment (Asaas):
              // said here, so the member is never charged a number they did not see.
              <Typography variant="body2" className="text-text-secondary text-xs leading-5">
                {t("checkout-installments-last", {
                  amount: money.format(splitInstallments(priceCents, value.installments).last / 100),
                })}
              </Typography>
            )}
          {value.installments > 1 && (
            // The one consequence she cannot see: a split purchase is a single
            // charge the issuer divides, so nothing renews at the end of it.
            <Typography variant="body2" className="text-text-secondary text-xs leading-5">
              {t("checkout-installments-note")}
            </Typography>
          )}
        </Box>
      )}
    </Box>
  );
}
