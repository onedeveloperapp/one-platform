"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  MenuItem,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from "@mui/material";

import DocumentSlot, { type SlotState } from "@/components/cases/document-slot";
import CardTitle from "@/components/product/card-title";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import EmptyState from "@/components/product/empty-state";
import { CurrencyField } from "@/components/product/fields";
import OutcomeDialog from "@/components/product/outcome-dialog";
import PageHeader from "@/components/product/page-header";
import SecondFactorPrompt from "@/components/product/second-factor-prompt";
import SidePanel from "@/components/product/side-panel";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import { TILE_TONE } from "@/components/product/tile-tone";
import IllustrationPerformance from "@/icons/illustrations/illustration-performance";
import NiChartBar from "@/icons/nexture/ni-chart-bar";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiMoney from "@/icons/nexture/ni-money";
import { writeWorkbook, XLSX_TYPE } from "@/lib/export/xlsx-write";
import { savedFileName, saveFile } from "@/lib/files/save-file";
import { sendAccountantPackage } from "@/lib/finance/accountant-actions";
import { accountantPackage, FLOW_KEY, LINE_KEY, type MonthMovement } from "@/lib/finance/accountant-package";
import { openFinanceDocument } from "@/lib/finance/document-actions";
import { dropUnsavedFinance, sendInvoiceDocument } from "@/lib/finance/document-browser";
import {
  budgetStanding,
  DRE_ORDER,
  flowTotal,
  type Forecast,
  type InvoiceData,
  lineTotal,
  type Report,
  result,
} from "@/lib/finance/reports";
import {
  closeFinanceMonth,
  readFinanceMonthMovement,
  readFinanceReports,
  recordFinanceInvoice,
  reopenFinanceMonth,
  saveFinanceBudget,
} from "@/lib/finance/reports-actions";
import { formatCents, parseCents } from "@flyee/rules/finance";
import { formatDayBr } from "@flyee/rules/person";

const ERROR_KEY: Record<string, string> = {
  not_allowed: "reports-error-not-allowed",
  second_factor: "reports-error-second-factor",
  not_green: "reports-error-not-green",
  month_open: "reports-error-month-open",
  invalid_data: "reports-error-invalid",
  support_visit: "reports-error-support",
};
const SEND_ERROR_KEY: Record<string, string> = {
  no_accountant: "reports-package-send-no-accountant",
  email_off: "reports-package-send-email-off",
  not_allowed: "reports-error-not-allowed",
  second_factor: "reports-error-second-factor",
  support_visit: "reports-error-support",
};
const failedKey = (code: string) => (code === "not_reader" ? "reports-not-reader" : "reports-load-error");
const errorKey = (code: string) => ERROR_KEY[code] ?? "reports-error-failed";

const lastMonth = () => {
  const now = new Date(
    new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()) + "T12:00:00Z",
  );
  now.setUTCDate(1);
  now.setUTCMonth(now.getUTCMonth() - 1);
  return now.toISOString().slice(0, 7);
};

/**
 * The books' reports (phase 12): the month's income statement and cash flow against the month before and the same
 * month a year before, the 13 weeks ahead from the open bills, the closing with its checklist, the data of each invoice
 * of fees received and the accountant's package. Managerial reports, never the accounting; ONE computes no tax.
 */
type BudgetCategory = { id: string; name: string; kind: string };

export default function ReportsView({
  configures,
  factor: sessionFactor,
  categories,
  operates,
  accountant,
  emailOn,
}: {
  /** Who configures the books sets the budget (0163). */
  configures: boolean;
  /** Who operates the books sends the month's package to the firm's accountant (0166). */
  operates: boolean;
  accountant: { name: string; email: string } | null;
  /** Whether an e-mail leaves ONE where it runs. */
  emailOn: boolean;
  factor: "ok" | "challenge" | "missing";
  /** The chart's categories of income and expense in force, which a budget is set on. */
  categories: BudgetCategory[];
}) {
  const t = useTranslations("product");
  const [month, setMonth] = useState(lastMonth());
  const [state, setState] = useState<
    | { kind: "loading" }
    | { kind: "ready"; report: Report; forecast: Forecast | null; invoices: InvoiceData[] | null }
    | { kind: "error"; code: string }
  >({ kind: "loading" });
  const [problem, setProblem] = useState<string | null>(null);
  const [factor, setFactor] = useState(false);
  const [reopening, setReopening] = useState(false);
  const [invoicing, setInvoicing] = useState<InvoiceData | null>(null);
  const [budgeting, setBudgeting] = useState(false);
  const [sending, setSending] = useState(false);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const read = await readFinanceReports(month);
      setState(
        read.ok
          ? { kind: "ready", report: read.report, forecast: read.forecast, invoices: read.invoices }
          : { kind: "error", code: read.code },
      );
    } catch {
      setState({ kind: "error", code: "failed" });
    }
  }, [month]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (work: () => Promise<{ ok: true } | { ok: false; code: string }>) => {
    setProblem(null);
    const answer = await work();
    if (!answer.ok) {
      if (answer.code === "second_factor") setFactor(true);
      setProblem(t(errorKey(answer.code)));
    }
    await load();
    return answer;
  };

  // The invoice's file opens in a new tab, by a link of a minute (0165).
  const openInvoice = async (fileId: string) => {
    const link = await openFinanceDocument(fileId);
    if (link.ok) window.open(link.url, "_blank", "noopener,noreferrer");
    else setProblem(t("reports-invoice-open-failed"));
  };

  const ready = state.kind === "ready" ? state : null;
  const report = ready?.report ?? null;

  const [packing, setPacking] = useState(false);
  const download = async () => {
    if (!ready || !report) return;
    setPacking(true);
    let movement: MonthMovement[] | null = null;
    try {
      movement = await readFinanceMonthMovement(month);
    } catch {
      movement = null;
    } finally {
      setPacking(false);
    }
    if (!movement) {
      setProblem(t("reports-package-failed"));
      return;
    }
    const bytes = writeWorkbook(
      accountantPackage({ report, invoices: ready.invoices ?? [], movement, say: (key, values) => t(key, values) }),
    );
    saveFile(bytes, savedFileName(`${t("reports-package")} ${month}`, "xlsx", t("reports-package")), XLSX_TYPE);
  };

  const compare = (line: (lines: Report["current"]) => number) =>
    report ? [line(report.current), line(report.previous), line(report.lastYear)] : [0, 0, 0];

  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title={t("reports-title")}
        crumbs={[
          { label: t("approvals-home"), href: "/inicio" },
          { label: t("finance-title"), href: "/financeiro" },
          { label: t("reports-title") },
        ]}
        description={t("reports-description")}
        action={
          <Box className="flex flex-wrap items-center gap-2">
            <TextField
              size="small"
              type="month"
              label={t("reports-month")}
              value={month}
              onChange={(event) => setMonth(event.target.value || lastMonth())}
              slotProps={{ inputLabel: { shrink: true } }}
            />
            {report ? (
              <Button variant="outlined" color="grey" loading={packing} onClick={() => void download()}>
                {t("reports-package-download")}
              </Button>
            ) : null}
            {report && operates && accountant && emailOn ? (
              <Button variant="outlined" color="grey" onClick={() => setSending(true)}>
                {t("reports-package-send")}
              </Button>
            ) : null}
          </Box>
        }
      />
      <Alert severity="info" className="neutral bg-background-paper/60!">
        {t("reports-managerial")}
      </Alert>
      {problem ? (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
          {problem}
        </Alert>
      ) : null}
      {factor ? <SecondFactorPrompt state="challenge" onConfirmed={() => setFactor(false)} /> : null}
      {state.kind === "loading" ? <Skeleton variant="rounded" height={320} /> : null}
      {state.kind === "error" ? (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {t(failedKey(state.code))}
        </Alert>
      ) : null}
      {ready && report ? (
        <>
          <Card component="section" aria-labelledby="reports-closing">
            <CardContent className="flex flex-col gap-3">
              <CardTitle
                id="reports-closing"
                icon={<NiDocumentFull size="medium" />}
                title={t("reports-closing-title")}
                chip={
                  report.closing && !report.closing.reopenedAt ? (
                    <StatusChip
                      tone="positive"
                      label={t(report.closing.byOne ? "reports-closed-by-one" : "reports-closed")}
                    />
                  ) : (
                    <StatusChip tone="neutral" label={t("reports-open")} />
                  )
                }
                actions={
                  report.closing && !report.closing.reopenedAt ? (
                    <Button size="small" variant="text" onClick={() => setReopening(true)}>
                      {t("reports-reopen")}
                    </Button>
                  ) : (
                    <Button
                      size="small"
                      variant="contained"
                      disabled={!report.check.green}
                      onClick={() => void act(() => closeFinanceMonth(month))}
                    >
                      {t("reports-close")}
                    </Button>
                  )
                }
              />
              <StateLine tone={report.check.lines === 0 ? "done" : "attention"}>
                {t("reports-check-lines", { count: report.check.lines })}
              </StateLine>
              <StateLine tone={report.check.accounts === 0 ? "done" : "attention"}>
                {t("reports-check-accounts", { count: report.check.accounts })}
              </StateLine>
              <StateLine tone={report.check.apart === 0 ? "done" : "attention"}>
                {t("reports-check-apart", { count: report.check.apart })}
              </StateLine>
              {report.closing?.reopenReason ? (
                <StateLine tone="info">{t("reports-reopened", { reason: report.closing.reopenReason })}</StateLine>
              ) : null}
              {report.closing?.byOne && !report.closing.reopenedAt ? (
                <StateLine tone="info">{t("reports-closed-by-one-note")}</StateLine>
              ) : null}
              {report.closing && !report.closing.reopenedAt && report.closing.changedAfter > 0 ? (
                <StateLine tone="attention">
                  {t("reports-changed-after", { count: report.closing.changedAfter })}
                </StateLine>
              ) : null}
            </CardContent>
          </Card>

          <Card component="section" aria-labelledby="reports-dre">
            <CardContent className="flex flex-col gap-3">
              <CardTitle id="reports-dre" icon={<NiChartBar size="medium" />} title={t("reports-dre-title")} />
              {!report.current.taxes ? <StateLine tone="attention">{t("reports-taxes-missing")}</StateLine> : null}
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>{t("reports-col-line")}</TableCell>
                      <TableCell align="right">{t("reports-col-month")}</TableCell>
                      <TableCell align="right">{t("reports-col-previous")}</TableCell>
                      <TableCell align="right">{t("reports-col-last-year")}</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {[
                      ...DRE_ORDER.map((line) => ({
                        key: LINE_KEY[line],
                        values: compare((lines) => lineTotal(lines, line)),
                      })),
                      { key: "reports-line-losses", values: compare((lines) => -lines.losses) },
                      { key: "reports-line-result", values: compare(result), strong: true },
                      { key: "reports-line-distribution", values: compare((lines) => -lines.distribution) },
                    ].map((row) => (
                      <TableRow key={row.key}>
                        <TableCell className={"strong" in row ? "font-semibold" : ""}>{t(row.key)}</TableCell>
                        {row.values.map((value, index) => (
                          <TableCell key={index} align="right" className="tabular-nums">
                            {formatCents(value)}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>

          <Card component="section" aria-labelledby="reports-dfc">
            <CardContent className="flex flex-col gap-3">
              <CardTitle
                id="reports-dfc"
                icon={<NiMoney size="medium" />}
                title={t("reports-dfc-title")}
                description={t("reports-dfc-description")}
              />
              <TableContainer>
                <Table size="small">
                  <TableBody>
                    {["operacional", "investimento", "financiamento", "clientes"].map((line) => (
                      <TableRow key={line}>
                        <TableCell>{t(FLOW_KEY[line]!)}</TableCell>
                        <TableCell align="right" className="tabular-nums">
                          {formatCents(flowTotal(report.current, line))}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </TableContainer>
            </CardContent>
          </Card>

          <Card component="section" aria-labelledby="reports-budget">
            <CardContent className="flex flex-col gap-3">
              <CardTitle
                id="reports-budget"
                icon={<NiChartBar size="medium" />}
                title={t("reports-budget-title")}
                description={t("reports-budget-description")}
                actions={
                  configures ? (
                    <Button size="small" variant="outlined" color="grey" onClick={() => setBudgeting(true)}>
                      {t(report.budget.rows.length > 0 ? "reports-budget-change" : "reports-budget-set")}
                    </Button>
                  ) : undefined
                }
              />
              {report.budget.rows.length === 0 ? (
                <EmptyState
                  illustration={<IllustrationPerformance />}
                  layout="row"
                  framed={false}
                  title={t("reports-budget-none")}
                  titleAs="h3"
                />
              ) : (
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>{t("reports-col-category")}</TableCell>
                        <TableCell align="right">{t("reports-col-planned")}</TableCell>
                        <TableCell align="right">{t("reports-col-actual")}</TableCell>
                        <TableCell align="right">{t("reports-col-difference")}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {report.budget.rows.map((row) => {
                        const standing = budgetStanding(row);
                        return (
                          <TableRow key={row.categoryId}>
                            <TableCell>{row.category}</TableCell>
                            <TableCell align="right" className="tabular-nums">
                              {formatCents(row.planned)}
                            </TableCell>
                            <TableCell align="right" className="tabular-nums">
                              {formatCents(row.actual)}
                            </TableCell>
                            <TableCell align="right" className="tabular-nums">
                              <Box className="flex flex-wrap items-center justify-end gap-2">
                                {standing.attention ? (
                                  <StatusChip
                                    tone="attention"
                                    label={row.kind === "income" ? t("reports-budget-under") : t("reports-budget-over")}
                                  />
                                ) : null}
                                {t("reports-budget-difference", {
                                  value: formatCents(standing.difference),
                                  share: standing.share,
                                })}
                              </Box>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
              )}
              {report.budget.outsideIncome > 0 || report.budget.outsideExpense > 0 ? (
                <StateLine tone="info">
                  {t("reports-budget-outside", {
                    income: formatCents(report.budget.outsideIncome),
                    expense: formatCents(report.budget.outsideExpense),
                  })}
                </StateLine>
              ) : null}
            </CardContent>
          </Card>

          {report.current.centers.length > 0 ? (
            <Card component="section" aria-labelledby="reports-centers">
              <CardContent className="flex flex-col gap-3">
                <CardTitle
                  id="reports-centers"
                  icon={<NiChartBar size="medium" />}
                  title={t("reports-centers-title")}
                  description={t("reports-centers-description")}
                />
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>{t("reports-col-center")}</TableCell>
                        <TableCell align="right">{t("reports-col-income")}</TableCell>
                        <TableCell align="right">{t("reports-col-expense")}</TableCell>
                        <TableCell align="right">{t("reports-line-result")}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {report.current.centers.map((row) => (
                        <TableRow key={row.center ?? "none"}>
                          <TableCell>{row.center ?? t("reports-no-center")}</TableCell>
                          <TableCell align="right" className="tabular-nums">
                            {formatCents(row.income)}
                          </TableCell>
                          <TableCell align="right" className="tabular-nums">
                            {formatCents(row.expense)}
                          </TableCell>
                          <TableCell align="right" className="tabular-nums">
                            {formatCents(row.income - row.expense)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          ) : null}

          {report.current.partners.length > 0 ? (
            <Card component="section" aria-labelledby="reports-partners">
              <CardContent className="flex flex-col gap-3">
                <CardTitle
                  id="reports-partners"
                  icon={<NiMoney size="medium" />}
                  title={t("reports-partners-title")}
                  description={t("reports-partners-description")}
                />
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>{t("reports-col-partner")}</TableCell>
                        <TableCell>{t("reports-col-category")}</TableCell>
                        <TableCell align="right">{t("reports-col-month")}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {report.current.partners.map((row) => (
                        <TableRow key={`${row.partner}-${row.category}`}>
                          <TableCell>{row.partner}</TableCell>
                          <TableCell>{row.category}</TableCell>
                          <TableCell align="right" className="tabular-nums">
                            {formatCents(row.cents)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          ) : null}

          {ready.forecast ? (
            <Card component="section" aria-labelledby="reports-forecast">
              <CardContent className="flex flex-col gap-3">
                <CardTitle
                  id="reports-forecast"
                  icon={<NiChartBar size="medium" />}
                  title={t("reports-forecast-title")}
                  description={t("reports-forecast-description")}
                />
                {ready.forecast.expected.cents > 0 ? (
                  <StateLine tone="info">
                    {t("reports-expected-fees", {
                      value: formatCents(ready.forecast.expected.cents),
                      count: ready.forecast.expected.lawsuits,
                      final: formatCents(ready.forecast.expected.finalCents),
                    })}
                  </StateLine>
                ) : null}
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>{t("reports-col-week")}</TableCell>
                        <TableCell align="right">{t("reports-col-in")}</TableCell>
                        <TableCell align="right">{t("reports-col-out")}</TableCell>
                        <TableCell align="right">{t("reports-col-balance")}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {ready.forecast.weeks.map((week) => (
                        <TableRow key={week.startsOn}>
                          <TableCell>{formatDayBr(week.startsOn) ?? week.startsOn}</TableCell>
                          <TableCell align="right" className="tabular-nums">
                            {formatCents(week.inCents)}
                          </TableCell>
                          <TableCell align="right" className="tabular-nums">
                            {formatCents(week.outCents)}
                          </TableCell>
                          <TableCell align="right" className={`tabular-nums ${week.balance < 0 ? "text-error" : ""}`}>
                            {formatCents(week.balance)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>
          ) : null}

          {ready.invoices ? (
            <Card component="section" aria-labelledby="reports-invoices">
              <CardContent className="flex flex-col gap-3">
                <CardTitle
                  id="reports-invoices"
                  icon={<NiDocumentFull size="medium" />}
                  title={t("reports-invoices-title")}
                  description={t("reports-invoices-description")}
                />
                {ready.invoices.length === 0 ? (
                  <Typography variant="body2" className="text-text-secondary">
                    {t("reports-invoices-none")}
                  </Typography>
                ) : (
                  ready.invoices.map((item) => (
                    <Box
                      key={item.entryId}
                      className="border-grey-100 flex flex-wrap items-center gap-3 border-b py-2 last:border-b-0"
                    >
                      <Box className="flex min-w-0 flex-1 flex-col">
                        <Typography variant="body1" className="font-semibold">
                          {[item.caseSeq !== null ? `#${item.caseSeq}` : null, formatCents(item.cents)]
                            .filter(Boolean)
                            .join(" · ")}
                        </Typography>
                        <Typography variant="body2" className="text-text-secondary">
                          {[item.description, formatDayBr(item.competence) ?? item.competence].join(" · ")}
                        </Typography>
                      </Box>
                      {item.invoice ? (
                        <StateLine
                          tone="done"
                          action={
                            item.invoice.fileId ? (
                              <Button
                                size="small"
                                variant="text"
                                onClick={() => void openInvoice(item.invoice!.fileId!)}
                              >
                                {t("reports-invoice-open")}
                              </Button>
                            ) : undefined
                          }
                        >
                          {t("reports-invoice-issued", { number: item.invoice.number })}
                        </StateLine>
                      ) : (
                        <Button size="small" variant="outlined" color="grey" onClick={() => setInvoicing(item)}>
                          {t("reports-invoice-record")}
                        </Button>
                      )}
                    </Box>
                  ))
                )}
              </CardContent>
            </Card>
          ) : null}
        </>
      ) : null}

      {reopening ? (
        <ConfirmActionDialog
          title={t("reports-reopen-title")}
          intro={t("reports-reopen-intro")}
          consequences={[t("reports-reopen-consequence")]}
          reasonLabel={t("reports-reopen-reason")}
          reasonMinLength={8}
          requireReason
          confirmLabel={t("reports-reopen")}
          cancelLabel={t("reports-cancel")}
          onClose={() => setReopening(false)}
          onConfirm={async (reason) => {
            const answer = await act(() => reopenFinanceMonth(month, reason));
            if (!answer.ok) return t(errorKey(answer.code));
            setReopening(false);
            return null;
          }}
        />
      ) : null}
      {sending && accountant ? (
        <ConfirmActionDialog
          title={t("reports-package-send-title", { month: month.split("-").reverse().join("/") })}
          intro={t("reports-package-send-intro", { name: accountant.name, email: accountant.email })}
          consequences={[t("reports-package-send-holds"), t("reports-package-send-kept")]}
          confirmLabel={t("reports-package-send")}
          cancelLabel={t("reports-cancel")}
          onClose={() => setSending(false)}
          onConfirm={async () => {
            const answer = await sendAccountantPackage(month);
            if (!answer.ok) {
              return answer.code === "daily_limit"
                ? t("reports-package-send-limit", { count: answer.limit ?? 0 })
                : t(SEND_ERROR_KEY[answer.code] ?? "reports-package-send-failed");
            }
            setSending(false);
            setSentTo(answer.email);
            return null;
          }}
        />
      ) : null}
      <OutcomeDialog
        open={sentTo !== null}
        title={t("reports-package-sent-title")}
        lines={[
          {
            key: "to",
            icon: <NiDocumentFull size="small" />,
            text: t("reports-package-sent-to", { email: sentTo ?? "", month: month.split("-").reverse().join("/") }),
          },
          { key: "kept", icon: <NiChartBar size="small" />, text: t("reports-package-sent-kept") },
        ]}
        closeLabel={t("reports-understood")}
        onClose={() => setSentTo(null)}
      />
      {budgeting && report ? (
        <BudgetPanel
          month={month}
          categories={categories}
          current={report.budget.rows}
          factor={sessionFactor}
          onClose={() => setBudgeting(false)}
          onSave={async (rows, months) => {
            const answer = await act(() => saveFinanceBudget(month, rows, months));
            if (answer.ok) setBudgeting(false);
            return answer.ok ? null : t(errorKey(answer.code));
          }}
        />
      ) : null}
      {invoicing ? (
        <InvoicePanel
          item={invoicing}
          onClose={() => setInvoicing(null)}
          onSave={async (number, issuedOn, fileId) => {
            const answer = await act(() => recordFinanceInvoice(invoicing.entryId, number, issuedOn, fileId));
            if (answer.ok) setInvoicing(null);
            return answer.ok;
          }}
        />
      ) : null}
    </Box>
  );
}

/**
 * The invoice the firm issued for a fee received: its PDF or photo first, which ONE reads into the number and the day
 * (0165) and which is kept with the invoice; typing them is the other way in.
 */
function InvoicePanel({
  item,
  onClose,
  onSave,
}: {
  item: InvoiceData;
  onClose: () => void;
  onSave: (number: string, issuedOn: string, fileId: string | null) => Promise<boolean>;
}) {
  const t = useTranslations("product");
  const [number, setNumber] = useState("");
  const [issuedOn, setIssuedOn] = useState(item.competence);
  const [busy, setBusy] = useState(false);
  const [slot, setSlot] = useState<SlotState>({ kind: "empty" });
  const [fileName, setFileName] = useState<string | null>(null);
  const [fileId, setFileId] = useState<string | null>(null);
  const [read, setRead] = useState<{ number?: string; day?: string }>({});
  const reading = slot.kind === "sending" || slot.kind === "reading";

  const close = () => {
    dropUnsavedFinance([fileId]);
    onClose();
  };

  const sendInvoice = async (file: File) => {
    dropUnsavedFinance([fileId]);
    setFileId(null);
    setFileName(file.name);
    setSlot({ kind: "reading" });
    const sent = await sendInvoiceDocument(file, item.entryId);
    setFileId(sent.fileId);
    if (!sent.ok) {
      setSlot({ kind: "failed", sentence: t("reports-invoice-read-failed") });
      return;
    }
    const filled: { number?: string; day?: string } = {};
    if (sent.read.isInvoice && sent.read.number) {
      setNumber(sent.read.number);
      filled.number = sent.read.number;
    }
    if (sent.read.isInvoice && sent.read.issuedOn) {
      setIssuedOn(sent.read.issuedOn);
      filled.day = sent.read.issuedOn;
    }
    setRead(filled);
    const sentence = !sent.read.isInvoice
      ? t("reports-invoice-read-other")
      : sent.read.matches === false
        ? t("reports-invoice-read-other-value", { value: formatCents(sent.read.cents), fee: formatCents(item.cents) })
        : filled.number
          ? t("reports-invoice-read-ok", { number: filled.number })
          : t("reports-invoice-read-nothing");
    setSlot({
      kind: "read",
      tone: sent.read.isInvoice && sent.read.matches !== false && filled.number ? "positive" : "attention",
      sentence: [sentence, sent.read.note].filter(Boolean).join(" "),
    });
  };

  return (
    <SidePanel
      onClose={close}
      closeLabel={t("reports-cancel")}
      icon={<NiDocumentFull size="medium" />}
      busy={busy || reading}
      title={t("reports-invoice-record")}
      description={t("reports-invoice-body", { value: formatCents(item.cents) })}
      onSubmit={() => {
        setBusy(true);
        void onSave(number, issuedOn, fileId)
          .then((saved) => {
            if (saved) setFileId(null);
          })
          .finally(() => setBusy(false));
      }}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy || reading || number.trim() === ""}>
            {t("reports-save")}
          </Button>
          <Button variant="text" color="grey" onClick={close} disabled={busy}>
            {t("reports-cancel")}
          </Button>
        </>
      }
    >
      <Box className="flex flex-col gap-4">
        <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
          <DocumentSlot
            id="finance-invoice-doc"
            icon={<NiDocumentFull size="medium" className={TILE_TONE.primary.text} />}
            title={t("reports-invoice-slot")}
            hint={t("reports-invoice-slot-hint")}
            state={slot}
            fileName={fileName}
            primary={!fileId && number.trim() === ""}
            disabled={busy}
            labels={{
              send: t("prefill-send"),
              again: t("prefill-again"),
              sending: t("prefill-sending"),
              reading: t("prefill-reading"),
              read: t("prefill-read"),
              failed: t("prefill-failed"),
            }}
            onFile={(file) => void sendInvoice(file)}
          />
        </Box>
        <TextField
          label={t("reports-invoice-number")}
          value={number}
          onChange={(event) => setNumber(event.target.value.slice(0, 40))}
          helperText={read.number !== undefined && read.number === number ? t("reports-invoice-field-read") : undefined}
        />
        <TextField
          type="date"
          label={t("reports-invoice-day")}
          value={issuedOn}
          onChange={(event) => setIssuedOn(event.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
          helperText={read.day !== undefined && read.day === issuedOn ? t("reports-invoice-field-read") : undefined}
        />
        <StateLine tone="info">{t("reports-invoice-note")}</StateLine>
      </Box>
    </SidePanel>
  );
}

const centsText = (cents: number) => (cents > 0 ? (cents / 100).toFixed(2).replace(".", ",") : "");

/**
 * The budget of a month (0163): what each category of income and expense should come to, for this month and as many
 * after it as chosen. A category left blank has no budget; saving replaces those months' budget.
 */
function BudgetPanel({
  month,
  categories,
  current,
  factor,
  onClose,
  onSave,
}: {
  month: string;
  categories: BudgetCategory[];
  current: Report["budget"]["rows"];
  factor: "ok" | "challenge" | "missing";
  onClose: () => void;
  onSave: (rows: { categoryId: string; cents: number }[], months: number) => Promise<string | null>;
}) {
  const t = useTranslations("product");
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(current.map((row) => [row.categoryId, centsText(row.planned)])),
  );
  const [months, setMonths] = useState("1");
  const [confirmed, setConfirmed] = useState(factor === "ok");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const groups = [
    { key: "reports-budget-income", items: categories.filter((category) => category.kind === "income") },
    { key: "reports-budget-expense", items: categories.filter((category) => category.kind !== "income") },
  ];

  const save = async () => {
    setBusy(true);
    setProblem(null);
    const rows = Object.entries(values).flatMap(([categoryId, text]) => {
      const cents = parseCents(text || "0") ?? 0;
      return cents > 0 ? [{ categoryId, cents }] : [];
    });
    try {
      setProblem(await onSave(rows, Number(months) || 1));
    } catch {
      setProblem(t("reports-error-failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel
      onClose={onClose}
      closeLabel={t("reports-cancel")}
      icon={<NiChartBar size="medium" />}
      busy={busy}
      title={t("reports-budget-panel-title", { month: month.split("-").reverse().join("/") })}
      description={t("reports-budget-panel-body")}
      onSubmit={() => void save()}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy || !confirmed}>
            {t("reports-save")}
          </Button>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("reports-cancel")}
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
          label={t("reports-budget-months")}
          value={months}
          onChange={(event) => setMonths(event.target.value)}
        >
          {["1", "3", "6", "12"].map((count) => (
            <MenuItem key={count} value={count}>
              {t("reports-budget-months-option", { count: Number(count) })}
            </MenuItem>
          ))}
        </TextField>
        {groups.map((group) =>
          group.items.length > 0 ? (
            <Box key={group.key} className="flex flex-col gap-3">
              <Typography variant="subtitle2" component="h3">
                {t(group.key)}
              </Typography>
              {group.items.map((category) => (
                <CurrencyField
                  key={category.id}
                  label={category.name}
                  currencySymbol="R$"
                  value={values[category.id] ?? ""}
                  onChange={(event) => setValues((current) => ({ ...current, [category.id]: event.target.value }))}
                />
              ))}
            </Box>
          ) : null,
        )}
      </Box>
    </SidePanel>
  );
}
