"use client";

import type { CaseState } from "../case-types";
import { useTranslations } from "next-intl";

import MoneyPath from "@/components/finance/money-path";
import MoneyShares from "@/components/finance/money-shares";
import CollapsibleCard from "@/components/product/collapsible-card";

type Ready = Extract<CaseState, { kind: "ready" }>;

/**
 * The money of the case (migration 0135), for who reads the books: each client's part of what the court released,
 * what the firm kept and why, what is passed on and by when, what is held. Shown once a release of the case is
 * received; ONE never pays.
 */
export default function MoneyCard({ state, onChanged }: { state: Ready; onChanged?: (saved?: boolean) => void }) {
  const t = useTranslations("product");
  const reads = state.financeLevel === "view" || state.financeLevel === "operate" || state.financeLevel === "configure";
  const received = (state.outcomes ?? []).some((fact) => fact.kind === "alvara" && fact.receivedOn !== null);
  // Money is expected (a settlement, a judgment won, a deposit, a release): the way it takes is said, and chosen, before
  // it arrives (0158).
  const expected = (state.outcomes ?? []).some(
    (fact) =>
      !fact.corrected &&
      (fact.kind === "acordo" ||
        fact.kind === "deposito" ||
        fact.kind === "alvara" ||
        (fact.kind === "sentenca" && (fact.result === "procedente" || fact.result === "parcial"))),
  );
  const writes = state.financeLevel === "operate" || state.financeLevel === "configure";
  if (!reads || (!received && !expected)) return null;
  return (
    <CollapsibleCard
      id="case-money"
      anchor="dinheiro"
      title={t("money-case-title")}
      description={t("money-case-description")}
      defaultOpen
    >
      <MoneyPath caseId={state.case.id} writes={writes} onChanged={onChanged} />
      {received ? <MoneyShares caseId={state.case.id} onChanged={onChanged} /> : null}
    </CollapsibleCard>
  );
}
