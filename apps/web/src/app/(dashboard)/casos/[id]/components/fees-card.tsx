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
import NiMoney from "@/icons/nexture/ni-money";
import { type CaseCost, costTotals, feesLine } from "@/lib/cases/fees";
import { absorbCaseCost, saveCaseCost, saveCaseFees } from "@/lib/cases/fees-actions";
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
};
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
      action={
        writable ? (
          <Button size="small" variant="outlined" color="grey" onClick={() => setAdding(true)}>
            {t("fees-cost-add")}
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

/** A cost of the case: what, how much, when, who paid, and who owes it back. */
function CostPanel({ caseId, onClose, onSaved }: { caseId: string; onClose: () => void; onSaved: () => void }) {
  const t = useTranslations("product");
  const [description, setDescription] = useState("");
  const [value, setValue] = useState("");
  const [day, setDay] = useState(today());
  const [paidBy, setPaidBy] = useState<"firm" | "client">("firm");
  const [owedBy, setOwedBy] = useState<"none" | "client" | "re">("client");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

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
      });
      if (result.ok) onSaved();
      else setProblem(t(errorKey(result.code)));
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
      title={t("fees-cost-add")}
      description={t("fees-cost-add-body")}
      onSubmit={() => void save()}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy}>
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
        <TextField
          label={t("fees-field-description")}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
        <Box className="grid gap-4 sm:grid-cols-2">
          <CurrencyField
            label={t("fees-field-value")}
            currencySymbol="R$"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <TextField
            type="date"
            label={t("fees-field-day")}
            value={day}
            onChange={(event) => setDay(event.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
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
      </Box>
    </SidePanel>
  );
}
