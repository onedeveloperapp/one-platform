"use client";

import type { CaseState } from "../case-types";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, MenuItem, TextField, Typography } from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import { CurrencyField } from "@/components/product/fields";
import QuickActions from "@/components/product/quick-actions";
import SidePanel from "@/components/product/side-panel";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import NiScale from "@/icons/nexture/ni-scale";
import { setCaseStatus } from "@/lib/cases/actions";
import { acknowledgeCaseClosure, actOnLawsuitFact, saveLawsuitFact } from "@/lib/cases/outcome-actions";
import {
  FACT_KEY,
  FACT_KINDS,
  type FactKind,
  factValue,
  type LawsuitFact,
  type LawsuitOutcome,
  lawsuitOutcome,
  RESULT_KEY,
} from "@/lib/cases/outcomes";
import { formatCnj } from "@flyee/rules/cnj";
import { formatCents, parseCents } from "@flyee/rules/finance";

type Ready = Extract<CaseState, { kind: "ready" }>;

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const brDay = (iso: string) => iso.split("-").reverse().join("/");

const OUTCOME_KEY: Record<LawsuitOutcome, string> = {
  archived: "outcome-standing-archived",
  final: "outcome-standing-final",
  judged: "outcome-standing-judged",
  settled: "outcome-standing-settled",
  open: "outcome-standing-open",
};
const ACK_WORDS = { against: "outcome-ack-against", course: "outcome-ack-owed" } as const;
const APPEAL_KEY = { autor: "outcome-appeal-autor", re: "outcome-appeal-re" } as const;
const ERROR_KEY: Record<string, string> = {
  not_allowed: "outcome-error-not-allowed",
  support_visit: "outcome-error-support",
  fact_exists: "outcome-error-exists",
  not_filed: "outcome-error-not-filed",
  invalid_data: "outcome-error-invalid",
};
const errorKey = (code: string) => ERROR_KEY[code] ?? "outcome-error-failed";

/** One fact as a line: what it is, its value and day, whose it is, and the court's words beside it. */
/** A fact that asks the firm: ONE's reading to confirm, the awareness owed, or what a release paid to register. */
const factAsks = (fact: LawsuitFact) =>
  !fact.corrected &&
  (!fact.confirmed || (fact.ackOwed && !fact.ackedAt) || (fact.kind === "alvara" && !fact.receivedOn));

function FactLine({
  fact,
  writable,
  onAct,
  lawsuit,
}: {
  fact: LawsuitFact;
  writable: boolean;
  onAct: (fact: LawsuitFact, action: "ack" | "confirm" | "received" | "correct") => void;
  /** The lawsuit it is of, said when the line stands away from its lawsuit (among what asks the firm). */
  lawsuit?: string;
}) {
  const t = useTranslations("product");
  const ackWords = ACK_WORDS[fact.kind === "sentenca" ? "against" : "course"];
  const what = [
    t(FACT_KEY[fact.kind]),
    fact.result ? t(RESULT_KEY[fact.result]) : null,
    fact.appealBy ? t(APPEAL_KEY[fact.appealBy]) : null,
    factValue(fact),
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <Box component="li" className="border-grey-100 flex flex-col gap-1 border-b py-3 last:border-b-0">
      <Box className="flex items-start justify-between gap-3">
        <Box className="flex min-w-0 flex-col gap-1">
          <Typography variant="body1" className={fact.corrected ? "text-text-secondary line-through" : undefined}>
            {what}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {[brDay(fact.happenedOn), lawsuit ? t("outcome-lawsuit", { number: lawsuit }) : null]
              .filter(Boolean)
              .join(" · ")}
          </Typography>
        </Box>
        {writable && !fact.corrected ? (
          <QuickActions
            label={t("outcome-fact-actions")}
            actions={[{ key: "correct", label: t("outcome-correct"), onClick: () => onAct(fact, "correct") }]}
          />
        ) : null}
      </Box>
      {fact.corrected ? (
        <StateLine tone="info">{t("outcome-corrected", { reason: fact.correctedReason ?? "" })}</StateLine>
      ) : (
        <>
          {fact.byOne ? (
            <Box>
              <StatusChip tone="neutral" label={t("outcome-by-one")} />
            </Box>
          ) : null}
          {fact.words ? (
            <Typography variant="body2" className="bg-grey-25 text-text-secondary rounded-2xl px-3 py-2">
              {fact.words}
            </Typography>
          ) : null}
          {!fact.confirmed ? (
            <StateLine
              tone="attention"
              action={
                writable ? (
                  <Button size="small" variant="text" onClick={() => onAct(fact, "confirm")}>
                    {t("outcome-confirm")}
                  </Button>
                ) : undefined
              }
            >
              {t("outcome-unconfirmed")}
            </StateLine>
          ) : null}
          {fact.confirmed && fact.ackOwed && !fact.ackedAt ? (
            <StateLine
              tone="attention"
              action={
                writable ? (
                  <Button size="small" variant="text" onClick={() => onAct(fact, "ack")}>
                    {t("outcome-ack")}
                  </Button>
                ) : undefined
              }
            >
              {t(ackWords)}
            </StateLine>
          ) : null}
          {fact.ackedAt ? <StateLine tone="done">{t("outcome-acked")}</StateLine> : null}
          {fact.kind === "alvara" && fact.confirmed ? (
            fact.receivedOn ? (
              <StateLine tone="done">
                {t(fact.receivedByOne ? "outcome-received-by-one" : "outcome-received", {
                  value: formatCents(fact.receivedCents ?? 0),
                  day: brDay(fact.receivedOn),
                })}
              </StateLine>
            ) : (
              <StateLine
                tone="attention"
                action={
                  writable ? (
                    <Button size="small" variant="text" onClick={() => onAct(fact, "received")}>
                      {t("outcome-register-received")}
                    </Button>
                  ) : undefined
                }
              >
                {t("outcome-release-waits")}
              </StateLine>
            )
          ) : null}
        </>
      )}
    </Box>
  );
}

/**
 * What each lawsuit of the case came to (migration 0130): ONE reads the court's movements and the judgment's words by
 * rule and records each fact, said as ONE's with the court's words beside it; the lawyers say they are aware of what
 * changes the course; a person records a fact by hand, corrects one, and registers what a release paid. When every
 * lawsuit was archived and every release received, ONE closes the case, said here with the way to reopen it.
 */
export default function OutcomeCard({
  state,
  writable,
  onChanged,
}: {
  state: Ready;
  writable: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const lawsuits = state.proceedings.filter((lawsuit) => lawsuit.cnj && lawsuit.status !== "planned");
  const facts = state.outcomes ?? [];
  const asking = facts.filter(factAsks);
  const numberOf = (proceedingId: string) => {
    const cnj = lawsuits.find((lawsuit) => lawsuit.id === proceedingId)?.cnj ?? "";
    return formatCnj(cnj) ?? cnj;
  };
  const [problem, setProblem] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [receiving, setReceiving] = useState<LawsuitFact | null>(null);
  const [correcting, setCorrecting] = useState<LawsuitFact | null>(null);
  if (lawsuits.length === 0 && facts.length === 0) return null;
  const waiting = facts.some(
    (fact) =>
      !fact.corrected &&
      (!fact.confirmed || (fact.ackOwed && !fact.ackedAt) || (fact.kind === "alvara" && !fact.receivedOn)),
  );
  const closedUnseen = state.closedByOne.closed && !state.closedByOne.acked && state.case.status === "closed";

  const act = async (fact: LawsuitFact, action: "ack" | "confirm" | "received" | "correct") => {
    if (action === "received") return setReceiving(fact);
    if (action === "correct") return setCorrecting(fact);
    setProblem(null);
    const result = await actOnLawsuitFact(state.case.id, fact.id, action);
    if (!result.ok) setProblem(t(errorKey(result.code)));
    onChanged();
  };

  return (
    <CollapsibleCard
      id="case-outcome"
      anchor="resultado"
      title={t("outcome-title")}
      description={t("outcome-description")}
      chip={waiting || closedUnseen ? <StatusChip tone="attention" label={t("outcome-chip-waits")} /> : undefined}
      defaultOpen={state.case.status === "filed" || state.case.status === "closed" || waiting}
      action={
        writable && lawsuits.length > 0 ? (
          <Button size="small" variant="outlined" color="grey" onClick={() => setAdding(true)}>
            {t("outcome-add")}
          </Button>
        ) : undefined
      }
      bodyClassName="gap-4"
    >
      {problem ? (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
          {problem}
        </Alert>
      ) : null}
      {closedUnseen ? (
        <StateLine
          tone="attention"
          action={
            writable ? (
              <Box className="flex gap-1">
                <Button
                  size="small"
                  variant="text"
                  onClick={async () => {
                    const result = await acknowledgeCaseClosure(state.case.id);
                    if (!result.ok) setProblem(t(errorKey(result.code)));
                    onChanged();
                  }}
                >
                  {t("outcome-ack")}
                </Button>
                <Button
                  size="small"
                  variant="text"
                  color="grey"
                  onClick={async () => {
                    const result = await setCaseStatus(state.case.id, "filed");
                    if (!result.ok) setProblem(t("outcome-error-failed"));
                    onChanged();
                  }}
                >
                  {t("outcome-reopen")}
                </Button>
              </Box>
            ) : undefined
          }
        >
          {t("outcome-closed-by-one")}
        </StateLine>
      ) : null}
      {/* What asks the firm first, whatever lawsuit it is of (the owner's canvas, 2026-11-10). */}
      {asking.length > 0 ? (
        <Box component="section" aria-labelledby="outcome-asking" className="flex flex-col gap-1">
          <Typography id="outcome-asking" variant="subtitle2" component="h3">
            {t("item-rows-section", { title: t("item-rows-ask"), count: asking.length })}
          </Typography>
          <Box
            component="ul"
            className="bg-accent-3-light/5 border-grey-100 m-0 flex list-none flex-col rounded-2xl border px-4 py-0"
          >
            {asking.map((fact) => (
              <FactLine
                key={fact.id}
                fact={fact}
                writable={writable}
                lawsuit={numberOf(fact.proceedingId)}
                onAct={(item, action) => void act(item, action)}
              />
            ))}
          </Box>
        </Box>
      ) : null}
      {lawsuits.map((lawsuit) => {
        const all = facts.filter((fact) => fact.proceedingId === lawsuit.id);
        const own = all.filter((fact) => !factAsks(fact));
        return (
          <Box key={lawsuit.id} className="flex flex-col gap-1">
            <Box className="flex flex-wrap items-center justify-between gap-2">
              <Typography variant="subtitle2" component="h3">
                {t("outcome-lawsuit", { number: formatCnj(lawsuit.cnj ?? "") ?? lawsuit.cnj ?? "" })}
              </Typography>
              <StatusChip
                tone={lawsuitOutcome(all) === "archived" ? "positive" : "neutral"}
                label={t(OUTCOME_KEY[lawsuitOutcome(all)])}
              />
            </Box>
            {all.length === 0 ? (
              <StateLine tone="info">{t("outcome-none")}</StateLine>
            ) : own.length === 0 ? null : (
              <Box component="ul" className="m-0 flex list-none flex-col p-0">
                {own.map((fact) => (
                  <FactLine
                    key={fact.id}
                    fact={fact}
                    writable={writable}
                    onAct={(item, action) => void act(item, action)}
                  />
                ))}
              </Box>
            )}
          </Box>
        );
      })}

      {adding ? (
        <FactPanel
          caseId={state.case.id}
          lawsuits={lawsuits.map((lawsuit) => ({
            id: lawsuit.id,
            label: formatCnj(lawsuit.cnj ?? "") ?? lawsuit.cnj ?? "",
          }))}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            onChanged();
          }}
        />
      ) : null}
      {receiving ? (
        <ReceivedPanel
          caseId={state.case.id}
          fact={receiving}
          onClose={() => setReceiving(null)}
          onSaved={() => {
            setReceiving(null);
            onChanged();
          }}
        />
      ) : null}
      {correcting ? (
        <ConfirmActionDialog
          title={t("outcome-correct-title")}
          intro={t("outcome-correct-intro")}
          consequences={[t("outcome-correct-kept"), t("outcome-correct-again")]}
          reasonLabel={t("outcome-field-reason")}
          reasonMinLength={3}
          requireReason
          confirmLabel={t("outcome-correct")}
          cancelLabel={t("outcome-cancel")}
          tone="warning"
          onClose={() => setCorrecting(null)}
          onConfirm={async (reason) => {
            const result = await actOnLawsuitFact(state.case.id, correcting.id, "correct", { reason });
            if (!result.ok) return t(errorKey(result.code));
            setCorrecting(null);
            onChanged();
            return null;
          }}
        />
      ) : null}
    </CollapsibleCard>
  );
}

/** A fact recorded by hand: its lawsuit, kind, result or who appealed, day and value. */
function FactPanel({
  caseId,
  lawsuits,
  onClose,
  onSaved,
}: {
  caseId: string;
  lawsuits: { id: string; label: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [lawsuitId, setLawsuitId] = useState(lawsuits[0]?.id ?? "");
  const [kind, setKind] = useState<FactKind>("sentenca");
  const [result, setResult] = useState("procedente");
  const [appealBy, setAppealBy] = useState("re");
  const [day, setDay] = useState(today());
  const [value, setValue] = useState("");
  const [perClaimant, setPerClaimant] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const valued = kind === "sentenca" || kind === "acordo" || kind === "alvara" || kind === "deposito";

  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const cents = value.trim() ? parseCents(value) : null;
      const answer = await saveLawsuitFact(caseId, lawsuitId, {
        kind,
        result: kind === "sentenca" ? result : null,
        appealBy: kind === "recurso" ? appealBy : null,
        happenedOn: day,
        cents: valued ? cents : null,
        perClaimant: kind === "sentenca" && perClaimant,
      });
      if (answer.ok) onSaved();
      else setProblem(t(errorKey(answer.code)));
    } catch {
      setProblem(t("outcome-error-failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel
      onClose={onClose}
      closeLabel={t("outcome-cancel")}
      icon={<NiScale size="medium" />}
      tone="accent-4"
      busy={busy}
      title={t("outcome-add")}
      description={t("outcome-add-body")}
      onSubmit={() => void save()}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy || !lawsuitId}>
            {t("outcome-save")}
          </Button>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("outcome-cancel")}
          </Button>
        </>
      }
    >
      <Box className="flex flex-col gap-5">
        {problem ? (
          <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
            {problem}
          </Alert>
        ) : null}
        <TextField
          select
          label={t("outcome-field-lawsuit")}
          value={lawsuitId}
          onChange={(event) => setLawsuitId(event.target.value)}
        >
          {lawsuits.map((lawsuit) => (
            <MenuItem key={lawsuit.id} value={lawsuit.id}>
              {lawsuit.label}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          select
          label={t("outcome-field-kind")}
          value={kind}
          onChange={(event) => setKind(event.target.value as FactKind)}
        >
          {FACT_KINDS.map((option) => (
            <MenuItem key={option} value={option}>
              {t(FACT_KEY[option])}
            </MenuItem>
          ))}
        </TextField>
        {kind === "sentenca" ? (
          <TextField
            select
            label={t("outcome-field-result")}
            value={result}
            onChange={(event) => setResult(event.target.value)}
          >
            {(["procedente", "parcial", "improcedente"] as const).map((option) => (
              <MenuItem key={option} value={option}>
                {t(RESULT_KEY[option])}
              </MenuItem>
            ))}
          </TextField>
        ) : null}
        {kind === "recurso" ? (
          <TextField
            select
            label={t("outcome-field-appeal")}
            value={appealBy}
            onChange={(event) => setAppealBy(event.target.value)}
          >
            <MenuItem value="re">{t(APPEAL_KEY.re)}</MenuItem>
            <MenuItem value="autor">{t(APPEAL_KEY.autor)}</MenuItem>
          </TextField>
        ) : null}
        <Box className="grid gap-4 sm:grid-cols-2">
          <TextField
            type="date"
            label={t("outcome-field-day")}
            value={day}
            onChange={(event) => setDay(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
          {valued ? (
            <CurrencyField
              label={t("outcome-field-value")}
              currencySymbol="R$"
              value={value}
              onChange={(event) => setValue(event.target.value)}
            />
          ) : null}
        </Box>
        {kind === "sentenca" && value.trim() ? (
          <TextField
            select
            label={t("outcome-field-per-claimant")}
            value={perClaimant ? "each" : "total"}
            onChange={(event) => setPerClaimant(event.target.value === "each")}
          >
            <MenuItem value="total">{t("outcome-value-total")}</MenuItem>
            <MenuItem value="each">{t("outcome-value-each")}</MenuItem>
          </TextField>
        ) : null}
      </Box>
    </SidePanel>
  );
}

/** What a release paid, when it arrived. */
function ReceivedPanel({
  caseId,
  fact,
  onClose,
  onSaved,
}: {
  caseId: string;
  fact: LawsuitFact;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [value, setValue] = useState(fact.cents ? formatCents(fact.cents).replace(/^R\$\s/, "") : "");
  const [day, setDay] = useState(today());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const save = async () => {
    const cents = parseCents(value);
    if (cents === null || cents < 0) return setProblem(t("outcome-error-invalid"));
    setBusy(true);
    setProblem(null);
    try {
      const answer = await actOnLawsuitFact(caseId, fact.id, "received", { cents, receivedOn: day });
      if (answer.ok) onSaved();
      else setProblem(t(errorKey(answer.code)));
    } catch {
      setProblem(t("outcome-error-failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel
      onClose={onClose}
      closeLabel={t("outcome-cancel")}
      icon={<NiScale size="medium" />}
      tone="secondary"
      busy={busy}
      title={t("outcome-register-received")}
      description={t("outcome-received-body")}
      onSubmit={() => void save()}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy}>
            {t("outcome-save")}
          </Button>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("outcome-cancel")}
          </Button>
        </>
      }
    >
      <Box className="flex flex-col gap-5">
        {problem ? (
          <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
            {problem}
          </Alert>
        ) : null}
        <Box className="grid gap-4 sm:grid-cols-2">
          <CurrencyField
            label={t("outcome-field-received")}
            currencySymbol="R$"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <TextField
            type="date"
            label={t("outcome-field-received-on")}
            value={day}
            onChange={(event) => setDay(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
          />
        </Box>
      </Box>
    </SidePanel>
  );
}
