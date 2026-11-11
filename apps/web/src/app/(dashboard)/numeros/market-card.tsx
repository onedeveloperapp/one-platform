"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  MenuItem,
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
import IllustrationAnalytics from "@/icons/illustrations/illustration-analytics";
import NiChartBar from "@/icons/nexture/ni-chart-bar";
import { type MarketProjection, readMarketProjection } from "@/lib/jurimetrics/actions";
import { brl, MARKET_PROBLEM_KEY } from "@/lib/jurimetrics/profile";

const PROBLEMS = ["delay", "cancellation", "overbooking", "baggage"] as const;

/**
 * How the market decides, by unit (migration 0190, item 5.5): for a court, an airline and a kind of problem, each
 * unit's decisions read, its success rate and its median moral damages, each with its sample, beside the firm's own
 * numbers above. Read when asked; public decisions, only to project.
 */
export default function MarketCard({ courts }: { courts: string[] }) {
  const t = useTranslations("product");
  const choices = courts.length > 0 ? courts : ["TJGO"];
  const [court, setCourt] = useState(choices[0]);
  const [problem, setProblem] = useState<string>("");
  const [read, setRead] = useState<MarketProjection | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    setBusy(true);
    try {
      setRead(await readMarketProjection({ court, airline: null, problem: problem || null }));
    } catch {
      setRead({ ok: false, code: "failed" });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card component="section" aria-labelledby="numbers-market">
      <CardContent className="flex flex-col gap-3">
        <CardTitle
          id="numbers-market"
          icon={<NiChartBar size="medium" />}
          title={t("numbers-market-title")}
          description={t("numbers-market-description")}
        />
        <Box className="flex flex-wrap items-end gap-3">
          <TextField
            select
            size="small"
            id="market-court"
            label={t("numbers-market-court")}
            value={court}
            onChange={(event) => setCourt(event.target.value)}
            className="min-w-32"
          >
            {choices.map((item) => (
              <MenuItem key={item} value={item}>
                {item}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            id="market-problem"
            label={t("numbers-market-problem")}
            value={problem}
            onChange={(event) => setProblem(event.target.value)}
            className="min-w-48"
          >
            <MenuItem value="">{t("numbers-market-every-problem")}</MenuItem>
            {PROBLEMS.map((item) => (
              <MenuItem key={item} value={item}>
                {t(MARKET_PROBLEM_KEY[item])}
              </MenuItem>
            ))}
          </TextField>
          <Button variant="contained" size="small" disabled={busy} onClick={() => void load()}>
            {busy ? t("cases-working") : t("numbers-market-read")}
          </Button>
        </Box>
        {read && !read.ok ? (
          <Alert severity="error" className="neutral bg-background-paper/60!">
            {t("market-error")}
          </Alert>
        ) : null}
        {read && read.ok && read.rows.length === 0 ? (
          <EmptyState
            titleAs="h3"
            layout="row"
            framed={false}
            illustration={<IllustrationAnalytics />}
            title={t("numbers-market-empty-title")}
            description={t("numbers-market-empty-body")}
          />
        ) : null}
        {read && read.ok && read.rows.length > 0 ? (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>{t("numbers-market-col-unit")}</TableCell>
                  <TableCell align="right">{t("numbers-market-col-decisions")}</TableCell>
                  <TableCell align="right">{t("numbers-market-col-success")}</TableCell>
                  <TableCell align="right">{t("numbers-market-col-moral")}</TableCell>
                  <TableCell align="right">{t("numbers-market-col-prior")}</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {read.rows.map((row) => {
                  const moral = row.numbers.moral.find((item) => item.medianCents !== null);
                  return (
                    <TableRow key={row.unit}>
                      <TableCell>{row.unit}</TableCell>
                      <TableCell align="right">{row.numbers.decisions}</TableCell>
                      <TableCell align="right">
                        {row.numbers.successPercent === null
                          ? t("numbers-market-few", { count: row.numbers.merits })
                          : `${row.numbers.successPercent}%`}
                      </TableCell>
                      <TableCell align="right">{moral?.medianCents ? brl(moral.medianCents) : "·"}</TableCell>
                      <TableCell align="right">
                        {row.numbers.priorComplaintPercent === null ? "·" : `${row.numbers.priorComplaintPercent}%`}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        ) : null}
        <Typography variant="caption" className="text-text-secondary">
          {t("market-note")}
        </Typography>
      </CardContent>
    </Card>
  );
}
