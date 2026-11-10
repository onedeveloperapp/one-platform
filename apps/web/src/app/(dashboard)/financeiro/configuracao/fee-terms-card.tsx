"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Card, CardContent, MenuItem, TextField, Typography } from "@mui/material";

import { useViewer } from "@/components/layout/viewer-context";
import CardTitle from "@/components/product/card-title";
import { CurrencyField } from "@/components/product/fields";
import SecondFactorPrompt from "@/components/product/second-factor-prompt";
import SidePanel from "@/components/product/side-panel";
import StateLine from "@/components/product/state-line";
import NiScale from "@/icons/nexture/ni-scale";
import { feesLine, type FeeTerms } from "@/lib/cases/fees";
import { saveFeeTerms } from "@/lib/cases/fees-actions";
import { caseKindLabelKey, firmCaseKinds } from "@/lib/modules/registry";
import { parseCents } from "@flyee/rules/finance";

const ERROR_KEY: Record<string, string> = {
  not_allowed: "fees-error-terms-not-allowed",
  second_factor: "fees-error-second-factor",
  support_visit: "fees-error-support",
  invalid_data: "fees-error-invalid",
};

/**
 * How the firm charges (migration 0131): its fee terms per kind of problem (or every one), confirmed by who decides for
 * the firm with the second factor (decision 4). When a client signs the fee contract, the terms in force are the case's,
 * and ONE writes the entry and the installments as bills to receive.
 */
export default function FeeTermsCard({
  terms,
  decides,
  factor,
}: {
  terms: FeeTerms[];
  decides: boolean;
  factor: "ok" | "challenge" | "missing";
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
  onClose,
  onSaved,
}: {
  initial: { incident: string | null; terms: FeeTerms | null };
  kinds: string[];
  scopeName: (incident: string | null) => string;
  factor: "ok" | "challenge" | "missing";
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
  const [confirmed, setConfirmed] = useState(factor === "ok");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

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
            onChange={(event) => setEntry(event.target.value)}
          />
          <TextField
            select
            label={t("fees-field-installments")}
            value={installments}
            onChange={(event) => setInstallments(event.target.value)}
          >
            {["0", "1", "2", "3", "4", "5", "6", "10", "12"].map((count) => (
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
              onChange={(event) => setInstallment(event.target.value)}
            />
          ) : null}
          <TextField
            label={t("fees-field-success")}
            value={percent}
            onChange={(event) => setPercent(event.target.value.replace(/[^0-9,]/g, "").slice(0, 6))}
            slotProps={{ htmlInput: { inputMode: "decimal" } }}
            helperText={t("fees-field-success-help")}
          />
          <CurrencyField
            label={t("fees-field-minimum")}
            currencySymbol="R$"
            value={minimum}
            onChange={(event) => setMinimum(event.target.value)}
          />
          <TextField
            label={t("fees-field-settlement")}
            value={settlement}
            onChange={(event) => setSettlement(event.target.value.replace(/[^0-9,]/g, "").slice(0, 6))}
            slotProps={{ htmlInput: { inputMode: "decimal" } }}
            helperText={t("fees-field-settlement-help")}
          />
        </Box>
      </Box>
    </SidePanel>
  );
}
