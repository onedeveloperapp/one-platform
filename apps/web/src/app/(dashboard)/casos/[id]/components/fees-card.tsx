"use client";

import type { CaseState } from "../case-types";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { Alert, Box, Button, MenuItem, TextField, Typography } from "@mui/material";

import DocumentSlot, { type SlotState } from "@/components/cases/document-slot";
import CollapsibleCard from "@/components/product/collapsible-card";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import { CpfCnpjField, CurrencyField } from "@/components/product/fields";
import QuickActions from "@/components/product/quick-actions";
import SecondFactorPrompt from "@/components/product/second-factor-prompt";
import SidePanel from "@/components/product/side-panel";
import StateLine from "@/components/product/state-line";
import { TILE_TONE } from "@/components/product/tile-tone";
import NiMoney from "@/icons/nexture/ni-money";
import NiReceipt from "@/icons/nexture/ni-receipt";
import { costReadingOf, prefillErrorKey } from "@/lib/cases/document-prefill";
import { type CaseCost, costTotals, feesLine, type FeeSplit, feeSplitsOf, percentText } from "@/lib/cases/fees";
import {
  absorbCaseCost,
  endFeeSplit,
  readFeeSplits,
  saveCaseCost,
  saveCaseFees,
  saveFeeSplit,
} from "@/lib/cases/fees-actions";
import { dropUnsaved, sendForReading } from "@/lib/cases/prefill-browser";
import { formatCents, parseCents } from "@flyee/rules/finance";

type Ready = Extract<CaseState, { kind: "ready" }>;

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
const brDay = (iso: string) => iso.split("-").reverse().join("/");
const ERROR_KEY: Record<string, string> = {
  not_allowed: "fees-error-not-allowed",
  support_visit: "fees-error-support",
  no_terms: "fees-error-no-terms",
  fees_billed: "fees-error-billed",
  invalid_data: "fees-error-invalid",
  second_factor: "fees-error-second-factor",
};
const SPLIT_FIELD_KEY: Record<string, string> = {
  document: "fees-split-error-document",
  bar_registration: "fees-split-error-bar",
  percent: "fees-split-error-percent",
  name: "fees-split-error-name",
};
const SPLITS_BY = new Set(["socio", "advogado", "controladoria"]);
const errorKey = (code: string) => ERROR_KEY[code] ?? "fees-error-failed";
const PAID_KEY = { firm: "fees-cost-paid-firm", client: "fees-cost-paid-client" } as const;
const OWED_KEY = { client: "fees-cost-owed-client", re: "fees-cost-owed-re" } as const;

/**
 * The fees and the costs of the case (migration 0131): the fees the case charges, for who reads the books (from the
 * contract the client signed, or set here), and the costs anybody of the firm writes, with who paid and who owes
 * them back. ONE writes the bills of the fees; the firm never sees the costs as its money.
 */
export default function FeesCard({
  state,
  writable,
  onChanged,
}: {
  state: Ready;
  writable: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const say = (key: string, values?: Record<string, string | number>) => t(key, values);
  const costs = state.costs ?? [];
  const readsBooks =
    state.financeLevel === "view" || state.financeLevel === "operate" || state.financeLevel === "configure";
  const operates = state.financeLevel === "operate" || state.financeLevel === "configure";
  const [adding, setAdding] = useState(false);
  const [absorbing, setAbsorbing] = useState<CaseCost | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const totals = costTotals(costs);
  const [splits, setSplits] = useState<FeeSplit[] | null>(null);
  const [splitting, setSplitting] = useState(false);
  const [ending, setEnding] = useState<FeeSplit | null>(null);
  const [factorOk, setFactorOk] = useState(state.secondFactor === "ok");
  const splitsWritable =
    writable && readsBooks && !state.supportVisit && SPLITS_BY.has(String(state.firmFunction ?? ""));
  const caseId = state.case.id;
  const readSplits = useCallback(async () => {
    const rows = await readFeeSplits(caseId);
    setSplits(rows ? feeSplitsOf(rows) : null);
  }, [caseId]);
  useEffect(() => {
    if (readsBooks) void readSplits();
  }, [readsBooks, readSplits]);
  const activeSplits = (splits ?? []).filter((split) => !split.ended);

  const fromTerms = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await saveCaseFees(state.case.id, "terms");
      if (!result.ok) setProblem(t(errorKey(result.code)));
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <CollapsibleCard
      id="case-fees"
      anchor="honorarios"
      title={t("fees-title")}
      description={t("fees-description")}
      summary={
        costs.length > 0 ? t("fees-summary-costs", { count: costs.length, value: formatCents(totals.paid) }) : undefined
      }
      defaultOpen={false}
      add={writable ? { label: t("fees-cost-add"), onClick: () => setAdding(true) } : null}
      bodyClassName="gap-4"
    >
      {problem ? (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
          {problem}
        </Alert>
      ) : null}
      {readsBooks ? (
        <Box className="flex flex-col gap-1">
          <Typography variant="subtitle2" component="h3">
            {t("fees-heading")}
          </Typography>
          {state.fees ? (
            <>
              <StateLine tone="info">{feesLine(state.fees, say)}</StateLine>
              <StateLine tone={state.fees.billed ? "done" : "waiting"}>
                {t(state.fees.billed ? "fees-billed" : "fees-not-billed")}
              </StateLine>
            </>
          ) : (
            <StateLine
              tone="attention"
              action={
                writable ? (
                  <Button size="small" variant="text" disabled={busy} onClick={() => void fromTerms()}>
                    {t("fees-from-terms")}
                  </Button>
                ) : undefined
              }
            >
              {t("fees-none")}
            </StateLine>
          )}
        </Box>
      ) : null}
      {readsBooks ? (
        <Box className="flex flex-col gap-1">
          <Box className="flex items-center justify-between gap-2">
            <Typography variant="subtitle2" component="h3">
              {t("fees-split-heading")}
            </Typography>
            {splitsWritable ? (
              <Button size="small" variant="text" onClick={() => setSplitting(true)}>
                {t("fees-split-add")}
              </Button>
            ) : null}
          </Box>
          {splits === null ? null : activeSplits.length === 0 ? (
            <StateLine tone="info">{t("fees-split-none")}</StateLine>
          ) : (
            <Box component="ul" className="m-0 flex list-none flex-col p-0">
              {activeSplits.map((split) => (
                <Box
                  component="li"
                  key={split.id}
                  className="border-grey-100 flex items-start justify-between gap-3 border-b py-2 last:border-b-0"
                >
                  <Box className="flex min-w-0 flex-col gap-0.5">
                    <Typography variant="body1">{split.name}</Typography>
                    <Typography variant="body2" className="text-text-secondary">
                      {t("fees-split-line", { bar: split.barRegistration, percent: percentText(split.percent) })}
                    </Typography>
                  </Box>
                  {splitsWritable ? (
                    <QuickActions
                      label={t("fees-split-actions")}
                      actions={[{ key: "end", label: t("fees-split-end"), onClick: () => setEnding(split) }]}
                    />
                  ) : null}
                </Box>
              ))}
            </Box>
          )}
        </Box>
      ) : null}
      <Box className="flex flex-col gap-1">
        <Typography variant="subtitle2" component="h3">
          {t("fees-costs-heading")}
        </Typography>
        {costs.length === 0 ? (
          <StateLine tone="info">{t("fees-costs-none")}</StateLine>
        ) : (
          <Box component="ul" className="m-0 flex list-none flex-col p-0">
            {costs.map((cost) => (
              <Box
                component="li"
                key={cost.id}
                className="border-grey-100 flex items-start justify-between gap-3 border-b py-2 last:border-b-0"
              >
                <Box className="flex min-w-0 flex-col gap-0.5">
                  <Typography variant="body1">{cost.description}</Typography>
                  <Typography variant="body2" className="text-text-secondary">
                    {[brDay(cost.spentOn), t(PAID_KEY[cost.paidBy]), cost.owedBy ? t(OWED_KEY[cost.owedBy]) : null]
                      .filter(Boolean)
                      .join(" · ")}
                  </Typography>
                  {cost.absorbed ? <StateLine tone="info">{t("fees-cost-absorbed")}</StateLine> : null}
                </Box>
                <Box className="flex shrink-0 items-start gap-2">
                  <Typography variant="body1" className="tabular-nums">
                    {formatCents(cost.cents)}
                  </Typography>
                  {operates && cost.owedBy === "client" && !cost.absorbed ? (
                    <QuickActions
                      label={t("fees-cost-actions")}
                      actions={[{ key: "absorb", label: t("fees-cost-absorb"), onClick: () => setAbsorbing(cost) }]}
                    />
                  ) : null}
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Box>

      {adding ? (
        <CostPanel
          caseId={state.case.id}
          onClose={() => setAdding(false)}
          onSaved={() => {
            setAdding(false);
            onChanged();
          }}
        />
      ) : null}
      {splitting ? (
        <SplitPanel
          caseId={caseId}
          factor={factorOk ? "ok" : state.secondFactor}
          taken={activeSplits.reduce((sum, split) => sum + split.percent, 0)}
          onClose={() => setSplitting(false)}
          onSaved={() => {
            setSplitting(false);
            void readSplits();
            onChanged();
          }}
        />
      ) : null}
      {ending ? (
        <ConfirmActionDialog
          title={t("fees-split-end-title")}
          intro={t("fees-split-end-intro", { name: ending.name })}
          consequences={[t("fees-split-end-kept")]}
          reasonLabel={t("fees-field-reason")}
          reasonMinLength={3}
          requireReason
          confirmLabel={t("fees-split-end")}
          cancelLabel={t("fees-cancel")}
          tone="warning"
          blocked={!factorOk}
          onClose={() => setEnding(null)}
          onConfirm={async (reason) => {
            const result = await endFeeSplit(caseId, ending.id, reason);
            if (!result.ok) return t(errorKey(result.code));
            setEnding(null);
            void readSplits();
            onChanged();
            return null;
          }}
        >
          {!factorOk ? (
            <SecondFactorPrompt
              state={state.secondFactor === "missing" ? "missing" : "challenge"}
              onConfirmed={() => setFactorOk(true)}
            />
          ) : null}
        </ConfirmActionDialog>
      ) : null}
      {absorbing ? (
        <ConfirmActionDialog
          title={t("fees-cost-absorb-title")}
          intro={t("fees-cost-absorb-intro", { value: formatCents(absorbing.cents) })}
          consequences={[t("fees-cost-absorb-kept")]}
          reasonLabel={t("fees-field-reason")}
          reasonMinLength={3}
          requireReason
          confirmLabel={t("fees-cost-absorb")}
          cancelLabel={t("fees-cancel")}
          tone="warning"
          onClose={() => setAbsorbing(null)}
          onConfirm={async (reason) => {
            const result = await absorbCaseCost(state.case.id, absorbing.id, reason);
            if (!result.ok) return t(errorKey(result.code));
            setAbsorbing(null);
            onChanged();
            return null;
          }}
        />
      ) : null}
    </CollapsibleCard>
  );
}

/**
 * A cost of the case: what, how much, when, who paid, and who owes it back. It starts from its receipt (0162): ONE
 * reads what was paid, the value and the day, each field marked until somebody writes over it, and the receipt is
 * kept with the cost; filling it by hand is the other way in.
 */
function CostPanel({ caseId, onClose, onSaved }: { caseId: string; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations("product");
  const [description, setDescription] = useState("");
  const [value, setValue] = useState("");
  const [day, setDay] = useState(today());
  const [paidBy, setPaidBy] = useState<"firm" | "client">("firm");
  const [owedBy, setOwedBy] = useState<"none" | "client" | "re">("client");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [stage, setStage] = useState<"start" | "form">("start");
  const [slot, setSlot] = useState<SlotState>({ kind: "empty" });
  const [receipt, setReceipt] = useState<{ fileId: string | null; name: string } | null>(null);
  const [read, setRead] = useState<{ description?: string; value?: string; day?: string }>({});
  const readHelp = (field: "description" | "value" | "day", current: string) =>
    read[field] !== undefined && read[field] === current ? t("fees-cost-read-field") : undefined;

  const close = () => {
    dropUnsaved([receipt?.fileId]);
    onClose();
  };

  const sendReceipt = async (file: File) => {
    dropUnsaved([receipt?.fileId]);
    setReceipt({ fileId: null, name: file.name });
    setSlot({ kind: "reading" });
    setProblem(null);
    const sent = await sendForReading(file, "case_cost");
    setReceipt({ fileId: sent.fileId, name: file.name });
    setStage("form");
    if (!sent.ok) {
      setSlot({ kind: "failed", sentence: t(prefillErrorKey(sent.code)) });
      return;
    }
    const reading = costReadingOf(sent.output, today());
    const filled: { description?: string; value?: string; day?: string } = {};
    if (reading.isCost && reading.description) {
      setDescription(reading.description);
      filled.description = reading.description;
    }
    if (reading.isCost && reading.cents > 0) {
      const text = (reading.cents / 100).toFixed(2).replace(".", ",");
      setValue(text);
      filled.value = text;
    }
    if (reading.isCost && reading.spentOn) {
      setDay(reading.spentOn);
      filled.day = reading.spentOn;
    }
    setRead(filled);
    const found = Object.keys(filled).length;
    const sentence = !reading.isCost
      ? t("fees-cost-read-other")
      : !reading.legible
        ? t("fees-cost-read-illegible")
        : found > 0
          ? t("fees-cost-read-ok", { count: found })
          : t("fees-cost-read-nothing");
    setSlot({
      kind: "read",
      tone: reading.isCost && reading.legible && found > 0 ? "positive" : "attention",
      sentence: [sentence, reading.note].filter(Boolean).join(" "),
    });
  };

  const save = async () => {
    const cents = parseCents(value);
    if (!cents || cents <= 0) return setProblem(t("fees-error-invalid"));
    setBusy(true);
    setProblem(null);
    try {
      const result = await saveCaseCost(caseId, {
        description,
        cents,
        spentOn: day,
        paidBy,
        owedBy: paidBy === "firm" && owedBy !== "none" ? owedBy : null,
        fileId: receipt?.fileId ?? null,
      });
      if (result.ok) onSaved();
      else setProblem(t(errorKey(result.code)));
    } catch {
      setProblem(t("fees-error-failed"));
    } finally {
      setBusy(false);
    }
  };

  const reading = slot.kind === "sending" || slot.kind === "reading";

  return (
    <SidePanel
      onClose={close}
      closeLabel={t("fees-cancel")}
      icon={<NiMoney size="medium" />}
      tone="accent-2"
      busy={busy || reading}
      title={t("fees-cost-add")}
      description={t("fees-cost-add-body")}
      onSubmit={() => void save()}
      actions={
        <>
          {stage === "form" ? (
            <Button type="submit" variant="contained" disabled={busy || reading}>
              {t("fees-save")}
            </Button>
          ) : (
            <Button variant="outlined" color="grey" onClick={() => setStage("form")} disabled={reading}>
              {t("prefill-manual")}
            </Button>
          )}
          <Button variant="text" color="grey" onClick={close} disabled={busy}>
            {t("fees-cancel")}
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
        <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
          <DocumentSlot
            id="case-cost-receipt"
            icon={<NiReceipt size="medium" className={TILE_TONE.primary.text} />}
            title={t("fees-cost-slot")}
            hint={t("fees-cost-slot-hint")}
            state={slot}
            fileName={receipt?.name}
            primary={stage === "start"}
            disabled={busy}
            labels={{
              send: t("prefill-send"),
              again: t("prefill-again"),
              sending: t("prefill-sending"),
              reading: t("prefill-reading"),
              read: t("prefill-read"),
              failed: t("prefill-failed"),
            }}
            onFile={(file) => void sendReceipt(file)}
          />
        </Box>
        {stage === "form" ? (
          <>
            <TextField
              label={t("fees-field-description")}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              helperText={readHelp("description", description)}
            />
            <Box className="grid gap-4 sm:grid-cols-2">
              <CurrencyField
                label={t("fees-field-value")}
                currencySymbol="R$"
                value={value}
                onChange={(event) => setValue(event.target.value)}
                helperText={readHelp("value", value)}
              />
              <TextField
                type="date"
                label={t("fees-field-day")}
                value={day}
                onChange={(event) => setDay(event.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                helperText={readHelp("day", day)}
              />
            </Box>
            <TextField
              select
              label={t("fees-field-paid-by")}
              value={paidBy}
              onChange={(event) => setPaidBy(event.target.value as "firm" | "client")}
            >
              <MenuItem value="firm">{t(PAID_KEY.firm)}</MenuItem>
              <MenuItem value="client">{t(PAID_KEY.client)}</MenuItem>
            </TextField>
            {paidBy === "firm" ? (
              <TextField
                select
                label={t("fees-field-owed-by")}
                value={owedBy}
                onChange={(event) => setOwedBy(event.target.value as "none" | "client" | "re")}
              >
                <MenuItem value="client">{t(OWED_KEY.client)}</MenuItem>
                <MenuItem value="re">{t(OWED_KEY.re)}</MenuItem>
                <MenuItem value="none">{t("fees-cost-owed-none")}</MenuItem>
              </TextField>
            ) : null}
          </>
        ) : null}
      </Box>
    </SidePanel>
  );
}

/**
 * The fees of the case split with another lawyer or law firm of the bar (0159): who, their CPF or CNPJ, their
 * registration and the percent of what the firm receives. ONE writes their part as a bill to pay when a fee arrives.
 */
function SplitPanel({
  caseId,
  factor,
  taken,
  onClose,
  onSaved,
}: {
  caseId: string;
  factor: "ok" | "challenge" | "missing";
  taken: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [name, setName] = useState("");
  const [document, setDocument] = useState("");
  const [bar, setBar] = useState("");
  const [percent, setPercent] = useState("");
  const [confirmed, setConfirmed] = useState(factor === "ok");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await saveFeeSplit(caseId, { name, document, barRegistration: bar, percent });
      if (result.ok) return onSaved();
      if (result.code === "second_factor") setConfirmed(false);
      const fieldKey = result.code === "invalid_data" && result.field ? SPLIT_FIELD_KEY[result.field] : undefined;
      setProblem(t(fieldKey ?? errorKey(result.code)));
    } catch {
      setProblem(t("fees-error-failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel
      onClose={onClose}
      closeLabel={t("fees-cancel")}
      icon={<NiMoney size="medium" />}
      tone="accent-2"
      busy={busy}
      title={t("fees-split-add")}
      description={t("fees-split-add-body")}
      onSubmit={() => void save()}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy || !confirmed}>
            {t("fees-save")}
          </Button>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("fees-cancel")}
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
        {!confirmed ? (
          <SecondFactorPrompt
            state={factor === "missing" ? "missing" : "challenge"}
            onConfirmed={() => setConfirmed(true)}
          />
        ) : null}
        <TextField label={t("fees-split-field-name")} value={name} onChange={(event) => setName(event.target.value)} />
        <CpfCnpjField
          label={t("fees-split-field-document")}
          value={document}
          onChange={(event) => setDocument(event.target.value)}
        />
        <Box className="grid gap-4 sm:grid-cols-2">
          <TextField
            label={t("fees-split-field-bar")}
            value={bar}
            onChange={(event) => setBar(event.target.value.toUpperCase().slice(0, 20))}
            helperText={t("fees-split-field-bar-help")}
          />
          <TextField
            label={t("fees-split-field-percent")}
            value={percent}
            onChange={(event) => setPercent(event.target.value.replace(/[^0-9,]/g, "").slice(0, 5))}
            slotProps={{ htmlInput: { inputMode: "decimal" } }}
            helperText={t("fees-split-field-percent-help", { count: Math.max(0, 100 - taken) })}
          />
        </Box>
      </Box>
    </SidePanel>
  );
}
