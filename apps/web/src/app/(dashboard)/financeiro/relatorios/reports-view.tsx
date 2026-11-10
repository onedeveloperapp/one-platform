"use client";

import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
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

import CardTitle from "@/components/product/card-title";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import PageHeader from "@/components/product/page-header";
import SecondFactorPrompt from "@/components/product/second-factor-prompt";
import SidePanel from "@/components/product/side-panel";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import NiChartBar from "@/icons/nexture/ni-chart-bar";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiMoney from "@/icons/nexture/ni-money";
import { writeWorkbook, XLSX_TYPE } from "@/lib/export/xlsx-write";
import { savedFileName, saveFile } from "@/lib/files/save-file";
import {
  DRE_ORDER,
  type DreLine,
  flowTotal,
  type Forecast,
  type InvoiceData,
  lineTotal,
  type Report,
  result,
} from "@/lib/finance/reports";
import {
  closeFinanceMonth,
  readFinanceReports,
  recordFinanceInvoice,
  reopenFinanceMonth,
} from "@/lib/finance/reports-actions";
import { formatCents } from "@flyee/rules/finance";
import { formatDayBr } from "@flyee/rules/person";

const LINE_KEY: Record<DreLine, string> = {
  receita: "reports-line-revenue",
  deducao: "reports-line-deductions",
  custo: "reports-line-costs",
  despesa: "reports-line-expenses",
  financeiro: "reports-line-financial",
};
const FLOW_KEY: Record<string, string> = {
  operacional: "reports-flow-operating",
  investimento: "reports-flow-investing",
  financiamento: "reports-flow-financing",
  clientes: "reports-flow-clients",
};
const ERROR_KEY: Record<string, string> = {
  not_allowed: "reports-error-not-allowed",
  second_factor: "reports-error-second-factor",
  not_green: "reports-error-not-green",
  month_open: "reports-error-month-open",
  invalid_data: "reports-error-invalid",
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
export default function ReportsView() {
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

  const ready = state.kind === "ready" ? state : null;
  const report = ready?.report ?? null;

  const download = () => {
    if (!ready || !report) return;
    const dreRows = DRE_ORDER.map((line) => [t(LINE_KEY[line]), lineTotal(report.current, line) / 100]);
    const bytes = writeWorkbook([
      {
        sheet: t("reports-dre-title"),
        columns: [{ title: t("reports-col-line") }, { title: t("reports-col-month"), kind: "number" }],
        rows: [
          ...dreRows,
          [t("reports-line-losses"), -report.current.losses / 100],
          [t("reports-line-result"), result(report.current) / 100],
          [t("reports-line-distribution"), -report.current.distribution / 100],
        ],
      },
      {
        sheet: t("reports-dfc-title"),
        columns: [{ title: t("reports-col-line") }, { title: t("reports-col-month"), kind: "number" }],
        rows: report.current.dfc.map((row) => [t(FLOW_KEY[row.line] ?? "reports-flow-operating"), row.cents / 100]),
      },
      {
        sheet: t("reports-invoices-title"),
        columns: [
          { title: t("reports-col-taker") },
          { title: t("reports-col-value"), kind: "number" },
          { title: t("reports-col-competence"), kind: "date" },
          { title: t("reports-col-invoice") },
        ],
        rows: (ready.invoices ?? []).map((item) => [
          item.caseSeq !== null ? `#${item.caseSeq}` : t("reports-no-case"),
          item.cents / 100,
          item.competence,
          item.invoice?.number ?? "",
        ]),
      },
    ]);
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
              <Button variant="outlined" color="grey" onClick={download}>
                {t("reports-package-download")}
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

          {ready.forecast ? (
            <Card component="section" aria-labelledby="reports-forecast">
              <CardContent className="flex flex-col gap-3">
                <CardTitle
                  id="reports-forecast"
                  icon={<NiChartBar size="medium" />}
                  title={t("reports-forecast-title")}
                  description={t("reports-forecast-description")}
                />
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
                        <StateLine tone="done">
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
      {invoicing ? (
        <InvoicePanel
          item={invoicing}
          onClose={() => setInvoicing(null)}
          onSave={async (number, issuedOn) => {
            const answer = await act(() => recordFinanceInvoice(invoicing.entryId, number, issuedOn));
            if (answer.ok) setInvoicing(null);
          }}
        />
      ) : null}
    </Box>
  );
}

function InvoicePanel({
  item,
  onClose,
  onSave,
}: {
  item: InvoiceData;
  onClose: () => void;
  onSave: (number: string, issuedOn: string) => Promise<void>;
}) {
  const t = useTranslations("product");
  const [number, setNumber] = useState("");
  const [issuedOn, setIssuedOn] = useState(item.competence);
  const [busy, setBusy] = useState(false);
  return (
    <SidePanel
      onClose={onClose}
      closeLabel={t("reports-cancel")}
      icon={<NiDocumentFull size="medium" />}
      busy={busy}
      title={t("reports-invoice-record")}
      description={t("reports-invoice-body", { value: formatCents(item.cents) })}
      onSubmit={() => {
        setBusy(true);
        void onSave(number, issuedOn).finally(() => setBusy(false));
      }}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy || number.trim() === ""}>
            {t("reports-save")}
          </Button>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("reports-cancel")}
          </Button>
        </>
      }
    >
      <Box className="flex flex-col gap-4">
        <TextField
          label={t("reports-invoice-number")}
          value={number}
          onChange={(event) => setNumber(event.target.value.slice(0, 40))}
        />
        <TextField
          type="date"
          label={t("reports-invoice-day")}
          value={issuedOn}
          onChange={(event) => setIssuedOn(event.target.value)}
          slotProps={{ inputLabel: { shrink: true } }}
        />
        <StateLine tone="info">{t("reports-invoice-note")}</StateLine>
      </Box>
    </SidePanel>
  );
}
