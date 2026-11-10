"use client";

import type { FinanceRegistrations } from "./load-finance";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { Alert, Box, Button, MenuItem, TextField } from "@mui/material";

import { CurrencyField } from "@/components/product/fields";
import SidePanel from "@/components/product/side-panel";
import StateLine from "@/components/product/state-line";
import NiMoney from "@/icons/nexture/ni-money";
import { saveFinanceEntry } from "@/lib/finance/actions";
import { categoryFits, type EntryKind, financeErrorKey, financeFieldKey } from "@/lib/finance/books";
import { parseCents } from "@flyee/rules/finance";

/** What a person writes by hand: the kinds the panel opens on. */
export type ManualKind = Exclude<EntryKind, "transfer"> | "transfer";

/** The words of each way to write an entry by hand: the panel's title and the menu's item. */
export const NEW_KEY: Record<ManualKind, string> = {
  income: "finance-new-income",
  expense: "finance-new-expense",
  client_money: "finance-new-client-money",
  partner: "finance-new-partner",
  transfer: "finance-new-transfer",
};

const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

/**
 * A person writes an entry by hand (migration 0126): an income, an expense, a client's money, a partner's money, or a
 * transfer between two accounts, each with its account, value, day and category. ONE joins it to the statement's line
 * that shows it when that line arrives, so the money is never counted twice. The panel says it is the person's.
 */
export default function EntryPanel({
  kind,
  registrations,
  onClose,
  onSaved,
}: {
  kind: ManualKind;
  registrations: FinanceRegistrations;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const accounts = registrations.accounts.filter((account) => !account.archived);
  const categories = useMemo(
    () => registrations.categories.filter((category) => !category.archived && categoryFits(kind, category.kind)),
    [registrations.categories, kind],
  );
  const centers = registrations.costCenters.filter((center) => !center.archived);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [toAccountId, setToAccountId] = useState(accounts[1]?.id ?? "");
  const [value, setValue] = useState("");
  const [day, setDay] = useState(today());
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");
  const [centerId, setCenterId] = useState("");
  const [counterparty, setCounterparty] = useState("");
  const [description, setDescription] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ code: string; field?: string } | null>(null);
  // A partner's money goes out when its category is one of money going out (pro-labore, profits).
  const outgoing =
    kind === "expense" ||
    (kind === "partner" &&
      registrations.categories.find((category) => category.id === categoryId)?.kind === "partner_out");

  const save = async () => {
    const cents = parseCents(value);
    if (!cents || cents <= 0) return setProblem({ code: "invalid_data", field: "cents" });
    setBusy(true);
    setProblem(null);
    try {
      const result = await saveFinanceEntry({
        kind,
        accountId,
        toAccountId: kind === "transfer" ? toAccountId : null,
        cents: kind === "transfer" ? cents : outgoing ? -cents : cents,
        categoryId: kind === "transfer" ? null : categoryId || null,
        costCenterId: kind === "transfer" ? null : centerId || null,
        counterparty,
        description,
        occurredOn: day,
      });
      if (result.ok) onSaved();
      else setProblem({ code: result.code, field: result.field });
    } catch {
      setProblem({ code: "failed" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel
      onClose={onClose}
      closeLabel={t("finance-cancel")}
      icon={<NiMoney size="medium" />}
      tone="primary"
      busy={busy}
      title={t(NEW_KEY[kind])}
      description={t("finance-entry-panel-body")}
      onSubmit={() => void save()}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy || accounts.length === 0}>
            {busy ? t("finance-saving") : t("finance-save")}
          </Button>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("finance-cancel")}
          </Button>
        </>
      }
    >
      <Box className="flex flex-col gap-5">
        {problem ? (
          <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
            {t(financeErrorKey(problem.code))}
            {financeFieldKey(problem.field) ? ` ${t(financeFieldKey(problem.field) as string)}` : ""}
          </Alert>
        ) : null}
        {accounts.length === 0 ? <StateLine tone="attention">{t("finance-entry-no-account")}</StateLine> : null}
        <TextField
          select
          label={kind === "transfer" ? t("finance-field-from-account") : t("finance-field-account")}
          value={accountId}
          onChange={(event) => setAccountId(event.target.value)}
        >
          {accounts.map((account) => (
            <MenuItem key={account.id} value={account.id}>
              {account.name}
            </MenuItem>
          ))}
        </TextField>
        {kind === "transfer" ? (
          <TextField
            select
            label={t("finance-field-to-account")}
            value={toAccountId}
            onChange={(event) => setToAccountId(event.target.value)}
          >
            {accounts
              .filter((account) => account.id !== accountId)
              .map((account) => (
                <MenuItem key={account.id} value={account.id}>
                  {account.name}
                </MenuItem>
              ))}
          </TextField>
        ) : null}
        <CurrencyField
          label={t("finance-field-cents")}
          currencySymbol="R$"
          value={value}
          onChange={(event) => setValue(event.target.value)}
        />
        <TextField
          type="date"
          label={t("finance-field-day")}
          value={day}
          onChange={(event) => setDay(event.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
          helperText={t("finance-field-day-help")}
        />
        {kind !== "transfer" ? (
          <>
            <TextField
              select
              label={t("finance-field-category")}
              value={categoryId}
              onChange={(event) => setCategoryId(event.target.value)}
            >
              {categories.map((category) => (
                <MenuItem key={category.id} value={category.id}>
                  {category.name}
                </MenuItem>
              ))}
            </TextField>
            {centers.length > 0 ? (
              <TextField
                select
                label={t("finance-field-cost-center")}
                value={centerId}
                onChange={(event) => setCenterId(event.target.value)}
              >
                <MenuItem value="">{t("finance-field-cost-center-none")}</MenuItem>
                {centers.map((center) => (
                  <MenuItem key={center.id} value={center.id}>
                    {center.name}
                  </MenuItem>
                ))}
              </TextField>
            ) : null}
            <TextField
              label={t("finance-field-counterparty")}
              value={counterparty}
              onChange={(event) => setCounterparty(event.target.value.slice(0, 120))}
            />
          </>
        ) : null}
        <TextField
          label={t("finance-field-description")}
          value={description}
          multiline
          minRows={2}
          onChange={(event) => setDescription(event.target.value.slice(0, 300))}
        />
      </Box>
    </SidePanel>
  );
}
