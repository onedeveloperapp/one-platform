"use client";

import NextLink from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import EntryPanel from "@/app/(dashboard)/financeiro/entry-panel";
import OutcomeDialog from "@/components/product/outcome-dialog";
import NiMoney from "@/icons/nexture/ni-money";
import NiReceipt from "@/icons/nexture/ni-receipt";
import { readFinanceForAdd } from "@/lib/finance/actions";

/** What the "Adicionar" of the top writes in the books (0127). */
export type FinanceAddKind = "income" | "expense" | "transfer";

type Registrations = Extract<Awaited<ReturnType<typeof readFinanceForAdd>>, { ok: true }>["registrations"];
type State =
  | { kind: "loading" }
  | { kind: "ready"; registrations: Registrations }
  | { kind: "error" }
  | { kind: "saved" };

const DONE_KEY: Record<FinanceAddKind, string> = {
  income: "add-done-income-title",
  expense: "add-done-expense-title",
  transfer: "add-done-transfer-title",
};

/**
 * A new income, expense or transfer written from the "Adicionar" of the top, wherever the person is: the books' own
 * panel, with the accounts and the chart read when it opens. Once saved, what now holds is said in front of the person
 * (ONE joins it to the statement's line when it arrives), with the way to the entries.
 */
export default function FinanceAddPanel({ kind, onClose }: { kind: FinanceAddKind; onClose: () => void }) {
  const t = useTranslations("product");
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    readFinanceForAdd()
      .then((answer) => {
        if (live) setState(answer.ok ? { kind: "ready", registrations: answer.registrations } : { kind: "error" });
      })
      .catch(() => {
        if (live) setState({ kind: "error" });
      });
    return () => {
      live = false;
    };
  }, []);

  if (state.kind === "loading") return null;
  if (state.kind === "error") {
    return (
      <OutcomeDialog
        open
        tone="info"
        title={t("add-finance-error-title")}
        lines={[{ key: "why", icon: <NiMoney size="small" />, text: t("add-context-error") }]}
        closeLabel={t("add-done")}
        onClose={onClose}
      />
    );
  }
  if (state.kind === "saved") {
    return (
      <OutcomeDialog
        open
        title={t(DONE_KEY[kind])}
        lines={[
          { key: "join", icon: <NiReceipt size="small" />, text: t("add-done-finance-join") },
          {
            key: "list",
            icon: <NiMoney size="small" />,
            text: (
              <NextLink
                href="/financeiro/lancamentos"
                onClick={onClose}
                className="text-primary font-semibold underline"
              >
                {t("add-done-finance-open")}
              </NextLink>
            ),
          },
        ]}
        closeLabel={t("add-done")}
        onClose={onClose}
      />
    );
  }
  return (
    <EntryPanel
      kind={kind}
      registrations={state.registrations}
      onClose={onClose}
      onSaved={() => setState({ kind: "saved" })}
    />
  );
}
