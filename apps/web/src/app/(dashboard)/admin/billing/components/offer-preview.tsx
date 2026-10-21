"use client";

import { RowLine, RowText } from "./catalog-shared";

export type OfferPlanRow = {
  slug: string;
  name: string;
  period: string | null;
  price_cents: number;
  currency: string;
  is_active: boolean;
  limits: Record<string, number> | null;
};

const PERIOD_WORD: Record<string, string> = { yearly: "ano", monthly: "mês", weekly: "semana" };

/**
 * What the visitor will actually SEE, resolved from the same plan rows the
 * offer page reads.
 *
 * A console that only writes settings hides its own typos, and the failure it
 * hides is silent by nature: a slug that matches no plan, or an inactive plan
 * that cannot be bought. The page shows the offer's price alone, never beside
 * a struck-through regular price (docs/PRODUCT.md, "Preço e vagas"), so there
 * is no anchor to preview.
 */
export default function OfferPreview({
  plans,
  planSlug,
  label,
}: {
  plans: OfferPlanRow[];
  planSlug: string;
  /** Where these numbers show up, for the operator reading the line. */
  label: string;
}) {
  const plan = plans.find((row) => row.slug === planSlug.trim()) ?? null;

  if (!plan) {
    return (
      <RowLine>
        <RowText
          primary={
            planSlug.trim() ? `Plano "${planSlug.trim()}" não encontrado no catálogo` : "Nenhum plano selecionado"
          }
          secondary={`${label} mostra o estado fechado até um plano ativo ser informado aqui.`}
        />
      </RowLine>
    );
  }

  const money = new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: plan.currency,
    maximumFractionDigits: 0,
  });
  const periodWord = plan.period ? (PERIOD_WORD[plan.period] ?? "ciclo") : "pagamento único";
  const devices = Number(plan.limits?.devices ?? 0);

  return (
    <RowLine>
      <RowText
        primary={`${label} mostra ${money.format(plan.price_cents / 100)} por ${periodWord}`}
        secondary={`${devices > 0 ? `${devices} dispositivo${devices === 1 ? "" : "s"}` : "sem dispositivo"}${
          plan.is_active ? "" : " · O PLANO ESTÁ INATIVO e não pode ser comprado"
        }`}
      />
    </RowLine>
  );
}
