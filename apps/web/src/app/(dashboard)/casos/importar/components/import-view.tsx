"use client";

import type { ImportBatchView, ImportState } from "../import-types";
import DjenLawsuitsCard from "./djen-lawsuits-card";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

import { Alert, Box, Button, Card, CardContent, MenuItem, TextField, Typography } from "@mui/material";

import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import EmptyState from "@/components/product/empty-state";
import MetricBars from "@/components/product/metric-bars";
import PageHeader from "@/components/product/page-header";
import SetupWizard, { type WizardStep } from "@/components/product/setup-wizard";
import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import NiFolder from "@/icons/nexture/ni-folder";
import NiUsers from "@/icons/nexture/ni-users";
import {
  addPortfolioRows,
  commitPortfolioImport,
  discardPortfolioImport,
  type ImportCounts,
  knownLawsuits,
  type NotedLine,
  notedLines,
  revertPortfolioImport,
  startPortfolioImport,
} from "@/lib/import/actions";
import { inPieces, MOST_FILE_BYTES, NUMBERS_PER_CALL } from "@/lib/import/limits";
import {
  type ColumnMapping,
  guessColumnMapping,
  missingRequired,
  PORTFOLIO_FIELDS,
  type PortfolioField,
  REQUIRED_FIELDS,
} from "@/lib/import/mapping";
import {
  buildPortfolioPreview,
  cnjOf,
  portfolioHeaderScore,
  type PortfolioPreview,
  type PortfolioRow,
  ROW_ERRORS,
  ROW_WARNINGS,
  withAirlineChoices,
} from "@/lib/import/portfolio";
import { readSpreadsheet } from "@/lib/import/read";
import { columnLetters, headerChoices, type ParsedTable, withHeaderAt } from "@/lib/import/table";
import {
  FIELD_KEY,
  importErrorKey,
  LINE_ERROR_KEY,
  refusedLineKey,
  ROW_PROBLEM_KEY,
  rowFieldKey,
  TABLE_PROBLEM_KEY,
} from "@/lib/import/words";
import { formatCnj } from "@flyee/rules/cnj";

type Ready = Extract<ImportState, { kind: "ready" }>;

/** How many lines to correct the conference lists, how many of the ones that go it shows as they will be. */
const PROBLEMS_SHOWN = 30;
const SAMPLES_SHOWN = 3;
/** How many ways of writing the other party, and of what an old system said of an ended lawsuit, are shown. */
const OPPONENTS_SHOWN = 30;
const ENDED_SHOWN = 8;

const STATUS: Record<ImportBatchView["status"], { tone: StatusTone; key: string }> = {
  staged: { tone: "attention", key: "import-status-staged" },
  committed: { tone: "positive", key: "import-status-committed" },
  reverted: { tone: "neutral", key: "import-status-reverted" },
};

/** The kind of a lawsuit, in the words the case screen says it with. */
const KIND_KEY: Record<PortfolioRow["kind"], string> = {
  juizado: "case-proceeding-kind-juizado",
  comum: "case-proceeding-kind-comum",
};

/** "2026-08-03" as a person reads a day. */
const dayLabel = (day: string): string => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;

/** The value of the select for "no airline": an airline's code is two characters. */
const NO_AIRLINE = "none";

/**
 * A firm brings the lawsuits it already has in court from the spreadsheet of
 * the system it used before. Who is here is a partner, a lawyer or who runs
 * the firm's deadlines, arriving with a portfolio; what they came for is to
 * have it all in ONE in minutes, without typing a lawsuit; it worked when the
 * cases are open and their lawsuits are being read in court by themselves.
 * One decision a step: the file, which column is what, a conference of what
 * each line would do before anything is written (with the other parties as
 * they were read, for the person to correct), and what came of it. The
 * spreadsheet is read in the browser; an import is undone from this screen,
 * and one that stopped half way goes on or is undone from here too.
 */
export default function ImportView({ state }: { state: ImportState }) {
  const t = useTranslations("product");
  const router = useRouter();

  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title={t("import-title")}
        crumbs={[
          { label: t("cases-home"), href: "/inicio" },
          { label: t("cases-title"), href: "/casos" },
          { label: t("import-title") },
        ]}
        description={t("import-description")}
      />
      {state.kind === "unavailable" && (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("settings-unavailable")}
        </Alert>
      )}
      {state.kind === "error" && (
        <Alert
          severity="error"
          className="neutral bg-background-paper/60!"
          action={
            <Button color="inherit" size="small" onClick={() => router.refresh()}>
              {t("cases-retry")}
            </Button>
          }
        >
          {t("import-load-error")}
        </Alert>
      )}
      {state.kind === "support" && (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("import-error-support")}
        </Alert>
      )}
      {state.kind === "no-firm" && (
        <EmptyState
          icon={<NiUsers size="large" />}
          title={t("cases-no-firm-title")}
          description={t("cases-no-firm-body")}
          action={{ label: t("cases-no-firm-action"), href: "/admin" }}
        />
      )}
      {state.kind === "not-allowed" && (
        <EmptyState
          icon={<NiFolder size="large" />}
          title={t("import-not-allowed-title")}
          description={t("import-not-allowed-body")}
          action={{ label: t("import-back-to-cases"), href: "/casos" }}
        />
      )}
      {state.kind === "ready" && <DjenLawsuitsCard />}
      {state.kind === "ready" && <ImportWizard state={state} />}
    </Box>
  );
}

type Problem = { code: string; row?: number; field?: string };
type Result = {
  batchId: string;
  counts: ImportCounts;
  /** The lawsuits of the file the firm already had, which the screen saw and never sent. */
  fileExists: number;
  /** The lines of the file that were not sent: repeated, or not read. */
  notSent: number;
  refused: NotedLine[];
  withoutCpf: NotedLine[];
  withoutCpfCount: number;
};
type Outcome = { ok: true; counts: ImportCounts } | { ok: false; code: string };

/** Decides a batch's lines a few a call, until none is left. A call that decides nothing more ends it as a failure. */
async function commitAll(batchId: string, onProgress: (counts: ImportCounts) => void): Promise<Outcome> {
  let left: number | null = null;
  for (;;) {
    const step = await commitPortfolioImport(batchId);
    if (!step.ok) return { ok: false, code: step.code };
    onProgress(step.counts);
    if (step.done) return { ok: true, counts: step.counts };
    if (left !== null && step.counts.pending >= left) return { ok: false, code: "failed" };
    left = step.counts.pending;
  }
}

/** Undoes a batch a few lines a call, until none is left. */
async function revertAll(batchId: string): Promise<Outcome> {
  let left: number | null = null;
  for (;;) {
    const step = await revertPortfolioImport(batchId);
    if (!step.ok) return { ok: false, code: step.code };
    if (step.done) return { ok: true, counts: step.counts };
    if (left !== null && step.counts.created >= left) return { ok: false, code: "failed" };
    left = step.counts.created;
  }
}

function ImportWizard({ state }: { state: Ready }) {
  const t = useTranslations("product");
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [index, setIndex] = useState(0);
  const [source, setSource] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [reading, setReading] = useState(false);
  const [table, setTable] = useState<ParsedTable | null>(null);
  const [fileProblem, setFileProblem] = useState<string | null>(null);
  const [mapping, setMapping] = useState<ColumnMapping>({});
  /** The lawsuits of the file the firm already has, asked once at the conference. */
  const [existing, setExisting] = useState<ReadonlySet<string> | null>(null);
  /** The airline the person chose for a way of writing the other party (null: none). */
  const [airlineFor, setAirlineFor] = useState<ReadonlyMap<string, string | null>>(new Map());
  /** Every way of writing the other party is shown, not only the most frequent. */
  const [allOpponents, setAllOpponents] = useState(false);
  /**
   * An import stopped half way: what the conference said of the firm's lawsuits no longer holds (some of them
   * are in the firm now), and nothing is brought again until the file is conferred again.
   */
  const [stale, setStale] = useState(false);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [progress, setProgress] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  /** A batch of the history being gone on with, and what it says meanwhile. */
  const [resuming, setResuming] = useState<{ id: string; text: string } | null>(null);
  const [historyProblem, setHistoryProblem] = useState<{ id: string; code: string } | null>(null);
  const [undoing, setUndoing] = useState<string | null>(null);

  const mayWrite = state.secondFactor === "ok";
  const working = progress !== null || resuming !== null;

  // Leaving while the lines are being decided stops the import half way: the browser asks first.
  useEffect(() => {
    if (!working) return;
    const ask = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [working]);

  const choose = async (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    setExisting(null);
    setAirlineFor(new Map());
    setStale(false);
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
      const read = readSpreadsheet(bytes, { headerScore: portfolioHeaderScore });
      if (read.ok) {
        setTable(read.table);
        setMapping(guessColumnMapping(read.table.headers));
      } else {
        setFileProblem(TABLE_PROBLEM_KEY[read.code]);
      }
    } catch {
      setFileProblem(TABLE_PROBLEM_KEY.not_a_workbook);
    } finally {
      setReading(false);
    }
  };

  /** The first value of each column a fact is read from, to show what it holds. */
  const samples = useMemo(() => {
    const found: Partial<Record<PortfolioField, string>> = {};
    if (!table) return found;
    for (const field of PORTFOLIO_FIELDS) {
      const column = mapping[field];
      if (column === undefined) continue;
      const value = (table.rows.find((row) => (row[column] ?? "").trim() !== "")?.[column] ?? "").trim();
      if (value !== "") found[field] = value.slice(0, 60);
    }
    return found;
  }, [table, mapping]);

  // The source only names where the cases came from: typing it never holds the screen while a large file is read.
  const deferredSource = useDeferredValue(source);
  /** What each line would do, read once per file, columns and conference. */
  const basePreview = useMemo<PortfolioPreview | null>(
    () =>
      table && existing
        ? buildPortfolioPreview({
            table,
            mapping,
            existing,
            courts: state.courts,
            airlines: state.airlines,
            source: deferredSource.trim() || null,
            today: state.today,
            oldestDay: state.limits.oldestFiledOn,
          })
        : null,
    [table, mapping, existing, deferredSource, state.courts, state.airlines, state.today, state.limits.oldestFiledOn],
  );
  /** The same, with the airline the person chose for each way of writing the other party: only those lines change. */
  const preview = useMemo(
    () => (basePreview ? withAirlineChoices(basePreview, airlineFor) : null),
    [basePreview, airlineFor],
  );

  const confer = async (): Promise<boolean> => {
    if (!table) return false;
    setProblem(null);
    const column = mapping.cnj;
    const numbers = [
      ...new Set(
        table.rows
          .map((row) => (column === undefined ? null : cnjOf(row[column] ?? "")))
          .filter((cnj): cnj is string => cnj !== null),
      ),
    ];
    try {
      const found = new Set<string>();
      let asked = 0;
      for (const piece of inPieces(numbers, NUMBERS_PER_CALL)) {
        setProgress(t("import-progress-checking", { done: asked, total: numbers.length }));
        const answer = await knownLawsuits(piece);
        if (!answer.ok) {
          setProblem({ code: answer.code });
          return false;
        }
        for (const cnj of answer.known) found.add(cnj);
        asked += piece.length;
      }
      setExisting(found);
      setStale(false);
      return true;
    } catch {
      setProblem({ code: "failed" });
      return false;
    } finally {
      setProgress(null);
    }
  };

  /** The lines that open a case, and the ones this batch takes: as many as one batch holds. */
  const lines = useMemo(
    () => (preview ? preview.rows.flatMap((row): PortfolioRow[] => (row.row ? [row.row] : [])) : []),
    [preview],
  );
  const toBring = useMemo(() => lines.slice(0, state.limits.maxRows), [lines, state.limits.maxRows]);
  const errorLines = useMemo(() => (preview ? preview.rows.filter((row) => row.action === "error") : []), [preview]);
  /** The lines whose client goes without the CPF, which the file gives somebody of another name. */
  const cpfLines = useMemo(
    () => (preview ? preview.rows.filter((row) => row.warnings.includes("cpf_other_name")) : []),
    [preview],
  );
  /** The airlines a line may be brought with: the ones that still fly. */
  const flying = useMemo(() => state.airlines.filter((airline) => airline.active), [state.airlines]);
  const airlineName = useMemo(
    () => new Map(state.airlines.map((airline) => [airline.iata, airline.name])),
    [state.airlines],
  );
  /** What the lines that go carry: how well the columns were read is seen before anything is written. */
  const carry = useMemo(
    () => ({
      cpf: toBring.filter((line) => line.cpf !== null).length,
      airline: toBring.filter((line) => line.airline !== null).length,
      filed: toBring.filter((line) => line.filed_on !== null).length,
      closed: toBring.filter((line) => line.closed).length,
    }),
    [toBring],
  );

  const bring = async (): Promise<boolean> => {
    if (toBring.length === 0 || !preview) return false;
    setProblem(null);
    let batchId: string | null = null;
    // Whether a line was decided: from then on the batch is never given up, only gone on with or undone.
    let started = false;
    const fileCounts = {
      lines: preview.rows.length,
      exists: preview.summary.exists,
      duplicate: preview.summary.duplicate,
      error: preview.summary.error,
      over: lines.length - toBring.length,
    };
    try {
      const opened = await startPortfolioImport({ fileName, source: source.trim() || null, fileCounts });
      if (!opened.ok) {
        setProblem({ code: opened.code });
        return false;
      }
      batchId = opened.batchId;
      let sent = 0;
      for (const piece of inPieces(toBring, state.limits.rowsPerCall)) {
        setProgress(t("import-progress-sending", { done: sent, total: toBring.length }));
        const added = await addPortfolioRows(batchId, piece);
        if (!added.ok) {
          await discardPortfolioImport(batchId).catch(() => undefined);
          setProblem({ code: added.code, row: added.row, field: added.field });
          return false;
        }
        sent += piece.length;
      }
      setProgress(t("import-progress-opening", { done: 0, total: toBring.length }));
      const outcome = await commitAll(batchId, (counts) => {
        started = started || counts.rows > counts.pending;
        setProgress(t("import-progress-opening", { done: counts.rows - counts.pending, total: counts.rows }));
      });
      if (!outcome.ok) {
        if (started) {
          setStale(true);
          setProblem({ code: "interrupted" });
          router.refresh();
        } else {
          await discardPortfolioImport(batchId).catch(() => undefined);
          setProblem({ code: outcome.code });
        }
        return false;
      }
      const noted =
        outcome.counts.refused > 0 || outcome.counts.created > 0 ? await notedLines(batchId).catch(() => null) : null;
      setResult({
        batchId,
        counts: outcome.counts,
        fileExists: preview.summary.exists,
        notSent: preview.summary.duplicate + preview.summary.error + fileCounts.over,
        refused: noted?.ok ? noted.refused : [],
        withoutCpf: noted?.ok ? noted.withoutCpf : [],
        withoutCpfCount: noted?.ok ? noted.withoutCpfCount : 0,
      });
      router.refresh();
      return true;
    } catch {
      // A call that did not come back: what was decided stays, and the list below says how far it went.
      if (batchId && !started) await discardPortfolioImport(batchId).catch(() => undefined);
      if (started) setStale(true);
      setProblem({ code: started ? "interrupted" : "failed" });
      router.refresh();
      return false;
    } finally {
      setProgress(null);
    }
  };

  /** Goes on with a batch of the history that did not end. */
  const resume = async (batch: ImportBatchView) => {
    setHistoryProblem(null);
    setResuming({ id: batch.id, text: t("import-progress-opening", { done: batch.decided ?? 0, total: batch.rows }) });
    try {
      const outcome = await commitAll(batch.id, (counts) =>
        setResuming({
          id: batch.id,
          text: t("import-progress-opening", { done: counts.rows - counts.pending, total: counts.rows }),
        }),
      );
      if (!outcome.ok) setHistoryProblem({ id: batch.id, code: outcome.code });
    } catch {
      setHistoryProblem({ id: batch.id, code: "failed" });
    } finally {
      setResuming(null);
      router.refresh();
    }
  };

  /** Gives up a batch nothing of which was written. */
  const discard = async (batch: ImportBatchView) => {
    setHistoryProblem(null);
    try {
      const answer = await discardPortfolioImport(batch.id);
      if (!answer.ok) setHistoryProblem({ id: batch.id, code: answer.code });
    } catch {
      setHistoryProblem({ id: batch.id, code: "failed" });
    }
    router.refresh();
  };

  /** Undoes a batch. Answers the words of why it could not, or nothing. */
  const undo = async (batchId: string): Promise<string | null> => {
    let code: string | null = null;
    try {
      const outcome = await revertAll(batchId);
      if (!outcome.ok) code = outcome.code;
      else if (result?.batchId === batchId) setResult({ ...result, counts: outcome.counts });
    } catch {
      code = "failed";
    }
    // Whatever came of it, the list below says how the batch stands now.
    router.refresh();
    return code === null ? null : t(importErrorKey(code));
  };

  const startOver = () => {
    setIndex(0);
    setFileName(null);
    setTable(null);
    setFileProblem(null);
    setMapping({});
    setExisting(null);
    setAirlineFor(new Map());
    setStale(false);
    setProblem(null);
    setResult(null);
  };

  const missing = missingRequired(mapping);

  const alert = problem ? (
    <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
      {problem.code === "invalid_row" && problem.row && problem.field === "airline"
        ? t("import-error-airline-gone", { line: problem.row })
        : problem.code === "invalid_row" && problem.row
          ? t("import-error-invalid-row-at", { line: problem.row, what: t(rowFieldKey(problem.field)) })
          : t(importErrorKey(problem.code))}
    </Alert>
  ) : null;

  const refused = result?.refused ?? [];
  const withoutCpf = result?.withoutCpf ?? [];
  const choices = table ? headerChoices(table) : [];

  const steps: WizardStep[] = [
    {
      title: t("import-step-file"),
      hint: t("import-step-file-hint"),
      canAdvance: table !== null && !reading,
      content: (
        <Box className="flex flex-col gap-4">
          <TextField
            label={t("import-source-label")}
            placeholder={t("import-source-placeholder")}
            value={source}
            onChange={(event) => setSource(event.target.value.slice(0, 80))}
            helperText={t("import-source-help")}
          />
          <input
            ref={input}
            type="file"
            accept=".xlsx,.csv,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            aria-label={t("import-choose-file")}
            onChange={(event) => {
              const file = event.target.files?.[0];
              // The same file chosen again (after it was corrected) is read again.
              event.target.value = "";
              void choose(file);
            }}
          />
          <Box className="flex flex-wrap items-center gap-3">
            <Button variant="outlined" color="grey" disabled={reading} onClick={() => input.current?.click()}>
              {table ? t("import-choose-another") : t("import-choose-file")}
            </Button>
            {fileName ? (
              <Typography variant="body2" className="text-text-secondary">
                {fileName}
              </Typography>
            ) : null}
          </Box>
          {reading ? (
            <Typography variant="body2" role="status">
              {t("import-file-reading")}
            </Typography>
          ) : null}
          {fileProblem ? (
            <Alert severity="warning" className="neutral bg-background-paper/60!">
              {t(fileProblem)}
            </Alert>
          ) : null}
          {table ? (
            <Typography variant="body2" role="status">
              {[
                t("import-file-read", { rows: table.rows.length, columns: table.headers.length }),
                table.sheet ? t("import-file-sheet", { sheet: table.sheet }) : null,
              ]
                .filter(Boolean)
                .join(" ")}
            </Typography>
          ) : null}
        </Box>
      ),
    },
    {
      title: t("import-step-columns"),
      hint: t("import-step-columns-hint"),
      canAdvance: table !== null && missing.length === 0 && progress === null,
      primaryLabel: t("import-confer"),
      onPrimary: confer,
      busy: progress !== null,
      content: (
        <Box className="flex flex-col gap-4">
          {table && choices.length > 1 ? (
            <TextField
              select
              size="small"
              label={t("import-header-line-label")}
              value={table.filled?.header ?? 0}
              onChange={(event) => {
                const read = withHeaderAt(table, Number(event.target.value));
                setExisting(null);
                setAirlineFor(new Map());
                if (read.ok) {
                  setTable(read.table);
                  setMapping(guessColumnMapping(read.table.headers));
                }
              }}
              helperText={t("import-header-line-help")}
            >
              {choices.map((choice) => (
                <MenuItem key={choice.index} value={choice.index}>
                  {t("import-header-line-option", { line: choice.line, preview: choice.preview })}
                </MenuItem>
              ))}
            </TextField>
          ) : null}
          <Box className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {PORTFOLIO_FIELDS.map((field) => (
              <TextField
                key={field}
                select
                size="small"
                label={
                  REQUIRED_FIELDS.includes(field)
                    ? t("import-field-required", { field: t(FIELD_KEY[field]) })
                    : t(FIELD_KEY[field])
                }
                value={mapping[field] ?? -1}
                onChange={(event) => {
                  const column = Number(event.target.value);
                  setExisting(null);
                  setMapping((current) => {
                    // A column serves one fact: choosing it here takes it from where it was.
                    const next: ColumnMapping = {};
                    for (const other of PORTFOLIO_FIELDS) {
                      const held = current[other];
                      if (other !== field && held !== undefined && held !== column) next[other] = held;
                    }
                    if (column >= 0) next[field] = column;
                    return next;
                  });
                }}
                helperText={samples[field] ? t("import-sample", { value: samples[field] }) : " "}
              >
                <MenuItem value={-1}>{t("import-column-none")}</MenuItem>
                {(table?.headers ?? []).map((header, column) => (
                  <MenuItem key={`${column}-${header}`} value={column}>
                    {header || t("import-column-unnamed", { letter: columnLetters(column) })}
                  </MenuItem>
                ))}
              </TextField>
            ))}
          </Box>
          {missing.length > 0 ? (
            <Alert severity="info" className="neutral bg-background-paper/60!">
              {t("import-missing-columns", { names: missing.map((field) => t(FIELD_KEY[field])).join(", ") })}
            </Alert>
          ) : mapping.client_document === undefined ? (
            <Alert severity="info" className="neutral bg-background-paper/60!">
              {t("import-no-document")}
            </Alert>
          ) : null}
          {progress ? (
            <Typography variant="body2" role="status">
              {progress}
            </Typography>
          ) : null}
          {alert}
        </Box>
      ),
    },
    {
      title: t("import-step-confer"),
      hint: t("import-step-confer-hint"),
      canAdvance: toBring.length > 0 && mayWrite && !stale,
      primaryLabel: t("import-bring", { count: toBring.length }),
      onPrimary: bring,
      busy: progress !== null,
      content: preview ? (
        <Box className="flex flex-col gap-4">
          <MetricBars
            items={[
              { key: "create", label: t("import-will-create"), value: preview.summary.create, tone: "primary" },
              { key: "exists", label: t("import-will-exist"), value: preview.summary.exists, tone: "secondary" },
              { key: "duplicate", label: t("import-will-repeat"), value: preview.summary.duplicate, tone: "empty" },
              { key: "error", label: t("import-will-fail"), value: preview.summary.error, tone: "attention" },
            ]}
          />
          {lines.length === 0 ? (
            <Alert severity="info" className="neutral bg-background-paper/60!">
              {t("import-nothing-to-bring")}
            </Alert>
          ) : (
            <Typography variant="body2" className="text-text-secondary">
              {t("import-what-happens")}
            </Typography>
          )}
          {stale ? (
            <Alert severity="warning" className="neutral bg-background-paper/60!">
              {t("import-stale")}
            </Alert>
          ) : null}
          {lines.length > toBring.length ? (
            <Alert severity="warning" className="neutral bg-background-paper/60!">
              {t("import-over-limit", { max: state.limits.maxRows })}
            </Alert>
          ) : null}
          {toBring.length > 0 ? (
            <Box className="flex flex-col gap-2">
              <Typography variant="body2" className="font-semibold">
                {t("import-carry-title")}
              </Typography>
              <MetricBars
                spacing="dense"
                total={toBring.length}
                items={[
                  { key: "cpf", label: t("import-carry-cpf"), value: carry.cpf, tone: "primary" },
                  { key: "airline", label: t("import-carry-airline"), value: carry.airline, tone: "primary" },
                  { key: "filed", label: t("import-carry-filed"), value: carry.filed, tone: "primary" },
                  { key: "closed", label: t("import-carry-closed"), value: carry.closed, tone: "secondary" },
                ]}
              />
            </Box>
          ) : null}
          {preview.endedStatuses.length > 0 ? (
            <Box className="flex flex-col gap-1">
              <Typography variant="body2" className="font-semibold">
                {t("import-ended-title")}
              </Typography>
              <Box component="ul" className="m-0 flex flex-col gap-1 pl-5">
                {preview.endedStatuses.slice(0, ENDED_SHOWN).map((status) => (
                  <Typography key={status.label} component="li" variant="body2">
                    {t("import-ended-status", { status: status.label, count: status.lines })}
                  </Typography>
                ))}
              </Box>
              {preview.endedStatuses.length > ENDED_SHOWN ? (
                <Typography variant="body2" className="text-text-secondary">
                  {t("import-ended-more", { count: preview.endedStatuses.length - ENDED_SHOWN })}
                </Typography>
              ) : null}
              <Typography variant="body2" className="text-text-secondary">
                {t("import-ended-help")}
              </Typography>
            </Box>
          ) : null}
          {preview.opponents.length > 0 ? (
            <Box component="section" aria-labelledby="import-opponents" className="flex flex-col gap-3">
              <Box className="flex flex-col gap-1">
                <Typography id="import-opponents" variant="body2" className="font-semibold">
                  {t("import-opponents-title")}
                </Typography>
                <Typography variant="body2" className="text-text-secondary">
                  {t("import-opponents-help")}
                </Typography>
              </Box>
              {(allOpponents ? preview.opponents : preview.opponents.slice(0, OPPONENTS_SHOWN)).map((opponent) => (
                <TextField
                  key={opponent.key}
                  select
                  size="small"
                  label={t("import-opponent-label", { name: opponent.label, count: opponent.lines })}
                  value={opponent.airline ?? NO_AIRLINE}
                  onChange={(event) => {
                    const chosen = event.target.value === NO_AIRLINE ? null : event.target.value;
                    setAirlineFor((current) => new Map(current).set(opponent.key, chosen));
                  }}
                  helperText={
                    opponent.airline === opponent.recognized
                      ? opponent.recognized
                        ? t("import-opponent-recognized")
                        : t("import-opponent-unrecognized")
                      : t("import-opponent-chosen")
                  }
                >
                  <MenuItem value={NO_AIRLINE}>{t("import-opponent-none")}</MenuItem>
                  {flying.map((airline) => (
                    <MenuItem key={airline.iata} value={airline.iata}>
                      {airline.name}
                    </MenuItem>
                  ))}
                </TextField>
              ))}
              {preview.opponents.length > OPPONENTS_SHOWN ? (
                <Box>
                  <Button variant="text" color="grey" size="small" onClick={() => setAllOpponents((all) => !all)}>
                    {allOpponents
                      ? t("import-opponents-fewer")
                      : t("import-opponents-all", { count: preview.opponents.length })}
                  </Button>
                </Box>
              ) : null}
            </Box>
          ) : null}
          {toBring.length > 0 ? (
            <Box className="flex flex-col gap-1">
              <Typography variant="body2" className="font-semibold">
                {t("import-samples-title")}
              </Typography>
              <Box component="ul" className="m-0 flex flex-col gap-1 pl-5">
                {toBring.slice(0, SAMPLES_SHOWN).map((line) => (
                  <Typography key={line.row} component="li" variant="body2">
                    {[
                      t("import-line", { line: line.row }),
                      formatCnj(line.cnj) ?? line.cnj,
                      line.client_name,
                      line.cpf ? t("import-sample-cpf") : null,
                      line.court,
                      t(KIND_KEY[line.kind]),
                      line.airline ? (airlineName.get(line.airline) ?? line.airline) : null,
                      line.filed_on ? t("import-sample-filed", { day: dayLabel(line.filed_on) }) : null,
                      t(line.closed ? "import-sample-closed" : "import-sample-open"),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Typography>
                ))}
              </Box>
            </Box>
          ) : null}
          {ROW_ERRORS.some((code) => preview.problems[code]) ? (
            <Box className="flex flex-col gap-1">
              <Typography variant="body2" className="font-semibold">
                {t("import-errors-title")}
              </Typography>
              <Box component="ul" className="m-0 flex flex-col gap-1 pl-5">
                {ROW_ERRORS.filter((code) => preview.problems[code]).map((code) => (
                  <Typography key={code} component="li" variant="body2">
                    {t(ROW_PROBLEM_KEY[code], { count: preview.problems[code] ?? 0 })}
                  </Typography>
                ))}
              </Box>
            </Box>
          ) : null}
          {ROW_WARNINGS.some((code) => preview.problems[code]) ? (
            <Box className="flex flex-col gap-1">
              <Typography variant="body2" className="font-semibold">
                {t("import-warnings-title")}
              </Typography>
              <Box component="ul" className="m-0 flex flex-col gap-1 pl-5">
                {ROW_WARNINGS.filter((code) => preview.problems[code]).map((code) => (
                  <Typography key={code} component="li" variant="body2">
                    {t(ROW_PROBLEM_KEY[code], {
                      count: preview.problems[code] ?? 0,
                      oldest: dayLabel(state.limits.oldestFiledOn),
                    })}
                  </Typography>
                ))}
              </Box>
            </Box>
          ) : null}
          {cpfLines.length > 0 ? (
            <Box className="flex flex-col gap-1">
              <Typography variant="body2" className="font-semibold">
                {t("import-cpf-lines-title")}
              </Typography>
              <Box component="ul" className="m-0 flex flex-col gap-1 pl-5">
                {cpfLines.slice(0, PROBLEMS_SHOWN).map((row) => (
                  <Typography key={row.line} component="li" variant="body2">
                    {[t("import-line", { line: row.line }), row.cnjLabel, row.clientName].join(" · ")}
                  </Typography>
                ))}
              </Box>
              {cpfLines.length > PROBLEMS_SHOWN ? (
                <Typography variant="body2" className="text-text-secondary">
                  {t("import-lines-more", { count: cpfLines.length - PROBLEMS_SHOWN })}
                </Typography>
              ) : null}
            </Box>
          ) : null}
          {errorLines.length > 0 ? (
            <Box className="flex flex-col gap-1">
              <Typography variant="body2" className="font-semibold">
                {t("import-error-lines-title")}
              </Typography>
              <Box component="ul" className="m-0 flex flex-col gap-1 pl-5">
                {errorLines.slice(0, PROBLEMS_SHOWN).map((row) => (
                  <Typography key={row.line} component="li" variant="body2">
                    {[
                      t("import-line", { line: row.line }),
                      row.cnjLabel,
                      row.clientName,
                      row.error ? t(LINE_ERROR_KEY[row.error]) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Typography>
                ))}
              </Box>
              {errorLines.length > PROBLEMS_SHOWN ? (
                <Typography variant="body2" className="text-text-secondary">
                  {t("import-lines-more", { count: errorLines.length - PROBLEMS_SHOWN })}
                </Typography>
              ) : null}
            </Box>
          ) : null}
          {progress ? (
            <Typography variant="body2" role="status">
              {progress}
            </Typography>
          ) : null}
          {alert}
        </Box>
      ) : null,
    },
    {
      title: t("import-step-done"),
      hint: t("import-step-done-hint"),
      noBack: true,
      secondary: { label: t("import-another"), onClick: startOver },
      content: result ? (
        <Box className="flex flex-col gap-4">
          <MetricBars
            items={[
              { key: "created", label: t("import-done-created"), value: result.counts.created, tone: "primary" },
              {
                key: "exists",
                label: t("import-done-exists"),
                value: result.fileExists + result.counts.exists,
                tone: "secondary",
              },
              { key: "refused", label: t("import-done-refused"), value: result.counts.refused, tone: "attention" },
              ...(result.counts.reverted + result.counts.kept > 0
                ? [
                    {
                      key: "reverted",
                      label: t("import-done-reverted"),
                      value: result.counts.reverted,
                      tone: "empty" as const,
                    },
                    {
                      key: "kept",
                      label: t("import-done-kept"),
                      value: result.counts.kept,
                      tone: "secondary" as const,
                    },
                  ]
                : []),
            ]}
          />
          {result.notSent > 0 ? (
            <Typography variant="body2">{t("import-done-not-sent", { count: result.notSent })}</Typography>
          ) : null}
          <Typography variant="body2" className="text-text-secondary">
            {t("import-done-next")}
          </Typography>
          {withoutCpf.length > 0 ? (
            <Box className="flex flex-col gap-1">
              <Typography variant="body2" className="font-semibold">
                {t("import-without-cpf-title")}
              </Typography>
              <Box component="ul" className="m-0 flex flex-col gap-1 pl-5">
                {withoutCpf.map((line) => (
                  <Typography key={line.line} component="li" variant="body2">
                    {[t("import-line", { line: line.line }), formatCnj(line.cnj) ?? line.cnj].join(" · ")}
                  </Typography>
                ))}
              </Box>
              {result.withoutCpfCount > withoutCpf.length ? (
                <Typography variant="body2" className="text-text-secondary">
                  {t("import-lines-more", { count: result.withoutCpfCount - withoutCpf.length })}
                </Typography>
              ) : null}
            </Box>
          ) : null}
          {refused.length > 0 ? (
            <Box className="flex flex-col gap-1">
              <Typography variant="body2" className="font-semibold">
                {t("import-refused-title")}
              </Typography>
              <Box component="ul" className="m-0 flex flex-col gap-1 pl-5">
                {refused.map((line) => (
                  <Typography key={line.line} component="li" variant="body2">
                    {[
                      t("import-line", { line: line.line }),
                      formatCnj(line.cnj) ?? line.cnj,
                      t(refusedLineKey(line.code)),
                    ].join(" · ")}
                  </Typography>
                ))}
              </Box>
              {result.counts.refused > refused.length ? (
                <Typography variant="body2" className="text-text-secondary">
                  {t("import-lines-more", { count: result.counts.refused - refused.length })}
                </Typography>
              ) : null}
            </Box>
          ) : null}
        </Box>
      ) : null,
    },
  ];

  return (
    <>
      {state.secondFactor === "missing" ? (
        <Alert
          severity="warning"
          className="neutral bg-background-paper/60!"
          action={
            <Button color="inherit" size="small" href="/settings/security" LinkComponent={Link}>
              {t("approvals-second-factor-setup")}
            </Button>
          }
        >
          {t("import-second-factor-missing")}
        </Alert>
      ) : state.secondFactor === "challenge" ? (
        <Alert
          severity="warning"
          className="neutral bg-background-paper/60!"
          action={
            <Button color="inherit" size="small" href="/auth/two-factor?next=/casos/importar" LinkComponent={Link}>
              {t("approvals-second-factor-confirm")}
            </Button>
          }
        >
          {t("import-second-factor-challenge")}
        </Alert>
      ) : null}

      <SetupWizard
        steps={steps}
        index={index}
        onIndexChange={setIndex}
        onComplete={() => router.push("/casos?ver=filed")}
        completeLabel={t("import-see-cases")}
      />

      {state.history.length > 0 ? (
        <Card component="section" aria-labelledby="import-history" className="mx-auto w-full max-w-2xl">
          <CardContent className="flex flex-col gap-4">
            <Typography id="import-history" variant="h5" component="h2" className="mb-0">
              {t("import-history-title")}
            </Typography>
            {state.history.map((batch) => {
              const stopped = batch.status === "staged";
              const started = stopped && (batch.decided ?? 0) > 0;
              return (
                <Box key={batch.id} className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4">
                  <Box className="flex flex-wrap items-start justify-between gap-2">
                    <Box className="flex min-w-0 flex-col">
                      <Typography variant="body1" className="font-semibold">
                        {batch.fileName ?? t("import-history-unnamed")}
                      </Typography>
                      <Typography variant="body2" className="text-text-secondary">
                        {[batch.source, batch.whenLabel].filter(Boolean).join(" · ")}
                      </Typography>
                    </Box>
                    <StatusChip tone={STATUS[batch.status].tone} label={t(STATUS[batch.status].key)} />
                  </Box>
                  {batch.counts ? (
                    <MetricBars
                      spacing="dense"
                      items={[
                        {
                          key: "created",
                          label: t("import-done-created"),
                          value: batch.counts.created,
                          tone: "primary",
                        },
                        {
                          key: "exists",
                          label: t("import-done-exists"),
                          value: batch.fileExists + batch.counts.exists,
                          tone: "secondary",
                        },
                        {
                          key: "refused",
                          label: t("import-done-refused"),
                          value: batch.counts.refused,
                          tone: "attention",
                        },
                        ...(batch.status === "reverted"
                          ? [
                              {
                                key: "reverted",
                                label: t("import-done-reverted"),
                                value: batch.counts.reverted,
                                tone: "empty" as const,
                              },
                              {
                                key: "kept",
                                label: t("import-done-kept"),
                                value: batch.counts.kept,
                                tone: "secondary" as const,
                              },
                            ]
                          : []),
                      ]}
                    />
                  ) : (
                    <Typography variant="body2">
                      {started
                        ? t("import-history-stopped", { decided: batch.decided ?? 0, rows: batch.rows })
                        : t("import-history-waiting", { rows: batch.rows })}
                    </Typography>
                  )}
                  {resuming?.id === batch.id ? (
                    <Typography variant="body2" role="status">
                      {resuming.text}
                    </Typography>
                  ) : null}
                  {historyProblem?.id === batch.id ? (
                    <Alert
                      severity="error"
                      className="neutral bg-background-paper/60!"
                      onClose={() => setHistoryProblem(null)}
                    >
                      {t(importErrorKey(historyProblem.code))}
                    </Alert>
                  ) : null}
                  {stopped ? (
                    <Box className="flex flex-wrap gap-2">
                      {batch.rows > 0 ? (
                        <Button
                          variant="outlined"
                          color="grey"
                          size="small"
                          disabled={working || !mayWrite}
                          onClick={() => void resume(batch)}
                        >
                          {t("import-continue")}
                        </Button>
                      ) : null}
                      {started ? (
                        <Button
                          variant="text"
                          color="grey"
                          size="small"
                          disabled={working || !mayWrite}
                          onClick={() => setUndoing(batch.id)}
                        >
                          {t("import-undo")}
                        </Button>
                      ) : (
                        <Button
                          variant="text"
                          color="grey"
                          size="small"
                          disabled={working}
                          onClick={() => void discard(batch)}
                        >
                          {t("import-discard")}
                        </Button>
                      )}
                    </Box>
                  ) : batch.status === "committed" && batch.counts && batch.counts.created > 0 ? (
                    <Box>
                      <Button
                        variant="text"
                        color="grey"
                        size="small"
                        disabled={working || !mayWrite}
                        onClick={() => setUndoing(batch.id)}
                      >
                        {t("import-undo")}
                      </Button>
                    </Box>
                  ) : null}
                </Box>
              );
            })}
          </CardContent>
        </Card>
      ) : null}

      {undoing ? (
        <ConfirmActionDialog
          title={t("import-undo-title")}
          intro={t("import-undo-intro")}
          consequences={[t("import-undo-removes"), t("import-undo-clients")]}
          staysTitle={t("import-undo-stays-title")}
          stays={[t("import-undo-stays-worked"), t("import-undo-stays-other"), t("import-undo-stays-had")]}
          requireReason={false}
          confirmLabel={t("import-undo-confirm")}
          cancelLabel={t("import-undo-cancel")}
          busyLabel={t("import-undo-busy")}
          tone="danger"
          onConfirm={() => undo(undoing)}
          onClose={() => setUndoing(null)}
        />
      ) : null}
    </>
  );
}
