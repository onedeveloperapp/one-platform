"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useRef, useState } from "react";

import { Alert, Box, Button, Card, CardContent, MenuItem, TextField, Typography } from "@mui/material";

import { useViewer } from "@/components/layout/viewer-context";
import CardTitle from "@/components/product/card-title";
import { CurrencyField } from "@/components/product/fields";
import SecondFactorPrompt from "@/components/product/second-factor-prompt";
import SidePanel from "@/components/product/side-panel";
import StateLine from "@/components/product/state-line";
import NiScale from "@/icons/nexture/ni-scale";
import type { FeeReadField, FeeTermsRead } from "@/lib/cases/fee-terms-reading";
import { feesLine, type FeeTerms } from "@/lib/cases/fees";
import { readFeeTermsFromContract, saveFeeTerms } from "@/lib/cases/fees-actions";
import { caseKindLabelKey, firmCaseKinds } from "@/lib/modules/registry";
import { parseCents } from "@flyee/rules/finance";

const ERROR_KEY: Record<string, string> = {
  not_allowed: "fees-error-terms-not-allowed",
  second_factor: "fees-error-second-factor",
  support_visit: "fees-error-support",
  invalid_data: "fees-error-invalid",
};
const READ_ERROR_KEY: Record<string, string> = {
  no_contract: "fees-read-error-no-contract",
  reading_limit: "fees-read-error-limit",
  not_allowed: "fees-error-terms-not-allowed",
  support_visit: "fees-error-support",
  read_running: "fees-read-error-running",
};
const FIELD_LABEL: Record<FeeReadField, string> = {
  entry: "fees-field-entry",
  installments: "fees-field-installments",
  monthly: "fees-field-months",
  success: "fees-field-success",
  minimum: "fees-field-minimum",
  settlement: "fees-field-settlement",
  hearing: "fees-field-hearing",
  appeal: "fees-field-appeal",
  fine: "fees-field-fine",
  interest: "fees-field-interest",
};
/** The choices of a count, with the one read or saved among them when it is not one of the usual. */
const withCount = (choices: string[], value: string) =>
  choices.includes(value) ? choices : [...choices, value].sort((a, b) => Number(a) - Number(b));
const percentInput = (value: number) => String(value).replace(".", ",");

/**
 * How the firm charges (migration 0131): its fee terms per kind of problem (or every one), confirmed by who decides for
 * the firm with the second factor (decision 4). When a client signs the fee contract, the terms in force are the case's,
 * and ONE writes the entry and the installments as bills to receive.
 */
export default function FeeTermsCard({
  terms,
  decides,
  factor,
  contract,
}: {
  terms: FeeTerms[];
  decides: boolean;
  factor: "ok" | "challenge" | "missing";
  /** The name of the firm's fee contract in the library, which ONE reads the terms from (0160). */
  contract: string | null;
}) {
  const t = useTranslations("product");
  const say = (key: string, values?: Record<string, string | number>) => t(key, values);
  const router = useRouter();
  const kinds = firmCaseKinds(useViewer()?.modules);
  const [editing, setEditing] = useState<{ incident: string | null; terms: FeeTerms | null } | null>(null);
  const scopeName = (incident: string | null) =>
    incident ? t(caseKindLabelKey(incident) ?? "case-incident-other") : t("fees-terms-every-kind");

  return (
    <Card component="section" id="honorarios" aria-labelledby="finance-settings-fees">
      <CardContent className="flex flex-col gap-4">
        <CardTitle
          id="finance-settings-fees"
          icon={<NiScale size="medium" />}
          tone="accent-4"
          title={t("fees-terms-title")}
          description={t("fees-terms-description")}
          actions={
            decides ? (
              <Button
                size="small"
                variant="outlined"
                color="grey"
                onClick={() => setEditing({ incident: null, terms: null })}
              >
                {t("fees-terms-new")}
              </Button>
            ) : undefined
          }
        />
        {terms.length === 0 ? (
          <StateLine tone="attention">{t("fees-terms-none")}</StateLine>
        ) : (
          <Box component="ul" className="m-0 flex list-none flex-col p-0">
            {terms.map((item) => (
              <Box
                component="li"
                key={item.id}
                className="border-grey-100 flex items-start justify-between gap-3 border-b py-2 last:border-b-0"
              >
                <Box className="flex min-w-0 flex-col gap-0.5">
                  <Typography variant="body1">{scopeName(item.incident)}</Typography>
                  <Typography variant="body2" className="text-text-secondary">
                    {feesLine(item, say)}
                  </Typography>
                </Box>
                {decides ? (
                  <Button
                    size="small"
                    variant="text"
                    onClick={() => setEditing({ incident: item.incident, terms: item })}
                  >
                    {t("fees-terms-change")}
                  </Button>
                ) : null}
              </Box>
            ))}
          </Box>
        )}
      </CardContent>
      {editing ? (
        <TermsPanel
          initial={editing}
          kinds={kinds.map((kind) => kind.key)}
          scopeName={scopeName}
          factor={factor}
          contract={contract}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
    </Card>
  );
}

const centsText = (cents: number) => (cents > 0 ? (cents / 100).toFixed(2).replace(".", ",") : "");

function TermsPanel({
  initial,
  kinds,
  scopeName,
  factor,
  contract,
  onClose,
  onSaved,
}: {
  initial: { incident: string | null; terms: FeeTerms | null };
  kinds: string[];
  scopeName: (incident: string | null) => string;
  factor: "ok" | "challenge" | "missing";
  contract: string | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const base = initial.terms;
  const [incident, setIncident] = useState(initial.incident ?? "");
  const [entry, setEntry] = useState(centsText(base?.entryCents ?? 0));
  const [installments, setInstallments] = useState(String(base?.installments ?? 0));
  const [installment, setInstallment] = useState(centsText(base?.installmentCents ?? 0));
  const [percent, setPercent] = useState(base ? String(base.successPercent).replace(".", ",") : "30");
  const [minimum, setMinimum] = useState(centsText(base?.successMinCents ?? 0));
  const [settlement, setSettlement] = useState(
    base?.settlementPercent !== null && base?.settlementPercent !== undefined
      ? String(base.settlementPercent).replace(".", ",")
      : "",
  );
  const [monthly, setMonthly] = useState(centsText(base?.monthlyCents ?? 0));
  const [months, setMonths] = useState(String(base?.monthlyMonths ?? 0));
  const [hearing, setHearing] = useState(centsText(base?.hearingCents ?? 0));
  const [appeal, setAppeal] = useState(centsText(base?.appealCents ?? 0));
  const [fine, setFine] = useState(base?.lateFinePercent ? String(base.lateFinePercent).replace(".", ",") : "");
  const [interest, setInterest] = useState(
    base?.lateInterestPercent ? String(base.lateInterestPercent).replace(".", ",") : "",
  );
  const [confirmed, setConfirmed] = useState(factor === "ok");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  // ONE's reading of the firm's contract (0160): what it filled, each field marked until somebody writes over it.
  const [reading, setReading] = useState(false);
  const [read, setRead] = useState<FeeTermsRead | null>(null);
  const [readProblem, setReadProblem] = useState<string | null>(null);
  const [marked, setMarked] = useState<Set<FeeReadField>>(new Set());
  const touch = (field: FeeReadField) =>
    setMarked((current) => {
      if (!current.has(field)) return current;
      const next = new Set(current);
      next.delete(field);
      return next;
    });
  const readHelp = (field: FeeReadField, otherwise?: string) => (marked.has(field) ? t("fees-read-field") : otherwise);

  const readContract = useCallback(async () => {
    setReading(true);
    setReadProblem(null);
    try {
      const answer = await readFeeTermsFromContract();
      if (!answer.ok) {
        setReadProblem(t(READ_ERROR_KEY[answer.code] ?? "fees-read-error-failed"));
        return;
      }
      const values = answer.read.values;
      if (values.entryCents !== undefined) setEntry(centsText(values.entryCents));
      if (values.installments !== undefined) {
        setInstallments(String(values.installments));
        setInstallment(centsText(values.installmentCents ?? 0));
      }
      if (values.monthlyMonths !== undefined) {
        setMonths(String(values.monthlyMonths));
        setMonthly(centsText(values.monthlyCents ?? 0));
      }
      if (values.successPercent !== undefined) setPercent(percentInput(values.successPercent));
      if (values.successMinCents !== undefined) setMinimum(centsText(values.successMinCents));
      if (values.settlementPercent !== undefined) setSettlement(percentInput(values.settlementPercent));
      if (values.hearingCents !== undefined) setHearing(centsText(values.hearingCents));
      if (values.appealCents !== undefined) setAppeal(centsText(values.appealCents));
      if (values.lateFinePercent !== undefined) setFine(percentInput(values.lateFinePercent));
      if (values.lateInterestPercent !== undefined) setInterest(percentInput(values.lateInterestPercent));
      setMarked(new Set(answer.read.read));
      setRead(answer.read);
    } catch {
      setReadProblem(t("fees-read-error-failed"));
    } finally {
      setReading(false);
    }
  }, [t]);

  // New terms open on ONE's reading of the firm's contract, once; changing terms read it again on request.
  const opened = useRef(false);
  useEffect(() => {
    if (opened.current || !contract || base) return;
    opened.current = true;
    void readContract();
  }, [contract, base, readContract]);

  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await saveFeeTerms(
        { module: null, incident: incident || null },
        {
          entryCents: parseCents(entry || "0") ?? 0,
          installments: Number(installments) || 0,
          installmentCents: parseCents(installment || "0") ?? 0,
          successPercent: percent || "0",
          successMinCents: parseCents(minimum || "0") ?? 0,
          settlementPercent: settlement,
          monthlyCents: months === "0" ? 0 : (parseCents(monthly || "0") ?? 0),
          monthlyMonths: Number(months) || 0,
          hearingCents: parseCents(hearing || "0") ?? 0,
          appealCents: parseCents(appeal || "0") ?? 0,
          lateFinePercent: fine || "0",
          lateInterestPercent: interest || "0",
        },
      );
      if (result.ok) onSaved();
      else setProblem(t(ERROR_KEY[result.code] ?? "fees-error-failed"));
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
      icon={<NiScale size="medium" />}
      tone="accent-4"
      busy={busy}
      title={t("fees-terms-panel-title")}
      description={t("fees-terms-panel-body")}
      onSubmit={() => void save()}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy || !confirmed}>
            {t("fees-terms-confirm")}
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
        {contract ? (
          <Box className="flex flex-col gap-1" aria-live="polite">
            {reading ? (
              <StateLine tone="waiting">{t("fees-read-running", { name: contract })}</StateLine>
            ) : readProblem ? (
              <StateLine
                tone="attention"
                action={
                  <Button size="small" variant="text" onClick={() => void readContract()}>
                    {t("fees-read-again")}
                  </Button>
                }
              >
                {readProblem}
              </StateLine>
            ) : read ? (
              <>
                {!read.isContract ? (
                  <StateLine tone="attention">{t("fees-read-not-contract", { name: contract })}</StateLine>
                ) : read.read.length > 0 ? (
                  <StateLine
                    tone="info"
                    action={
                      <Button size="small" variant="text" onClick={() => void readContract()}>
                        {t("fees-read-again")}
                      </Button>
                    }
                  >
                    {t("fees-read-done", { count: read.read.length, name: contract })}
                  </StateLine>
                ) : (
                  <StateLine tone="attention">{t("fees-read-nothing", { name: contract })}</StateLine>
                )}
                {read.dropped.length > 0 ? (
                  <StateLine tone="attention">
                    {t("fees-read-dropped", {
                      fields: read.dropped.map((field) => t(FIELD_LABEL[field])).join(", "),
                    })}
                  </StateLine>
                ) : null}
                {read.note ? <StateLine tone="info">{read.note}</StateLine> : null}
              </>
            ) : (
              <StateLine
                tone="info"
                action={
                  <Button size="small" variant="text" onClick={() => void readContract()}>
                    {t("fees-read-start")}
                  </Button>
                }
              >
                {t("fees-read-offer", { name: contract })}
              </StateLine>
            )}
          </Box>
        ) : null}
        {!confirmed ? (
          <SecondFactorPrompt
            state={factor === "missing" ? "missing" : "challenge"}
            onConfirmed={() => setConfirmed(true)}
          />
        ) : null}
        <TextField
          select
          label={t("fees-field-kind")}
          value={incident}
          onChange={(event) => setIncident(event.target.value)}
        >
          <MenuItem value="">{scopeName(null)}</MenuItem>
          {kinds.map((kind) => (
            <MenuItem key={kind} value={kind}>
              {scopeName(kind)}
            </MenuItem>
          ))}
        </TextField>
        <Box className="grid gap-4 sm:grid-cols-2">
          <CurrencyField
            label={t("fees-field-entry")}
            currencySymbol="R$"
            value={entry}
            onChange={(event) => {
              setEntry(event.target.value);
              touch("entry");
            }}
            helperText={readHelp("entry")}
          />
          <TextField
            select
            label={t("fees-field-installments")}
            value={installments}
            onChange={(event) => {
              setInstallments(event.target.value);
              touch("installments");
            }}
            helperText={readHelp("installments")}
          >
            {withCount(["0", "1", "2", "3", "4", "5", "6", "10", "12"], installments).map((count) => (
              <MenuItem key={count} value={count}>
                {count === "0" ? t("fees-no-installments") : count}
              </MenuItem>
            ))}
          </TextField>
          {installments !== "0" ? (
            <CurrencyField
              label={t("fees-field-installment")}
              currencySymbol="R$"
              value={installment}
              onChange={(event) => {
                setInstallment(event.target.value);
                touch("installments");
              }}
              helperText={readHelp("installments")}
            />
          ) : null}
          <TextField
            label={t("fees-field-success")}
            value={percent}
            onChange={(event) => {
              setPercent(event.target.value.replace(/[^0-9,]/g, "").slice(0, 6));
              touch("success");
            }}
            slotProps={{ htmlInput: { inputMode: "decimal" } }}
            helperText={readHelp("success", t("fees-field-success-help"))}
          />
          <CurrencyField
            label={t("fees-field-minimum")}
            currencySymbol="R$"
            value={minimum}
            onChange={(event) => {
              setMinimum(event.target.value);
              touch("minimum");
            }}
            helperText={readHelp("minimum")}
          />
          <TextField
            label={t("fees-field-settlement")}
            value={settlement}
            onChange={(event) => {
              setSettlement(event.target.value.replace(/[^0-9,]/g, "").slice(0, 6));
              touch("settlement");
            }}
            slotProps={{ htmlInput: { inputMode: "decimal" } }}
            helperText={readHelp("settlement", t("fees-field-settlement-help"))}
          />
          <TextField
            select
            label={t("fees-field-months")}
            value={months}
            onChange={(event) => {
              setMonths(event.target.value);
              touch("monthly");
            }}
            helperText={readHelp("monthly")}
          >
            {withCount(["0", "3", "6", "12", "24", "36"], months).map((count) => (
              <MenuItem key={count} value={count}>
                {count === "0" ? t("fees-no-monthly") : t("fees-months", { count: Number(count) })}
              </MenuItem>
            ))}
          </TextField>
          {months !== "0" ? (
            <CurrencyField
              label={t("fees-field-monthly")}
              currencySymbol="R$"
              value={monthly}
              onChange={(event) => {
                setMonthly(event.target.value);
                touch("monthly");
              }}
              helperText={readHelp("monthly")}
            />
          ) : null}
          <CurrencyField
            label={t("fees-field-hearing")}
            currencySymbol="R$"
            value={hearing}
            onChange={(event) => {
              setHearing(event.target.value);
              touch("hearing");
            }}
            helperText={readHelp("hearing")}
          />
          <CurrencyField
            label={t("fees-field-appeal")}
            currencySymbol="R$"
            value={appeal}
            onChange={(event) => {
              setAppeal(event.target.value);
              touch("appeal");
            }}
            helperText={readHelp("appeal")}
          />
          <TextField
            label={t("fees-field-fine")}
            value={fine}
            onChange={(event) => {
              setFine(event.target.value.replace(/[^0-9,]/g, "").slice(0, 5));
              touch("fine");
            }}
            slotProps={{ htmlInput: { inputMode: "decimal" } }}
            helperText={readHelp("fine", t("fees-field-fine-help"))}
          />
          <TextField
            label={t("fees-field-interest")}
            value={interest}
            onChange={(event) => {
              setInterest(event.target.value.replace(/[^0-9,]/g, "").slice(0, 5));
              touch("interest");
            }}
            slotProps={{ htmlInput: { inputMode: "decimal" } }}
            helperText={readHelp("interest", t("fees-field-interest-help"))}
          />
        </Box>
      </Box>
    </SidePanel>
  );
}
