"use client";

import type { CaseState } from "../case-types";
import { useTranslations } from "next-intl";

import MoneyShares from "@/components/finance/money-shares";
import CollapsibleCard from "@/components/product/collapsible-card";

type Ready = Extract<CaseState, { kind: "ready" }>;

/**
 * The money of the case (migration 0135), for who reads the books: each client's part of what the court released,
 * what the firm kept and why, what is passed on and by when, what is held. Shown once a release of the case is
 * received; ONE never pays.
 */
export default function MoneyCard({ state }: { state: Ready }) {
  const t = useTranslations("product");
  const reads = state.financeLevel === "view" || state.financeLevel === "operate" || state.financeLevel === "configure";
  const received = (state.outcomes ?? []).some((fact) => fact.kind === "alvara" && fact.receivedOn !== null);
  if (!reads || !received) return null;
  return (
    <CollapsibleCard
      id="case-money"
      anchor="dinheiro"
      title={t("money-case-title")}
      description={t("money-case-description")}
      defaultOpen
    >
      <MoneyShares caseId={state.case.id} />
    </CollapsibleCard>
  );
}
