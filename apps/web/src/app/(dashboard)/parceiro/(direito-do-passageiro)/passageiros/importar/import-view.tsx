"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Grid,
  LinearProgress,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import MetricBars from "@/components/product/metric-bars";
import PageHeader from "@/components/product/page-header";
import NiLuggage from "@/icons/nexture/ni-luggage";
import { inPieces, MOST_FILE_BYTES } from "@/lib/import/limits";
import { readSpreadsheet } from "@/lib/import/read";
import { columnLetters, type ParsedTable } from "@/lib/import/table";
import { TABLE_PROBLEM_KEY } from "@/lib/import/words";
import { importPassengers } from "@/modules/direito-do-passageiro/agency/actions";
import {
  guessPaxMapping,
  IMPORT_FIELD_KEY,
  IMPORT_PROBLEM_KEY,
  missingPaxRequired,
  PAX_IMPORT_FIELDS,
  type PaxColumnMapping,
  paxHeaderScore,
  planPaxImport,
} from "@/modules/direito-do-passageiro/agency/import";
import { localTimeLabel, paxErrorKey } from "@/modules/direito-do-passageiro/agency/passengers";

/** How many lines one call takes: the database's `import_rows_per_call`. */
const LINES_PER_CALL = 200;
/** How many problems the screen lists before it counts the rest. */
const SHOWN = 30;

type Outcome = {
  added: number;
  matched: number;
  tripsAdded: number;
  legsAdded: number;
  problems: { line: number | null; code: string }[];
  /** Lines never sent because a call failed: they may be sent again. */
  unsent: number;
};

/**
 * Brings the agency's passengers from a spreadsheet of its own system. Who comes here has a booking export and
 * wants every passenger and trip in ONE without typing them: the file is read in the browser, each column is
 * confirmed, what cannot be read is said by its line before anything is sent, and what the database refused is
 * said by its line after.
 */
export default function ImportView({ firm }: { firm: string | null }) {
  const t = useTranslations("product");
  const [table, setTable] = useState<ParsedTable | null>(null);
  const [fileName, setFileName] = useState("");
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [mapping, setMapping] = useState<PaxColumnMapping>({});
  const [sending, setSending] = useState<{ sent: number; total: number } | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  // Leaving while lines are being sent loses track of what went: the browser asks first.
  useEffect(() => {
    if (!sending) return;
    const ask = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [sending]);

  const plan = useMemo(() => (table ? planPaxImport(table, mapping) : null), [table, mapping]);
  const missing = missingPaxRequired(mapping);
  const crumbs = [
    { label: t("partner-home-title"), href: "/parceiro" },
    { label: t("pax-title"), href: "/parceiro/passageiros" },
    { label: t("pax-import-title") },
  ];

  if (firm === null) {
    return (
      <Grid container spacing={5}>
        <Grid size={12}>
          <PageHeader title={t("pax-import-title")} crumbs={crumbs} />
        </Grid>
        <Grid size={12}>
          <EmptyState
            icon={<NiLuggage size="large" />}
            title={t("pax-no-partnership-title")}
            description={t("pax-no-partnership-body")}
            action={{ label: t("pax-no-partnership-action"), href: "/parceiro" }}
          />
        </Grid>
      </Grid>
    );
  }

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setOutcome(null);
    setTable(null);
    setFileName(file.name);
    if (file.size > MOST_FILE_BYTES) {
      setFileProblem(TABLE_PROBLEM_KEY.too_large);
      return;
    }
    setFileProblem(null);
    setReading(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      // The screen says it is reading before a large file holds it for a moment.
      await new Promise((resolve) => setTimeout(resolve, 0));
      const read = readSpreadsheet(bytes, { headerScore: paxHeaderScore });
      if (read.ok) {
        setTable(read.table);
        setMapping(guessPaxMapping(read.table.headers));
      } else {
        setFileProblem(read.code === "pdf" ? "pax-import-file-pdf" : TABLE_PROBLEM_KEY[read.code]);
      }
    } catch {
      setFileProblem(TABLE_PROBLEM_KEY.not_a_workbook);
    } finally {
      setReading(false);
    }
  };

  const send = async () => {
    if (!plan || plan.rows.length === 0) return;
    const pieces = inPieces(plan.rows, LINES_PER_CALL);
    const result: Outcome = { added: 0, matched: 0, tripsAdded: 0, legsAdded: 0, problems: [], unsent: 0 };
    setSending({ sent: 0, total: plan.rows.length });
    let sent = 0;
    for (const piece of pieces) {
      const answer = await importPassengers(piece).catch(() => null);
      if (!answer || !answer.ok) {
        // A call that failed sent nothing of its lines: they are counted, never lost from sight.
        result.unsent += piece.length;
        if (
          answer &&
          !answer.ok &&
          ["not_authorized", "partnership_ended", "second_factor_required"].includes(answer.code)
        ) {
          result.unsent = plan.rows.length - sent;
          result.problems.push({ line: null, code: answer.code });
          break;
        }
      } else {
        result.added += answer.added;
        result.matched += answer.matched;
        result.tripsAdded += answer.tripsAdded;
        result.legsAdded += answer.legsAdded;
        result.problems.push(...answer.problems);
      }
      sent += piece.length;
      setSending({ sent, total: plan.rows.length });
    }
    setSending(null);
    setOutcome(result);
  };

  const columnLabel = (index: number) => {
    const header = table?.headers[index]?.trim();
    return header ? `${columnLetters(index)} · ${header}` : t("pax-import-column", { letter: columnLetters(index) });
  };
  const sample = (index: number | undefined) =>
    index === undefined || !table
      ? ""
      : (table.rows.find((row) => (row[index] ?? "").trim() !== "")?.[index] ?? "").trim().slice(0, 40);

  return (
    <Grid container spacing={5}>
      <Grid size={12}>
        <PageHeader title={t("pax-import-title")} crumbs={crumbs} description={t("pax-import-description", { firm })} />
      </Grid>

      <Grid size={12}>
        <Card component="section" aria-labelledby="pax-import-file">
          <CardContent className="flex flex-col gap-4">
            <Typography id="pax-import-file" variant="h5" component="h2" className="mb-0">
              {t("pax-import-file-title")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {t("pax-import-file-help")}
            </Typography>
            <Box>
              <Button variant="contained" component="label" disabled={reading || sending !== null}>
                {table ? t("pax-import-file-other") : t("pax-import-file-choose")}
                <input
                  type="file"
                  hidden
                  accept=".xlsx,.csv,.txt,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    void choose(file);
                  }}
                />
              </Button>
            </Box>
            {reading && <LinearProgress aria-label={t("pax-import-reading")} />}
            {fileName && !reading && (
              <Typography variant="body2">
                {table
                  ? t("pax-import-file-read", { name: fileName, rows: table.rows.length })
                  : t("pax-import-file-name", { name: fileName })}
              </Typography>
            )}
            {fileProblem && <Alert severity="error">{t(fileProblem)}</Alert>}
          </CardContent>
        </Card>
      </Grid>

      {table && plan && !outcome && (
        <>
          <Grid size={12}>
            <Card component="section" aria-labelledby="pax-import-columns">
              <CardContent className="flex flex-col gap-4">
                <Typography id="pax-import-columns" variant="h5" component="h2" className="mb-0">
                  {t("pax-import-columns-title")}
                </Typography>
                <Typography variant="body2" className="text-text-secondary">
                  {t("pax-import-columns-help")}
                </Typography>
                <Grid container spacing={2}>
                  {PAX_IMPORT_FIELDS.map((field) => (
                    <Grid key={field} size={{ xs: 12, sm: 6, lg: 4 }}>
                      <TextField
                        select
                        fullWidth
                        size="small"
                        id={`pax-import-${field}`}
                        label={t(IMPORT_FIELD_KEY[field])}
                        value={mapping[field] === undefined ? "" : String(mapping[field])}
                        required={field === "name"}
                        disabled={sending !== null}
                        helperText={
                          sample(mapping[field]) ? t("pax-import-example", { value: sample(mapping[field]) }) : " "
                        }
                        onChange={(event) => {
                          const value = event.target.value;
                          setMapping((current) => {
                            const next = { ...current };
                            if (value === "") delete next[field];
                            else next[field] = Number(value);
                            return next;
                          });
                        }}
                      >
                        <MenuItem value="">{t("pax-import-no-column")}</MenuItem>
                        {table.headers.map((_, index) => (
                          <MenuItem key={index} value={String(index)}>
                            {columnLabel(index)}
                          </MenuItem>
                        ))}
                      </TextField>
                    </Grid>
                  ))}
                </Grid>
              </CardContent>
            </Card>
          </Grid>

          <Grid size={12}>
            <Card component="section" aria-labelledby="pax-import-check">
              <CardContent className="flex flex-col gap-4">
                <Typography id="pax-import-check" variant="h5" component="h2" className="mb-0">
                  {t("pax-import-check-title")}
                </Typography>
                {missing.length > 0 ? (
                  <Alert severity="warning" className="neutral bg-background-paper/60!">
                    {t("pax-import-missing-name")}
                  </Alert>
                ) : (
                  <>
                    <MetricBars
                      total={plan.rows.length}
                      items={[
                        { key: "cpf", label: t("pax-import-with-cpf"), value: plan.counts.withCpf },
                        { key: "phone", label: t("pax-import-with-phone"), value: plan.counts.withPhone },
                        { key: "locator", label: t("pax-import-with-locator"), value: plan.counts.withLocator },
                        { key: "flight", label: t("pax-import-with-flight"), value: plan.counts.withFlight },
                      ]}
                    />
                    <Typography variant="body2">{t("pax-import-lines", { count: plan.rows.length })}</Typography>
                    {plan.rows.length > 0 && (
                      <Box
                        component="ul"
                        className="m-0 flex list-none flex-col gap-2 p-0"
                        aria-label={t("pax-import-first")}
                      >
                        {plan.rows.slice(0, 5).map((row) => (
                          <Typography component="li" variant="body2" key={row.line} className="break-words">
                            {[
                              t("pax-import-line", { line: row.line }),
                              row.nome,
                              row.localizador,
                              row.voo && row.partida
                                ? `${row.voo} ${row.origem} ${t("pax-import-to")} ${row.destino} ${localTimeLabel(row.partida)}`
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </Typography>
                        ))}
                      </Box>
                    )}
                    {plan.problems.length > 0 && (
                      <Box className="flex flex-col gap-1">
                        <Typography variant="subtitle2" component="h3">
                          {t("pax-import-problems-title", { count: plan.problems.length })}
                        </Typography>
                        <Box component="ul" className="m-0 flex list-none flex-col gap-1 p-0">
                          {plan.problems.slice(0, SHOWN).map((problem) => (
                            <Typography component="li" variant="body2" key={`${problem.line}-${problem.code}`}>
                              {t("pax-import-problem-at", {
                                line: problem.line,
                                what: t(IMPORT_PROBLEM_KEY[problem.code]),
                              })}
                            </Typography>
                          ))}
                        </Box>
                        {plan.problems.length > SHOWN && (
                          <Typography variant="body2" className="text-text-secondary">
                            {t("pax-import-more", { count: plan.problems.length - SHOWN })}
                          </Typography>
                        )}
                      </Box>
                    )}
                    {sending && (
                      <Box className="flex flex-col gap-1">
                        <LinearProgress
                          variant="determinate"
                          value={(sending.sent / Math.max(sending.total, 1)) * 100}
                          aria-label={t("pax-import-sending", { sent: sending.sent, total: sending.total })}
                        />
                        <Typography variant="body2">
                          {t("pax-import-sending", { sent: sending.sent, total: sending.total })}
                        </Typography>
                      </Box>
                    )}
                    <Box>
                      <Button
                        variant="contained"
                        disabled={sending !== null || plan.rows.length === 0}
                        onClick={() => void send()}
                      >
                        {t("pax-import-send", { count: plan.rows.length })}
                      </Button>
                    </Box>
                  </>
                )}
              </CardContent>
            </Card>
          </Grid>
        </>
      )}

      {outcome && (
        <Grid size={12}>
          <Card component="section" aria-labelledby="pax-import-done">
            <CardContent className="flex flex-col gap-4">
              <Typography id="pax-import-done" variant="h5" component="h2" className="mb-0">
                {t("pax-import-done-title")}
              </Typography>
              <MetricBars
                whole={false}
                items={[
                  { key: "added", label: t("pax-import-added"), value: outcome.added },
                  { key: "matched", label: t("pax-import-matched"), value: outcome.matched },
                  { key: "trips", label: t("pax-import-trips"), value: outcome.tripsAdded },
                  { key: "legs", label: t("pax-import-legs"), value: outcome.legsAdded },
                ]}
              />
              {outcome.unsent > 0 && (
                <Alert severity="warning" className="neutral bg-background-paper/60!">
                  {t("pax-import-unsent", { count: outcome.unsent })}
                </Alert>
              )}
              {outcome.problems.length > 0 && (
                <Box className="flex flex-col gap-1">
                  <Typography variant="subtitle2" component="h3">
                    {t("pax-import-refused-title", { count: outcome.problems.length })}
                  </Typography>
                  <Box component="ul" className="m-0 flex list-none flex-col gap-1 p-0">
                    {outcome.problems.slice(0, SHOWN).map((problem, index) => (
                      <Typography component="li" variant="body2" key={`${problem.line}-${problem.code}-${index}`}>
                        {problem.line === null
                          ? t(paxErrorKey(problem.code))
                          : t("pax-import-problem-at", { line: problem.line, what: t(paxErrorKey(problem.code)) })}
                      </Typography>
                    ))}
                  </Box>
                  {outcome.problems.length > SHOWN && (
                    <Typography variant="body2" className="text-text-secondary">
                      {t("pax-import-more", { count: outcome.problems.length - SHOWN })}
                    </Typography>
                  )}
                </Box>
              )}
              <Box className="flex flex-wrap gap-2">
                <Button variant="contained" href="/parceiro/passageiros" LinkComponent={Link}>
                  {t("pax-import-see")}
                </Button>
                <Button
                  variant="text"
                  color="grey"
                  onClick={() => {
                    setOutcome(null);
                    setTable(null);
                    setFileName("");
                  }}
                >
                  {t("pax-import-another")}
                </Button>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      )}
    </Grid>
  );
}
