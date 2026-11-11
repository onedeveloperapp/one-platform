"use client";

import MarketCard from "./market-card";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  FormControlLabel,
  Grid,
  MenuItem,
  Switch,
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
import EmptyState from "@/components/product/empty-state";
import InfoHint from "@/components/product/info-hint";
import NumberCard from "@/components/product/number-card";
import PageHeader from "@/components/product/page-header";
import IllustrationAnalytics from "@/icons/illustrations/illustration-analytics";
import NiChartBar from "@/icons/nexture/ni-chart-bar";
import NiCheckSquare from "@/icons/nexture/ni-check-square";
import NiClock from "@/icons/nexture/ni-clock";
import NiFolder from "@/icons/nexture/ni-folder";
import NiMoney from "@/icons/nexture/ni-money";
import { caseLabel } from "@/lib/cases/cases";
import { CLAIM_KEY } from "@/lib/cases/outcomes";
import { writeXlsx, XLSX_TYPE } from "@/lib/export/xlsx-write";
import { savedFileName, saveFile } from "@/lib/files/save-file";
import { caseKindLabelKey } from "@/lib/modules/registry";
import {
  claimStats,
  cohorts,
  type Dimension,
  DIMENSIONS,
  groupStats,
  type LawsuitRow,
  type Margin,
  MIN_SAMPLE,
  type Stats,
  statsOf,
  winsProjection,
  withinPeriod,
} from "@/lib/numbers/lawsuits";
import { formatCents } from "@flyee/rules/finance";

export type NumbersState =
  | { kind: "ready"; rows: LawsuitRow[]; margins: Margin[] | null; tests: boolean }
  | { kind: "not-allowed" }
  | { kind: "unavailable" }
  | { kind: "error" };

const DIMENSION_KEY: Record<Dimension, string> = {
  airline: "numbers-dimension-airline",
  incident: "numbers-dimension-incident",
  court: "numbers-dimension-court",
  comarca: "numbers-dimension-comarca",
  unit: "numbers-dimension-unit",
  kind: "numbers-dimension-kind",
  lawyer: "numbers-dimension-lawyer",
};
const KIND_WORDS: Record<string, string> = { juizado: "numbers-kind-juizado", comum: "numbers-kind-comum" };
const RESULT_KEY: Record<string, string> = {
  procedente: "people-outcome-won",
  parcial: "people-outcome-partial",
  improcedente: "people-outcome-lost",
};
const percent = (rate: number | null) => (rate === null ? null : `${Math.round(rate * 100)}%`);

/**
 * The firm's numbers (phase 11): where it wins and how much, from the one set of its lawsuits, grouped as the person
 * asks, each number with its sample and the lawsuits behind it, never an average of fewer than five; what ONE read and
 * nobody checked is counted, and may be left out; the cohorts by the month of the filing; each case's money for who
 * reads the books. Only to read: nothing of it leaves ONE but the spreadsheet a person downloads.
 */
export default function NumbersView({ state }: { state: NumbersState }) {
  const t = useTranslations("product");
  const [dimension, setDimension] = useState<Dimension>("airline");
  const [checkedOnly, setCheckedOnly] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const rows = useMemo(
    () => (state.kind === "ready" ? withinPeriod(state.rows, from ? `${from}-01` : null, to ? `${to}-31` : null) : []),
    [state, from, to],
  );
  const all = useMemo(() => statsOf("", rows, checkedOnly), [rows, checkedOnly]);
  const groups = useMemo(() => groupStats(rows, dimension, checkedOnly), [rows, dimension, checkedOnly]);
  const months = useMemo(() => cohorts(rows, checkedOnly), [rows, checkedOnly]);
  // What the judgments decided of each claim (0193): how often each was granted, and for how much.
  const claims = useMemo(() => claimStats(rows, checkedOnly), [rows, checkedOnly]);
  // The judgments and wins of the months ahead, from the firm's own history, over every lawsuit (never the period's).
  const projection = useMemo(
    () =>
      winsProjection(
        state.kind === "ready" ? state.rows : [],
        checkedOnly,
        new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date()),
      ),
    [state, checkedOnly],
  );

  const keyWords = (key: string) =>
    key === ""
      ? t("numbers-not-recorded")
      : dimension === "incident"
        ? t(caseKindLabelKey(key) ?? "case-incident-other")
        : dimension === "kind"
          ? t(KIND_WORDS[key] ?? "numbers-kind-comum")
          : key;
  const sample = (value: string | null, n: number) =>
    value === null ? t("numbers-small-sample", { n, min: MIN_SAMPLE }) : value;

  const download = () => {
    const bytes = writeXlsx({
      sheet: t("numbers-title"),
      columns: [
        { title: t("numbers-col-case") },
        { title: t("numbers-col-cnj") },
        { title: t("numbers-dimension-airline") },
        { title: t("numbers-dimension-court") },
        { title: t("numbers-dimension-comarca") },
        { title: t("numbers-dimension-unit") },
        { title: t("numbers-col-filed"), kind: "date" },
        { title: t("numbers-col-result") },
        { title: t("numbers-col-judged"), kind: "date" },
        { title: t("numbers-col-checked") },
        { title: t("numbers-col-paid"), kind: "date" },
      ],
      rows: rows.map((row) => [
        row.caseSeq !== null ? caseLabel(row.caseSeq) : "",
        row.cnj,
        row.airline ?? "",
        row.court,
        row.comarca ?? "",
        row.unit ?? "",
        row.filedOn,
        row.result ? t(RESULT_KEY[row.result]!) : row.settled ? t("people-outcome-settlement") : "",
        row.judgedOn ?? "",
        row.result ? t(row.judgedChecked ? "numbers-checked-yes" : "numbers-checked-no") : "",
        row.paidOn ?? "",
      ]),
    });
    saveFile(bytes, savedFileName(t("numbers-title"), "xlsx", t("numbers-title")), XLSX_TYPE);
  };

  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title={t("numbers-title")}
        crumbs={[{ label: t("approvals-home"), href: "/inicio" }, { label: t("numbers-title") }]}
        description={t("numbers-description")}
        action={
          state.kind === "ready" && rows.length > 0 ? (
            <Button variant="outlined" color="grey" onClick={download}>
              {t("numbers-download")}
            </Button>
          ) : undefined
        }
      />
      {state.kind === "not-allowed" ? (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("numbers-not-allowed")}
        </Alert>
      ) : null}
      {state.kind === "error" || state.kind === "unavailable" ? (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {t("numbers-load-error")}
        </Alert>
      ) : null}
      {state.kind === "ready" ? (
        state.rows.length === 0 ? (
          <EmptyState
            illustration={<IllustrationAnalytics />}
            title={t("numbers-empty-title")}
            description={t("numbers-empty-body")}
          />
        ) : (
          <>
            <Box className="flex flex-wrap items-center gap-3">
              <TextField
                select
                size="small"
                label={t("numbers-dimension")}
                value={dimension}
                onChange={(event) => setDimension(event.target.value as Dimension)}
                className="w-56"
              >
                {DIMENSIONS.map((key) => (
                  <MenuItem key={key} value={key}>
                    {t(DIMENSION_KEY[key])}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                size="small"
                type="month"
                label={t("numbers-from")}
                value={from}
                onChange={(event) => setFrom(event.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <TextField
                size="small"
                type="month"
                label={t("numbers-to")}
                value={to}
                onChange={(event) => setTo(event.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
              />
              <FormControlLabel
                control={<Switch checked={checkedOnly} onChange={(event) => setCheckedOnly(event.target.checked)} />}
                label={t("numbers-checked-only")}
              />
              <Button
                size="small"
                variant="text"
                href={state.tests ? "/numeros" : "/numeros?testes=1"}
                LinkComponent={Link}
              >
                {t(state.tests ? "numbers-tests-out" : "numbers-tests-in")}
              </Button>
            </Box>

            <Grid container spacing={2.5}>
              <Grid size={{ xs: 6, lg: 3 }}>
                <NumberCard
                  icon={<NiFolder size="medium" />}
                  tone="primary"
                  label={t("numbers-filed")}
                  value={String(all.lawsuits)}
                />
              </Grid>
              <Grid size={{ xs: 6, lg: 3 }}>
                <NumberCard
                  icon={<NiCheckSquare size="medium" />}
                  tone="secondary"
                  label={t("numbers-success")}
                  value={percent(all.successRate) ?? ""}
                  hint={t("numbers-sample", { n: all.judged })}
                />
              </Grid>
              <Grid size={{ xs: 6, lg: 3 }}>
                <NumberCard
                  icon={<NiClock size="medium" />}
                  tone="accent-4"
                  label={t("numbers-to-judgment")}
                  value={all.daysToJudgment === null ? "" : t("numbers-days", { count: all.daysToJudgment })}
                  hint={all.judgmentRange ? t("numbers-margin", all.judgmentRange) : undefined}
                />
              </Grid>
              <Grid size={{ xs: 6, lg: 3 }}>
                <NumberCard
                  icon={<NiMoney size="medium" />}
                  tone="accent-3"
                  label={t("numbers-to-money")}
                  value={all.daysToMoney === null ? "" : t("numbers-days", { count: all.daysToMoney })}
                />
              </Grid>
            </Grid>
            {all.unchecked > 0 ? (
              <Typography variant="body2" className="text-text-secondary">
                {t("numbers-unchecked", { count: all.unchecked })}
              </Typography>
            ) : null}

            <Card component="section" aria-labelledby="numbers-groups">
              <CardContent className="flex flex-col gap-3">
                <CardTitle
                  id="numbers-groups"
                  icon={<NiChartBar size="medium" />}
                  title={t("numbers-groups-title", { dimension: t(DIMENSION_KEY[dimension]) })}
                />
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>{t(DIMENSION_KEY[dimension])}</TableCell>
                        <TableCell align="right">{t("numbers-col-lawsuits")}</TableCell>
                        <TableCell align="right">{t("numbers-success")}</TableCell>
                        <TableCell align="right">{t("numbers-col-value")}</TableCell>
                        <TableCell align="right">{t("numbers-to-judgment")}</TableCell>
                        <TableCell align="right">{t("numbers-col-own-time")}</TableCell>
                        <TableCell align="right">
                          <Box component="span" className="inline-flex items-center gap-1">
                            {t("numbers-col-settlement")}
                            <InfoHint label={t("numbers-col-settlement-hint")} />
                          </Box>
                        </TableCell>
                        <TableCell align="right">
                          <Box component="span" className="inline-flex items-center gap-1">
                            {t("numbers-col-alike")}
                            <InfoHint label={t("numbers-col-alike-hint")} />
                          </Box>
                        </TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {groups.map((group: Stats) => (
                        <GroupRow
                          key={group.key}
                          group={group}
                          label={keyWords(group.key)}
                          rows={rows}
                          open={open === group.key}
                          onToggle={() => setOpen(open === group.key ? null : group.key)}
                          sample={sample}
                        />
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                <Typography variant="caption" className="text-text-secondary">
                  {t("numbers-own-time-note")}
                </Typography>
              </CardContent>
            </Card>

            <Card component="section" aria-labelledby="numbers-claims">
              <CardContent className="flex flex-col gap-3">
                <CardTitle
                  id="numbers-claims"
                  icon={<NiChartBar size="medium" />}
                  title={t("numbers-claims-title")}
                  description={t("numbers-claims-description")}
                />
                {claims.length === 0 ? (
                  <Typography variant="body2" className="text-text-secondary">
                    {t("numbers-claims-empty")}
                  </Typography>
                ) : (
                  <TableContainer>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell>{t("numbers-col-claim")}</TableCell>
                          <TableCell align="right">{t("numbers-col-decided")}</TableCell>
                          <TableCell align="right">{t("numbers-col-granted")}</TableCell>
                          <TableCell align="right">{t("numbers-col-grant-rate")}</TableCell>
                          <TableCell align="right">{t("numbers-col-claim-value")}</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        {claims.map((claim) => (
                          <TableRow key={claim.claim}>
                            <TableCell>{t(CLAIM_KEY[claim.claim])}</TableCell>
                            <TableCell align="right">{claim.decided}</TableCell>
                            <TableCell align="right">{claim.granted}</TableCell>
                            <TableCell align="right">{sample(percent(claim.grantRate), claim.decided)}</TableCell>
                            <TableCell align="right">
                              {sample(
                                claim.valuePerClaimant === null ? null : formatCents(claim.valuePerClaimant),
                                claim.granted,
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </TableContainer>
                )}
              </CardContent>
            </Card>

            <Card component="section" aria-labelledby="numbers-cohorts">
              <CardContent className="flex flex-col gap-3">
                <CardTitle id="numbers-cohorts" icon={<NiFolder size="medium" />} title={t("numbers-cohorts-title")} />
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        {[
                          "numbers-col-month",
                          "numbers-col-filed-n",
                          "numbers-col-judged-n",
                          "numbers-col-final",
                          "numbers-col-executing",
                          "numbers-col-paid-n",
                          "numbers-col-closed",
                          "numbers-col-success",
                          "numbers-col-lost",
                        ].map((key) => (
                          <TableCell key={key} align={key === "numbers-col-month" ? "left" : "right"}>
                            {t(key)}
                          </TableCell>
                        ))}
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {months.map((cohort) => (
                        <TableRow key={cohort.month}>
                          <TableCell>{`${cohort.month.slice(5, 7)}/${cohort.month.slice(0, 4)}`}</TableCell>
                          {[
                            cohort.filed,
                            cohort.judged,
                            cohort.final,
                            cohort.executing,
                            cohort.paid,
                            cohort.closed,
                            cohort.success,
                            cohort.lost,
                          ].map((value, index) => (
                            <TableCell key={index} align="right">
                              {value}
                            </TableCell>
                          ))}
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
              </CardContent>
            </Card>

            <Card component="section" aria-labelledby="numbers-projection">
              <CardContent className="flex flex-col gap-3">
                <CardTitle
                  id="numbers-projection"
                  icon={<NiFolder size="medium" />}
                  title={t("numbers-projection-title")}
                  description={t("numbers-projection-description")}
                />
                <TableContainer>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>{t("numbers-col-month")}</TableCell>
                        <TableCell align="right">{t("numbers-col-judgments-expected")}</TableCell>
                        <TableCell align="right">{t("numbers-col-wins-expected")}</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {projection.months.map((month) => (
                        <TableRow key={month.month}>
                          <TableCell>{`${month.month.slice(5, 7)}/${month.month.slice(0, 4)}`}</TableCell>
                          <TableCell align="right">{month.judgments}</TableCell>
                          <TableCell align="right">{String(month.wins).replace(".", ",")}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </TableContainer>
                {projection.unprojected > 0 ? (
                  <Typography variant="caption" className="text-text-secondary">
                    {t("numbers-projection-unprojected", { count: projection.unprojected, min: MIN_SAMPLE })}
                  </Typography>
                ) : null}
              </CardContent>
            </Card>

            {/* How the market decides by unit, beside the firm's own numbers above (0190, item 5.5). */}
            <MarketCard courts={[...new Set(state.rows.map((row) => row.court).filter(Boolean))].sort()} />

            {state.margins ? (
              <Card component="section" aria-labelledby="numbers-margins">
                <CardContent className="flex flex-col gap-3">
                  <CardTitle
                    id="numbers-margins"
                    icon={<NiMoney size="medium" />}
                    title={t("numbers-margins-title")}
                    description={t("numbers-margins-description")}
                  />
                  {state.margins.length === 0 ? (
                    <Typography variant="body2" className="text-text-secondary">
                      {t("numbers-margins-none")}
                    </Typography>
                  ) : (
                    <Box component="ul" className="m-0 flex list-none flex-col p-0">
                      {state.margins.slice(0, 50).map((margin) => (
                        <Box
                          component="li"
                          key={margin.caseId}
                          className="border-grey-100 flex flex-wrap items-center gap-3 border-b py-2 last:border-b-0"
                        >
                          <Link href={`/casos/${margin.caseId}`} className="min-w-0 flex-1 font-semibold">
                            {margin.caseSeq !== null ? caseLabel(margin.caseSeq) : ""}
                          </Link>
                          <Typography variant="body2" className="text-text-secondary">
                            {t("numbers-margin-line", {
                              fees: formatCents(margin.feesCents),
                              costs: formatCents(margin.costsCents),
                              margin: formatCents(margin.marginCents),
                            })}
                          </Typography>
                        </Box>
                      ))}
                    </Box>
                  )}
                </CardContent>
              </Card>
            ) : null}
          </>
        )
      ) : null}
    </Box>
  );
}

function GroupRow({
  group,
  label,
  rows,
  open,
  onToggle,
  sample,
}: {
  group: Stats;
  label: string;
  rows: LawsuitRow[];
  open: boolean;
  onToggle: () => void;
  sample: (value: string | null, n: number) => string;
}) {
  const t = useTranslations("product");
  const ids = new Set(group.ids);
  return (
    <>
      <TableRow hover onClick={onToggle} className="cursor-pointer" aria-expanded={open}>
        <TableCell>
          <Button size="small" variant="text" color="grey" className="px-0" onClick={onToggle}>
            {label}
          </Button>
        </TableCell>
        <TableCell align="right">{group.lawsuits}</TableCell>
        <TableCell align="right">{sample(percent(group.successRate), group.judged)}</TableCell>
        <TableCell align="right">
          {sample(
            group.valuePerClaimant === null ? null : formatCents(group.valuePerClaimant),
            group.won + group.partial,
          )}
        </TableCell>
        <TableCell align="right">
          {sample(
            group.daysToJudgment === null
              ? null
              : group.judgmentRange
                ? t("numbers-days-margin", { count: group.daysToJudgment, ...group.judgmentRange })
                : t("numbers-days", { count: group.daysToJudgment }),
            group.judged,
          )}
        </TableCell>
        <TableCell align="right">
          {sample(
            group.daysToFiling === null ? null : t("numbers-days", { count: group.daysToFiling }),
            group.lawsuits,
          )}
        </TableCell>
        <TableCell align="right">
          {sample(
            group.settlementRange
              ? t("numbers-money-range", {
                  median: formatCents(group.settlementRange.median),
                  low: formatCents(group.settlementRange.low),
                  high: formatCents(group.settlementRange.high),
                })
              : null,
            group.settlements,
          )}
        </TableCell>
        <TableCell align="right">
          {sample(group.alike === null ? null : `${Math.round(group.alike)}%`, group.alikeSample)}
        </TableCell>
      </TableRow>
      {open ? (
        <TableRow>
          <TableCell colSpan={8}>
            <Box className="flex flex-col gap-1">
              {rows
                .filter((row) => ids.has(row.id))
                .map((row) => (
                  <Link key={row.id} href={`/casos/${row.caseId}`} className="text-sm">
                    {[
                      row.caseSeq !== null ? caseLabel(row.caseSeq) : null,
                      row.cnj,
                      row.result
                        ? t(RESULT_KEY[row.result]!)
                        : row.settled
                          ? t("people-outcome-settlement")
                          : t("numbers-no-judgment"),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Link>
                ))}
            </Box>
          </TableCell>
        </TableRow>
      ) : null}
    </>
  );
}
