"use client";

import type { FinanceState } from "./load-finance";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Card, CardContent, MenuItem, TextField, Typography } from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import { CurrencyField } from "@/components/product/fields";
import PageHeader from "@/components/product/page-header";
import SecondFactorPrompt from "@/components/product/second-factor-prompt";
import SetupWizard from "@/components/product/setup-wizard";
import StateLine from "@/components/product/state-line";
import NiMoney from "@/icons/nexture/ni-money";
import { openFinanceBooks, saveFinanceAccount } from "@/lib/finance/actions";
import {
  ACCOUNT_KIND_KEY,
  ACCOUNT_KINDS,
  type AccountKind,
  financeErrorKey,
  financeFieldKey,
} from "@/lib/finance/books";
import { parseCents } from "@flyee/rules/finance";

/** The first day of the current month in Brasília, "YYYY-MM-DD": the books' first day the setup proposes. */
function monthStart(): string {
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
  return `${today.slice(0, 8)}01`;
}

/**
 * What a page of the books shows before them: the books' own setup for who decides for the firm while they are not
 * open (the second factor, their first day, their first account; never a step of the firm's setup), the words for
 * anybody else, and for who reads only the costs of the cases, that the books are not theirs.
 */
export default function FinanceGate({
  state,
  title,
}: {
  state: Exclude<FinanceState, { kind: "ready" }>;
  title: string;
}) {
  const t = useTranslations("product");
  const header = <PageHeader title={title} crumbs={[{ label: t("finance-crumb") }]} />;
  if (state.kind === "closed" && state.decides) {
    return (
      <Box className="flex flex-col gap-6">
        {header}
        <OpenBooks factor={state.factor} />
      </Box>
    );
  }
  const words =
    state.kind === "closed"
      ? { title: "finance-closed-title", body: state.supportVisit ? "finance-closed-visit" : "finance-closed-body" }
      : state.kind === "not-reader"
        ? { title: "finance-not-reader-title", body: "finance-not-reader-body" }
        : state.kind === "no-firm"
          ? { title: "finance-no-firm-title", body: "finance-no-firm-body" }
          : { title: "finance-error-title", body: "finance-error-body" };
  return (
    <Box className="flex flex-col gap-6">
      {header}
      <Card>
        <CardContent>
          <EmptyState icon={<NiMoney size="large" />} title={t(words.title)} description={t(words.body)} titleAs="h2" />
        </CardContent>
      </Card>
    </Box>
  );
}

/** The books' own setup: the second factor first (every write of the books asks it), then their first day and account. */
function OpenBooks({ factor }: { factor: "ok" | "challenge" | "missing" }) {
  const t = useTranslations("product");
  const router = useRouter();
  const [confirmed, setConfirmed] = useState(factor === "ok");
  const [firstDay, setFirstDay] = useState(monthStart());
  const [kind, setKind] = useState<AccountKind>("bank");
  const [name, setName] = useState("");
  const [institution, setInstitution] = useState("");
  const [tail, setTail] = useState("");
  const [opening, setOpening] = useState("");
  const [problem, setProblem] = useState<{ code: string; field?: string } | null>(null);

  const say = (code: string, field?: string) => setProblem({ code, field });

  return (
    <Card>
      <CardContent className="flex flex-col gap-4">
        <Typography variant="h6" component="h2" className="mb-0">
          {t("finance-open-title")}
        </Typography>
        {problem ? (
          <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
            {t(financeErrorKey(problem.code))}
            {financeFieldKey(problem.field) ? ` ${t(financeFieldKey(problem.field) as string)}` : ""}
          </Alert>
        ) : null}
        <SetupWizard
          completeLabel={t("finance-open-complete")}
          initialIndex={confirmed ? 1 : 0}
          onComplete={() => router.refresh()}
          steps={[
            {
              title: t("finance-open-factor"),
              hint: t("finance-open-factor-hint"),
              canAdvance: confirmed,
              content: confirmed ? (
                <StateLine tone="done">{t("finance-open-factor-done")}</StateLine>
              ) : (
                <SecondFactorPrompt
                  state={factor === "missing" ? "missing" : "challenge"}
                  onConfirmed={() => setConfirmed(true)}
                />
              ),
            },
            {
              title: t("finance-open-day"),
              hint: t("finance-open-day-hint"),
              content: (
                <TextField
                  type="date"
                  label={t("finance-field-first-day")}
                  value={firstDay}
                  onChange={(event) => setFirstDay(event.target.value)}
                  slotProps={{ inputLabel: { shrink: true } }}
                  className="max-w-64"
                />
              ),
              onPrimary: async () => {
                setProblem(null);
                const result = await openFinanceBooks(firstDay);
                if (!result.ok) say(result.code, result.field);
                return result.ok;
              },
            },
            {
              title: t("finance-open-account"),
              hint: t("finance-open-account-hint"),
              content: (
                <Box className="grid gap-4 sm:grid-cols-2">
                  <TextField
                    select
                    label={t("finance-field-kind")}
                    value={kind}
                    onChange={(event) => setKind(event.target.value as AccountKind)}
                  >
                    {ACCOUNT_KINDS.filter((option) => option !== "card").map((option) => (
                      <MenuItem key={option} value={option}>
                        {t(ACCOUNT_KIND_KEY[option])}
                      </MenuItem>
                    ))}
                  </TextField>
                  <TextField
                    label={t("finance-field-name")}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                  <TextField
                    label={t("finance-field-institution")}
                    value={institution}
                    onChange={(event) => setInstitution(event.target.value)}
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
                    helperText={t("finance-field-opening-help", { day: firstDay.split("-").reverse().join("/") })}
                  />
                </Box>
              ),
              canAdvance: name.trim().length >= 2,
              onPrimary: async () => {
                setProblem(null);
                const result = await saveFinanceAccount(null, {
                  kind,
                  name,
                  institution,
                  numberTail: tail,
                  openingCents: opening.trim() === "" ? 0 : (parseCents(opening) ?? Number.NaN),
                  closingDay: null,
                  dueDay: null,
                });
                if (!result.ok) say(result.code, result.field);
                return result.ok;
              },
            },
          ]}
        />
      </CardContent>
    </Card>
  );
}
