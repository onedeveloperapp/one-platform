"use client";

import FinanceGate from "../finance-gate";
import type { FinanceState } from "../load-finance";
import AccountantCard from "./accountant-card";
import FeeTermsCard from "./fee-terms-card";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Card, CardContent, MenuItem, TextField, Typography } from "@mui/material";

import MoneyPath from "@/components/finance/money-path";
import CardTitle from "@/components/product/card-title";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import { CurrencyField } from "@/components/product/fields";
import PageHeader from "@/components/product/page-header";
import QuickActions from "@/components/product/quick-actions";
import SecondFactorPrompt from "@/components/product/second-factor-prompt";
import SidePanel from "@/components/product/side-panel";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import NiBuilding from "@/icons/nexture/ni-building";
import NiList from "@/icons/nexture/ni-list";
import NiMoney from "@/icons/nexture/ni-money";
import NiUsers from "@/icons/nexture/ni-users";
import { archiveFinanceRecord, saveFinanceAccount, saveFinanceCategory, setFinanceAccess } from "@/lib/finance/actions";
import {
  ACCOUNT_KIND_KEY,
  ACCOUNT_KINDS,
  type AccountKind,
  CATEGORY_KIND_KEY,
  type CategoryKind,
  configuresBooks,
  dayLabel,
  financeErrorKey,
  financeFieldKey,
  type FinanceLevel,
  LEVEL_KEY,
  money,
} from "@/lib/finance/books";
import type { FinanceAccountRow, FinanceCategory, FinanceCostCenter } from "@/lib/finance/read";
import { parseCents } from "@flyee/rules/finance";

type Ready = Extract<FinanceState, { kind: "ready" }>;
type Archiving = {
  table: "account" | "category" | "cost_center";
  id: string;
  name: string;
  archived: boolean;
  remove: boolean;
};

const EDIT_KINDS: CategoryKind[] = ["income", "expense", "client_money", "partner_in", "partner_out"];
const GRANTS: FinanceLevel[] = ["none", "costs", "view", "operate", "configure"];

/**
 * `/financeiro/configuracao`: the registrations of the books (migration 0126), in the pattern of a registration: the
 * accounts, the chart of accounts and the cost centres, each created and changed in the side panel, archived with its
 * reason when an entry uses it and deleted only when nothing does; and who of the firm reads what of the books, which
 * only who decides for the firm grants. Every write asks the second factor.
 */
export default function FinanceSettingsView({ state }: { state: FinanceState }) {
  const t = useTranslations("product");
  if (state.kind !== "ready") return <FinanceGate state={state} title={t("finance-settings-title")} />;
  return <Settings state={state} />;
}

function Settings({ state }: { state: Ready }) {
  const t = useTranslations("product");
  const router = useRouter();
  const configures = configuresBooks(state.level) && !state.supportVisit;
  const [account, setAccount] = useState<FinanceAccountRow | "new" | null>(null);
  const [category, setCategory] = useState<{
    table: "category" | "cost_center";
    row: FinanceCategory | FinanceCostCenter | null;
  } | null>(null);
  const [archiving, setArchiving] = useState<Archiving | null>(null);
  const [factor, setFactor] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { accounts, categories, costCenters } = state.registrations;
  const refresh = () => router.refresh();

  const act = async (run: () => Promise<{ ok: boolean; code?: string }>) => {
    setProblem(null);
    const result = await run();
    if (result.ok) refresh();
    else if (result.code === "second_factor") setFactor(true);
    else setProblem(result.code ?? "failed");
  };

  const archiveActions = (table: Archiving["table"], id: string, name: string, archived: boolean) => [
    {
      key: "archive",
      label: archived ? t("finance-restore") : t("finance-archive"),
      onClick: () =>
        archived
          ? void act(() => archiveFinanceRecord(table, id, null))
          : setArchiving({ table, id, name, archived, remove: false }),
    },
    {
      key: "delete",
      label: t("finance-delete"),
      onClick: () => setArchiving({ table, id, name, archived, remove: true }),
    },
  ];

  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title={t("finance-settings-title")}
        crumbs={[{ label: t("finance-crumb"), href: "/financeiro" }, { label: t("finance-settings-title") }]}
        description={t("finance-settings-description")}
        detail={
          state.home.openedOn ? (
            <Typography variant="body2" className="text-text-secondary">
              {t("finance-settings-first-day", { day: dayLabel(state.home.openedOn) })}
            </Typography>
          ) : null
        }
      />
      {!configures ? <StateLine tone="info">{t("finance-settings-read-only")}</StateLine> : null}
      {factor ? (
        <SecondFactorPrompt
          state={state.factor === "missing" ? "missing" : "challenge"}
          onConfirmed={() => setFactor(false)}
        />
      ) : null}
      {problem ? (
        <Alert
          severity="error"
          className="neutral bg-background-paper/60!"
          role="alert"
          onClose={() => setProblem(null)}
        >
          {t(financeErrorKey(problem))}
        </Alert>
      ) : null}

      <Card component="section" id="contas" aria-labelledby="finance-settings-accounts">
        <CardContent className="flex flex-col gap-4">
          <CardTitle
            id="finance-settings-accounts"
            icon={<NiBuilding size="medium" />}
            tone="primary"
            title={t("finance-accounts-title")}
            description={t("finance-accounts-description")}
            actions={
              configures ? (
                <Button size="small" variant="contained" onClick={() => setAccount("new")}>
                  {t("finance-accounts-add")}
                </Button>
              ) : null
            }
          />
          <Box component="ul" className="m-0 flex list-none flex-col p-0">
            {accounts.map((row) => (
              <Box
                component="li"
                key={row.id}
                className="border-grey-100 flex items-start justify-between gap-3 border-b py-3 last:border-b-0"
              >
                <Box className="flex min-w-0 flex-col gap-1">
                  <Button
                    variant="text"
                    color="inherit"
                    className="justify-start p-0 text-left font-semibold"
                    disabled={!configures}
                    onClick={() => setAccount(row)}
                  >
                    {row.name}
                  </Button>
                  <Typography variant="body2" className="text-text-secondary">
                    {[
                      t(ACCOUNT_KIND_KEY[row.kind]),
                      row.institution,
                      row.numberTail ? `final ${row.numberTail}` : null,
                      t("finance-account-opening", { value: money(row.openingCents) }),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Typography>
                  {row.archived ? (
                    <StateLine tone="info">{t("finance-archived", { reason: row.archivedReason ?? "" })}</StateLine>
                  ) : null}
                </Box>
                {configures ? (
                  <QuickActions
                    label={t("finance-record-actions")}
                    actions={archiveActions("account", row.id, row.name, row.archived)}
                  />
                ) : null}
              </Box>
            ))}
          </Box>
        </CardContent>
      </Card>

      <Card component="section" aria-labelledby="finance-settings-chart">
        <CardContent className="flex flex-col gap-4">
          <CardTitle
            id="finance-settings-chart"
            icon={<NiList size="medium" />}
            tone="secondary"
            title={t("finance-chart-title")}
            description={t("finance-chart-description")}
            actions={
              configures ? (
                <Box className="flex flex-wrap gap-2">
                  <Button
                    size="small"
                    variant="contained"
                    onClick={() => setCategory({ table: "category", row: null })}
                  >
                    {t("finance-chart-add")}
                  </Button>
                  <Button
                    size="small"
                    variant="outlined"
                    color="grey"
                    onClick={() => setCategory({ table: "cost_center", row: null })}
                  >
                    {t("finance-centers-add")}
                  </Button>
                </Box>
              ) : null
            }
          />
          {(["income", "expense", "client_money", "partner_in", "partner_out", "transfer"] as CategoryKind[]).map(
            (kind) => {
              const ofKind = categories.filter((row) => row.kind === kind);
              if (ofKind.length === 0) return null;
              return (
                <Box key={kind} className="flex flex-col gap-1">
                  <Typography variant="subtitle2" component="h3" className="mb-0">
                    {t(CATEGORY_KIND_KEY[kind])}
                  </Typography>
                  <Box component="ul" className="m-0 flex list-none flex-col p-0">
                    {ofKind.map((row) => (
                      <Box component="li" key={row.id} className="flex items-center justify-between gap-2 py-1">
                        <Typography
                          variant="body2"
                          className={row.archived ? "text-text-secondary line-through" : undefined}
                        >
                          {row.name}
                        </Typography>
                        {configures && row.kind !== "transfer" ? (
                          <QuickActions
                            label={t("finance-record-actions")}
                            actions={[
                              {
                                key: "edit",
                                label: t("finance-edit"),
                                onClick: () => setCategory({ table: "category", row }),
                              },
                              ...archiveActions("category", row.id, row.name, row.archived),
                            ]}
                          />
                        ) : null}
                      </Box>
                    ))}
                  </Box>
                </Box>
              );
            },
          )}
          <Box className="flex flex-col gap-1">
            <Typography variant="subtitle2" component="h3" className="mb-0">
              {t("finance-centers-title")}
            </Typography>
            <Box component="ul" className="m-0 flex list-none flex-col p-0">
              {costCenters.map((row) => (
                <Box component="li" key={row.id} className="flex items-center justify-between gap-2 py-1">
                  <Typography variant="body2" className={row.archived ? "text-text-secondary line-through" : undefined}>
                    {row.name}
                  </Typography>
                  {configures ? (
                    <QuickActions
                      label={t("finance-record-actions")}
                      actions={[
                        {
                          key: "edit",
                          label: t("finance-edit"),
                          onClick: () => setCategory({ table: "cost_center", row }),
                        },
                        ...archiveActions("cost_center", row.id, row.name, row.archived),
                      ]}
                    />
                  ) : null}
                </Box>
              ))}
            </Box>
          </Box>
          <Typography variant="caption" className="text-text-secondary">
            {t("finance-chart-provisional")}
          </Typography>
        </CardContent>
      </Card>

      <FeeTermsCard
        terms={state.feeTerms ?? []}
        decides={state.decides && !state.supportVisit}
        factor={state.factor}
        contract={state.feeContract ?? null}
      />

      <AccountantCard accountant={state.accountant} configures={configures} factor={state.factor} />

      <Card component="section" aria-labelledby="finance-settings-money-path">
        <CardContent className="flex flex-col gap-4">
          <CardTitle
            id="finance-settings-money-path"
            icon={<NiMoney size="medium" />}
            tone="primary"
            title={t("money-path-title")}
            description={t("money-path-description")}
          />
          <MoneyPath caseId={null} writes={configuresBooks(state.level) && !state.supportVisit} />
        </CardContent>
      </Card>

      {state.people ? (
        <Card component="section" aria-labelledby="finance-settings-access">
          <CardContent className="flex flex-col gap-4">
            <CardTitle
              id="finance-settings-access"
              icon={<NiUsers size="medium" />}
              tone="accent-1"
              title={t("finance-access-title")}
              description={t("finance-access-description")}
            />
            <Box component="ul" className="m-0 flex list-none flex-col p-0">
              {state.people.map((person) => (
                <Box
                  component="li"
                  key={person.userId}
                  className="border-grey-100 flex flex-col gap-2 border-b py-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
                >
                  <Box className="flex min-w-0 flex-col">
                    <Typography variant="body1">{person.name || person.email}</Typography>
                    {person.name && person.email ? (
                      <Typography variant="body2" className="text-text-secondary">
                        {person.email}
                      </Typography>
                    ) : null}
                  </Box>
                  {person.decides ? (
                    <StatusChip tone="positive" label={t("finance-access-decides")} />
                  ) : (
                    <TextField
                      select
                      size="small"
                      label={t("finance-field-level")}
                      value={person.level}
                      disabled={!configures || state.supportVisit}
                      onChange={(event) => void act(() => setFinanceAccess(person.userId, event.target.value))}
                      className="sm:min-w-56"
                    >
                      {GRANTS.map((level) => (
                        <MenuItem key={level} value={level}>
                          {t(LEVEL_KEY[level])}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
                </Box>
              ))}
            </Box>
          </CardContent>
        </Card>
      ) : null}

      {account ? (
        <AccountPanel
          row={account === "new" ? null : account}
          onClose={() => setAccount(null)}
          onSaved={() => {
            setAccount(null);
            refresh();
          }}
        />
      ) : null}
      {category ? (
        <CategoryPanel
          table={category.table}
          row={category.row}
          onClose={() => setCategory(null)}
          onSaved={() => {
            setCategory(null);
            refresh();
          }}
        />
      ) : null}
      {archiving ? (
        <ConfirmActionDialog
          title={
            archiving.remove
              ? t("finance-delete-title", { name: archiving.name })
              : t("finance-archive-title", { name: archiving.name })
          }
          consequences={archiving.remove ? [t("finance-delete-consequence")] : [t("finance-archive-consequence")]}
          reasonLabel={archiving.remove ? undefined : t("finance-field-reason")}
          reasonMinLength={archiving.remove ? undefined : 3}
          requireReason={!archiving.remove}
          confirmLabel={archiving.remove ? t("finance-delete") : t("finance-archive")}
          cancelLabel={t("finance-cancel")}
          tone={archiving.remove ? "danger" : "warning"}
          onClose={() => setArchiving(null)}
          onConfirm={async (reason) => {
            const result = await archiveFinanceRecord(
              archiving.table,
              archiving.id,
              archiving.remove ? null : reason,
              archiving.remove,
            );
            if (!result.ok) return t(financeErrorKey(result.code));
            setArchiving(null);
            refresh();
            return null;
          }}
        />
      ) : null}
    </Box>
  );
}

function AccountPanel({
  row,
  onClose,
  onSaved,
}: {
  row: FinanceAccountRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [kind, setKind] = useState<AccountKind>(row?.kind ?? "bank");
  const [name, setName] = useState(row?.name ?? "");
  const [institution, setInstitution] = useState(row?.institution ?? "");
  const [tail, setTail] = useState(row?.numberTail ?? "");
  const [opening, setOpening] = useState(row ? (row.openingCents / 100).toFixed(2) : "");
  const [closing, setClosing] = useState(row?.closingDay ? String(row.closingDay) : "");
  const [due, setDue] = useState(row?.dueDay ? String(row.dueDay) : "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ code: string; field?: string } | null>(null);

  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await saveFinanceAccount(row?.id ?? null, {
        kind,
        name,
        institution,
        numberTail: tail,
        openingCents: opening.trim() === "" ? 0 : (parseCents(opening) ?? Number.NaN),
        closingDay: kind === "card" && closing ? Number(closing) : null,
        dueDay: kind === "card" && due ? Number(due) : null,
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
      icon={<NiBuilding size="medium" />}
      tone="primary"
      busy={busy}
      title={row ? t("finance-account-edit", { name: row.name }) : t("finance-accounts-add")}
      description={t("finance-account-panel-body")}
      onSubmit={() => void save()}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy}>
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
        <TextField
          select
          label={t("finance-field-kind")}
          value={kind}
          onChange={(event) => setKind(event.target.value as AccountKind)}
        >
          {ACCOUNT_KINDS.map((option) => (
            <MenuItem key={option} value={option}>
              {t(ACCOUNT_KIND_KEY[option])}
            </MenuItem>
          ))}
        </TextField>
        <TextField
          label={t("finance-field-name")}
          value={name}
          onChange={(event) => setName(event.target.value.slice(0, 80))}
        />
        <TextField
          label={t("finance-field-institution")}
          value={institution}
          onChange={(event) => setInstitution(event.target.value.slice(0, 80))}
        />
        <TextField
          label={t("finance-field-number-tail")}
          value={tail}
          onChange={(event) => setTail(event.target.value.replace(/[^0-9A-Za-z-]/g, "").slice(0, 8))}
          helperText={t("finance-field-number-tail-help")}
        />
        <CurrencyField
          label={t("finance-field-opening")}
          currencySymbol="R$"
          value={opening}
          onChange={(event) => setOpening(event.target.value)}
        />
        {kind === "card" ? (
          <Box className="grid grid-cols-2 gap-4">
            <TextField
              label={t("finance-field-closing-day")}
              value={closing}
              inputMode="numeric"
              onChange={(event) => setClosing(event.target.value.replace(/\D/g, "").slice(0, 2))}
            />
            <TextField
              label={t("finance-field-due-day")}
              value={due}
              inputMode="numeric"
              onChange={(event) => setDue(event.target.value.replace(/\D/g, "").slice(0, 2))}
            />
          </Box>
        ) : null}
      </Box>
    </SidePanel>
  );
}

function CategoryPanel({
  table,
  row,
  onClose,
  onSaved,
}: {
  table: "category" | "cost_center";
  row: FinanceCategory | FinanceCostCenter | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const isCategory = table === "category";
  const existing = row as FinanceCategory | null;
  const [name, setName] = useState(row?.name ?? "");
  const [kind, setKind] = useState<CategoryKind>(isCategory && existing ? existing.kind : "expense");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ code: string; field?: string } | null>(null);

  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await saveFinanceCategory(table, row?.id ?? null, {
        name,
        kind: isCategory ? kind : undefined,
        dreLine: isCategory ? (existing?.dreLine ?? null) : null,
        dfcLine: isCategory ? (existing?.dfcLine ?? null) : null,
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
      icon={<NiList size="medium" />}
      tone="secondary"
      busy={busy}
      title={
        isCategory
          ? row
            ? t("finance-chart-edit")
            : t("finance-chart-add")
          : row
            ? t("finance-centers-edit")
            : t("finance-centers-add")
      }
      onSubmit={() => void save()}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy}>
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
        <TextField
          label={t("finance-field-name")}
          value={name}
          onChange={(event) => setName(event.target.value.slice(0, 80))}
        />
        {isCategory ? (
          <TextField
            select
            label={t("finance-field-kind")}
            value={kind}
            onChange={(event) => setKind(event.target.value as CategoryKind)}
          >
            {EDIT_KINDS.map((option) => (
              <MenuItem key={option} value={option}>
                {t(CATEGORY_KIND_KEY[option])}
              </MenuItem>
            ))}
          </TextField>
        ) : null}
      </Box>
    </SidePanel>
  );
}
