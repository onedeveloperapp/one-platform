"use client";

import ClaimValueChoice from "./claim-value-choice";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Typography } from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import {
  autonomyErrorKey,
  type ClaimChoice,
  claimChoiceOf,
  type ClaimDefault,
  claimDefaultChanges,
  typedClaims,
} from "@/lib/firm/autonomy";
import { setFirmClaimDefault } from "@/lib/firm/autonomy-actions";
import { caseKindLabelKey } from "@/lib/modules/registry";
import type { CaseKind } from "@/lib/modules/types";

/** Reais as a person reads them: 10.000,00. */
const reais = (cents: number): string =>
  new Intl.NumberFormat("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(cents / 100);

/**
 * The Valor da Causa Pedido (migrations 0052 and 0064): the value each
 * claimant asks, by kind of problem, or none, and the lawsuits go with no
 * value for the judge to define. Where the firm gives a value, ONE writes it
 * for a claimant with none when the lawsuits are created; a value written on
 * a case is never changed. Who decides for the firm, with the second factor,
 * chooses, and saves the whole choice at once, as in the module's setup. Each
 * module's settings show the kinds of problem of the module (`kinds`), and
 * the values the firm gave for them. Closed, it says what the firm gave; it
 * opens by itself only when it could not be read.
 */
export default function ClaimValueCard({
  defaults,
  kinds,
  editable,
  onSaved,
}: {
  /** The values of the module's kinds of problem; null when they could not be read. */
  defaults: ClaimDefault[] | null;
  kinds: readonly CaseKind[];
  editable: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [saved, setSaved] = useState(false);

  return (
    <CollapsibleCard
      id="valor-da-causa-pedido-title"
      anchor="valor-da-causa-pedido"
      title={t("autonomy-claims-title")}
      summary={
        defaults === null
          ? t("autonomy-claims-load-error")
          : defaults.length > 0
            ? t("autonomy-claims-summary", { count: defaults.length, total: kinds.length })
            : t("autonomy-claims-summary-none")
      }
      description={t("autonomy-claims-body")}
      defaultOpen={defaults === null}
      bodyClassName="gap-3"
    >
      {defaults === null ? (
        <Alert
          severity="error"
          className="neutral bg-background-paper/60!"
          action={
            <Button color="inherit" size="small" onClick={onSaved}>
              {t("autonomy-retry")}
            </Button>
          }
        >
          {t("autonomy-claims-load-error")}
        </Alert>
      ) : editable ? (
        <ClaimValueForm
          // The values as the page read them last: what was saved starts again from it.
          key={defaults.map((row) => `${row.incident}:${row.cents}`).join(",")}
          defaults={defaults}
          kinds={kinds}
          onSaved={() => {
            setSaved(true);
            onSaved();
          }}
          onTouched={() => setSaved(false)}
        />
      ) : (
        <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
          {kinds.map((kind) => {
            const current = defaults.find((row) => row.incident === kind.key)?.cents ?? null;
            return (
              <Box component="li" key={kind.key} className="flex w-full flex-wrap items-center justify-between gap-2">
                <Typography variant="body1">{t(kind.labelKey)}</Typography>
                <Typography variant="body1" className={current === null ? "text-text-secondary" : undefined}>
                  {current === null ? t("autonomy-claims-none") : t("autonomy-claims-value", { value: reais(current) })}
                </Typography>
              </Box>
            );
          })}
        </Box>
      )}
      {saved && (
        <Alert severity="success" role="status" className="neutral bg-background-paper/60!">
          {t("autonomy-claims-saved")}
        </Alert>
      )}
    </CollapsibleCard>
  );
}

/** The firm's choice as the form holds it, saved at once: each kind whose value changed, said or taken back. */
function ClaimValueForm({
  defaults,
  kinds,
  onSaved,
  onTouched,
}: {
  defaults: ClaimDefault[];
  kinds: readonly CaseKind[];
  onSaved: () => void;
  onTouched: () => void;
}) {
  const t = useTranslations("product");
  const [choice, setChoice] = useState<ClaimChoice>(() => claimChoiceOf(defaults));
  const [typed, setTyped] = useState<Partial<Record<string, string>>>(() => typedClaims(defaults));
  const [busy, setBusy] = useState(false);
  // A refusal of the database by its code, or the kind typed with something that is no amount.
  const [problem, setProblem] = useState<{ code: string } | { invalid: string } | null>(null);
  const planned = claimDefaultChanges(
    choice,
    typed,
    defaults,
    kinds.map((kind) => kind.key),
  );
  const changed = !planned.ok || planned.changes.length > 0;

  const save = async () => {
    setProblem(null);
    if (!planned.ok) {
      setProblem({ invalid: planned.invalid });
      return;
    }
    setBusy(true);
    try {
      for (const change of planned.changes) {
        const result = await setFirmClaimDefault(change.incident, change.cents);
        if (!result.ok) {
          setProblem({ code: result.code });
          return;
        }
      }
      onSaved();
    } catch {
      setProblem({ code: "failed" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Box className="flex flex-col gap-3">
      <ClaimValueChoice
        id="settings-claim"
        choice={choice}
        typed={typed}
        kinds={kinds}
        disabled={busy}
        onChoice={(next) => {
          setChoice(next);
          setProblem(null);
          onTouched();
        }}
        onTyped={(incident, value) => {
          setTyped((before) => ({ ...before, [incident]: value }));
          onTouched();
        }}
      />
      {problem && (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
          {"invalid" in problem
            ? t("claims-invalid", { kind: t(caseKindLabelKey(problem.invalid) ?? "case-incident-other") })
            : t(autonomyErrorKey(problem.code))}
        </Alert>
      )}
      <Box>
        <Button variant="contained" size="small" disabled={busy || !changed} onClick={() => void save()}>
          {busy ? t("cases-working") : t("autonomy-claims-save")}
        </Button>
      </Box>
    </Box>
  );
}
