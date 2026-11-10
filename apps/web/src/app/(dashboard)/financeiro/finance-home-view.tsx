"use client";

import EntryPanel, { type ManualKind, NEW_KEY } from "./entry-panel";
import FinanceGate from "./finance-gate";
import type { FinanceState } from "./load-finance";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Box, Button, Card, CardContent, Grid, Typography } from "@mui/material";

import CardTitle from "@/components/product/card-title";
import EmptyState from "@/components/product/empty-state";
import NumberCard, { type NumberComparison } from "@/components/product/number-card";
import PageHeader from "@/components/product/page-header";
import QuickActions from "@/components/product/quick-actions";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import IllustrationAccounts from "@/icons/illustrations/illustration-accounts";
import IllustrationAnalytics from "@/icons/illustrations/illustration-analytics";
import NiArrowRight from "@/icons/nexture/ni-arrow-right";
import NiBuilding from "@/icons/nexture/ni-building";
import NiMoney from "@/icons/nexture/ni-money";
import NiMoneyBag from "@/icons/nexture/ni-money-bag";
import NiWallet from "@/icons/nexture/ni-wallet";
import { ACCOUNT_KIND_KEY, dayLabel, ENTRY_KIND_KEY, money, operatesBooks } from "@/lib/finance/books";
import { compared } from "@/lib/numbers/compare";

/**
 * `/financeiro`: where the firm's money stands (phase 4 of the plan, migration 0126). Who reads the books comes here to
 * know how much there is in the accounts, what came in and went out this month against the same days of the month
 * before, how much of what is in the accounts is clients' money (never the firm's), and what waits for somebody. Who
 * operates writes an entry from here, and every number leads to its list.
 */
export default function FinanceHomeView({ state }: { state: FinanceState }) {
  const t = useTranslations("product");
  const router = useRouter();
  const [writing, setWriting] = useState<ManualKind | null>(null);
  if (state.kind !== "ready") return <FinanceGate state={state} title={t("finance-title")} />;

  const { home } = state;
  const writes = operatesBooks(state.level) && !state.supportVisit;
  const comparison = (now: number, before: number, hope: "up" | "down" | null): NumberComparison => {
    const move = compared(now, before);
    const delta = move.move === "same" ? null : `${move.difference > 0 ? "+" : "-"}${money(Math.abs(move.difference))}`;
    return {
      delta:
        move.percent !== null && move.move !== "same"
          ? `${move.difference > 0 ? "+" : "-"}${Math.abs(move.percent)}%`
          : delta,
      same: t("finance-same"),
      hoped: hope !== null && move.move === hope,
      text: t("finance-vs-before", { value: money(before) }),
    };
  };
  const accounts = home.accounts.filter((account) => !account.archived);

  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title={t("finance-title")}
        crumbs={[{ label: t("finance-crumb") }]}
        description={t("finance-description")}
        action={
          <Box className="flex flex-wrap items-center gap-2">
            <Button component={Link} href="/financeiro/contas" variant="outlined" color="grey" size="small">
              {t("finance-bills-link")}
            </Button>
            {writes ? (
              <QuickActions
                label={t("finance-new")}
                text={t("finance-new")}
                actions={(["income", "expense", "transfer", "client_money", "partner"] as ManualKind[]).map((kind) => ({
                  key: kind,
                  label: t(NEW_KEY[kind]),
                  onClick: () => setWriting(kind),
                }))}
              />
            ) : null}
          </Box>
        }
      />

      {home.pendingLines > 0 ? (
        <StateLine
          tone="attention"
          action={
            <Button component={Link} href="/financeiro/conciliacao" size="small" variant="text">
              {t("finance-pending-open")}
            </Button>
          }
        >
          {t("finance-pending-lines", { count: home.pendingLines })}
        </StateLine>
      ) : null}
      {state.attention && state.attention.apart.count > 0 ? (
        <StateLine
          tone="attention"
          action={
            <Button component={Link} href="/financeiro/lancamentos?ver=separar" size="small" variant="text">
              {t("finance-apart-open")}
            </Button>
          }
        >
          {t("finance-apart-owed", {
            count: state.attention.apart.count,
            value: money(state.attention.apart.cents),
          })}
        </StateLine>
      ) : null}
      {state.attention && state.attention.bills.payLate + state.attention.bills.receiveLate > 0 ? (
        <StateLine
          tone="attention"
          action={
            <Button component={Link} href="/financeiro/contas?ver=vencidas" size="small" variant="text">
              {t("finance-bills-open")}
            </Button>
          }
        >
          {t("finance-bills-late-line", {
            pay: state.attention.bills.payLate,
            receive: state.attention.bills.receiveLate,
          })}
        </StateLine>
      ) : null}
      {state.attention && state.attention.late.length > 0 ? (
        <StateLine
          tone="attention"
          action={
            writes ? (
              <Button component={Link} href="/financeiro/conciliacao" size="small" variant="text">
                {t("finance-late-open")}
              </Button>
            ) : undefined
          }
        >
          {t("finance-late-accounts", {
            count: state.attention.late.length,
            names: state.attention.late.map((account) => account.name).join(", "),
          })}
        </StateLine>
      ) : null}

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <NumberCard
            icon={<NiBuilding size="medium" />}
            tone="primary"
            label={t("finance-number-balance")}
            value={money(home.numbers.balance.now)}
            comparison={comparison(home.numbers.balance.now, home.numbers.balance.before, null)}
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <NumberCard
            icon={<NiMoney size="medium" />}
            tone="secondary"
            label={t("finance-number-income")}
            value={money(home.numbers.income.now)}
            comparison={comparison(home.numbers.income.now, home.numbers.income.before, "up")}
            href="/financeiro/lancamentos?ver=receitas"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <NumberCard
            icon={<NiWallet size="medium" />}
            tone="accent-2"
            label={t("finance-number-expense")}
            value={money(home.numbers.expense.now)}
            comparison={comparison(home.numbers.expense.now, home.numbers.expense.before, "down")}
            href="/financeiro/lancamentos?ver=despesas"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <NumberCard
            icon={<NiMoneyBag size="medium" />}
            tone="accent-1"
            label={t("finance-number-client-money")}
            hint={t("finance-number-client-money-hint")}
            value={money(home.numbers.clientMoney.now)}
            comparison={comparison(home.numbers.clientMoney.now, home.numbers.clientMoney.before, null)}
            href="/financeiro/lancamentos?ver=cliente"
          />
        </Grid>
      </Grid>

      <Grid container spacing={3}>
        <Grid size={{ xs: 12, lg: 6 }}>
          <Card component="section" aria-labelledby="finance-accounts" className="h-full">
            <CardContent className="flex flex-col gap-4">
              <CardTitle
                id="finance-accounts"
                icon={<NiBuilding size="medium" />}
                tone="primary"
                title={t("finance-accounts-title")}
                description={t("finance-accounts-description")}
                actions={
                  <Box className="flex flex-wrap gap-2">
                    {writes ? (
                      <Button
                        component={Link}
                        href="/financeiro/conciliacao"
                        size="small"
                        variant="outlined"
                        color="grey"
                      >
                        {t("finance-import")}
                      </Button>
                    ) : null}
                    <Button component={Link} href="/financeiro/configuracao" size="small" variant="text" color="grey">
                      {t("finance-configure")}
                    </Button>
                  </Box>
                }
              />
              {accounts.length === 0 ? (
                <EmptyState
                  icon={<NiBuilding size="large" />}
                  illustration={<IllustrationAccounts />}
                  title={t("finance-accounts-empty")}
                  titleAs="h3"
                  framed={false}
                  action={{
                    label: t("finance-accounts-add"),
                    onClick: () => router.push("/financeiro/configuracao#contas"),
                  }}
                />
              ) : (
                <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
                  {accounts.map((account) => (
                    <Box
                      component="li"
                      key={account.id}
                      className="border-grey-100 flex flex-col gap-1 border-b pb-3 last:border-b-0"
                    >
                      <Box className="flex flex-wrap items-baseline justify-between gap-2">
                        <Typography variant="body1" className="font-semibold">
                          {account.name}
                        </Typography>
                        <Typography variant="body1" className="font-semibold tabular-nums">
                          {money(account.balanceCents)}
                        </Typography>
                      </Box>
                      <Typography variant="body2" className="text-text-secondary">
                        {[
                          t(ACCOUNT_KIND_KEY[account.kind]),
                          account.institution,
                          account.numberTail ? `final ${account.numberTail}` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </Typography>
                      {account.pending > 0 ? (
                        <StateLine tone="attention">
                          {t("finance-account-pending", { count: account.pending })}
                        </StateLine>
                      ) : null}
                      {account.balanceGapCents !== null && account.balanceGapCents !== 0 ? (
                        <StateLine tone="attention">
                          {t("finance-account-gap", { gap: money(Math.abs(account.balanceGapCents)) })}
                        </StateLine>
                      ) : account.lastStatement ? (
                        <StateLine tone="done">
                          {t("finance-account-agrees", { day: dayLabel(account.lastStatement) })}
                        </StateLine>
                      ) : null}
                    </Box>
                  ))}
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
        <Grid size={{ xs: 12, lg: 6 }}>
          <Card component="section" aria-labelledby="finance-latest" className="h-full">
            <CardContent className="flex flex-col gap-4">
              <CardTitle
                id="finance-latest"
                icon={<NiMoney size="medium" />}
                tone="secondary"
                title={t("finance-latest-title")}
                actions={
                  <Button
                    component={Link}
                    href="/financeiro/lancamentos"
                    size="small"
                    variant="text"
                    color="grey"
                    endIcon={<NiArrowRight size="small" />}
                  >
                    {t("finance-latest-all")}
                  </Button>
                }
              />
              {home.latest.length === 0 ? (
                <EmptyState
                  icon={<NiMoney size="large" />}
                  illustration={<IllustrationAnalytics />}
                  title={t("finance-latest-empty")}
                  description={t("finance-latest-empty-body")}
                  titleAs="h3"
                  framed={false}
                />
              ) : (
                <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
                  {home.latest.map((entry) => (
                    <Box component="li" key={entry.id} className="flex items-start justify-between gap-3">
                      <Box className="flex min-w-0 flex-col">
                        <Typography variant="body1" className="truncate">
                          {entry.counterparty ?? entry.description ?? entry.category ?? t(ENTRY_KIND_KEY[entry.kind])}
                        </Typography>
                        <Typography variant="body2" className="text-text-secondary">
                          {[
                            dayLabel(entry.occurredOn),
                            entry.category ?? t(ENTRY_KIND_KEY[entry.kind]),
                            entry.account,
                          ].join(" · ")}
                        </Typography>
                        {entry.byOne ? (
                          <Box className="mt-1">
                            <StatusChip tone="neutral" label={t("finance-by-one")} />
                          </Box>
                        ) : null}
                      </Box>
                      <Typography variant="body1" className="shrink-0 tabular-nums">
                        {money(entry.cents)}
                      </Typography>
                    </Box>
                  ))}
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>

      <Typography variant="caption" className="text-text-secondary">
        {t("finance-money-line")}
      </Typography>

      {writing ? (
        <EntryPanel
          kind={writing}
          registrations={state.registrations}
          onClose={() => setWriting(null)}
          onSaved={() => {
            setWriting(null);
            router.refresh();
          }}
        />
      ) : null}
    </Box>
  );
}
