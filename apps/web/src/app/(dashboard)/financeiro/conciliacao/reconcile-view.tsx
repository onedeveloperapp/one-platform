"use client";

import FinanceGate from "../finance-gate";
import type { FinanceRegistrations, FinanceState } from "../load-finance";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useMemo, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  FormControlLabel,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";

import CardTitle from "@/components/product/card-title";
import EmptyState from "@/components/product/empty-state";
import ListBar, { type ListView } from "@/components/product/list-bar";
import ListMore, { useListPart } from "@/components/product/list-more";
import OutcomeDialog from "@/components/product/outcome-dialog";
import PageHeader from "@/components/product/page-header";
import QuickActions from "@/components/product/quick-actions";
import SidePanel from "@/components/product/side-panel";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import IllustrationDocumentation from "@/icons/illustrations/illustration-documentation";
import NiReceipt from "@/icons/nexture/ni-receipt";
import NiUploadCloud from "@/icons/nexture/ni-upload-cloud";
import {
  addFinanceStatementLines,
  beginFinanceStatement,
  decideFinanceLine,
  finishFinanceStatement,
  undoFinanceLine,
} from "@/lib/finance/actions";
import {
  categoryFits,
  dayLabel,
  type EntryKind,
  financeErrorKey,
  financeFieldKey,
  money,
  operatesBooks,
} from "@/lib/finance/books";
import { sendStatementPdf } from "@/lib/finance/document-browser";
import type { FinanceLine } from "@/lib/finance/read";
import { readStatementFile, type StatementFile } from "@/lib/finance/statement-file";
import { memoWords } from "@flyee/rules/finance";

/** How many lines the list draws at a time. */
const LINES_STEP = 100;
const VIEWS = ["esperam", "one", "todas"] as const;
type View = (typeof VIEWS)[number];
const VIEW_KEY: Record<View, string> = {
  esperam: "finance-lines-view-pending",
  one: "finance-lines-view-one",
  todas: "finance-lines-view-all",
};
const STATE_KEY: Record<FinanceLine["state"], string> = {
  pending: "finance-line-pending",
  entered: "finance-line-entered",
  matched: "finance-line-matched",
  ignored: "finance-line-ignored",
};
/** Why ONE decided a line, in the screen's words. */
const ruleKey = (rule: string | null): string =>
  rule === "client_money"
    ? "finance-line-rule-client"
    : rule === "manual_entry"
      ? "finance-line-rule-manual"
      : rule === "transfer"
        ? "finance-line-rule-transfer"
        : rule === "ai"
          ? "finance-line-rule-ai"
          : rule?.startsWith("rule:")
            ? "finance-line-rule-firm"
            : "finance-line-rule-person";

/** How ONE's suggestion is said: sure, or not. */
const SUGGESTION_KEY = { sure: "finance-line-suggestion-sure", unsure: "finance-line-suggestion" } as const;

const inView = (line: FinanceLine, view: View) =>
  view === "esperam" ? line.state === "pending" : view === "one" ? line.byOne && line.state !== "pending" : true;

const SEND = 400;
/** Why a file is no statement this screen reads. */
const FILE_KEY: Record<string, string> = {
  file_not_ofx: "finance-import-not-ofx",
  file_no_lines: "finance-import-no-lines",
  file_too_large: "finance-import-too-large",
  file_unreadable: "finance-import-unreadable",
  file_pdf: "finance-import-pdf",
  file_columns_unknown: "finance-import-columns-unknown",
  file_spreadsheet: "finance-import-spreadsheet",
  file_pdf_not_statement: "finance-import-pdf-not-statement",
  file_pdf_no_lines: "finance-import-no-lines",
  file_pdf_no_balances: "finance-import-pdf-no-balances",
  file_pdf_too_many: "finance-import-pdf-too-many",
  file_pdf_unbalanced: "finance-import-pdf-unreadable",
  file_pdf_failed: "finance-import-pdf-failed",
};

type Imported = {
  decided: number;
  pending: number;
  gapCents: number | null;
  added: number;
  known: number;
  repeated: number;
};

/**
 * `/financeiro/conciliacao`: the statements and their lines (migration 0126). Who operates sends the OFX the bank
 * gives (read here, never uploaded); ONE decides what its rules decide (a client's money, an entry written by hand, a
 * transfer, a firm's rule) and says the books against the bank's balance; what is left waits for a person, who decides
 * it and may keep the answer as a rule. What ONE decided can be undone.
 */
export default function ReconcileView({ state }: { state: FinanceState }) {
  const t = useTranslations("product");
  const router = useRouter();
  const [view, setView] = useState<View>("esperam");
  const [deciding, setDeciding] = useState<FinanceLine | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const lines = useMemo(() => (state.kind === "ready" ? (state.lines ?? []) : []), [state]);
  const shown = useMemo(() => lines.filter((line) => inView(line, view)), [lines, view]);
  // Every line is read (the views count all of them, an old one that waits included); the list is drawn in parts.
  const listed = useListPart(shown, LINES_STEP, view);
  if (state.kind !== "ready") return <FinanceGate state={state} title={t("finance-reconcile-title")} />;
  const writes = operatesBooks(state.level) && !state.supportVisit;
  const views: ListView[] = VIEWS.map((key) => ({
    key,
    label: t(VIEW_KEY[key]),
    count: String(lines.filter((line) => inView(line, key)).length),
    group: t("finance-lines-views"),
  }));

  const undo = async (line: FinanceLine) => {
    setBusy(line.id);
    setProblem(null);
    try {
      const result = await undoFinanceLine(line.id);
      if (!result.ok) setProblem(result.code);
      else router.refresh();
    } catch {
      setProblem("failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title={t("finance-reconcile-title")}
        crumbs={[{ label: t("finance-crumb"), href: "/financeiro" }, { label: t("finance-reconcile-title") }]}
        description={t("finance-reconcile-description")}
      />
      {writes ? <ImportCard registrations={state.registrations} onDone={() => router.refresh()} /> : null}
      <ListBar
        label={t("finance-reconcile-title")}
        viewsTitle={t("list-views-title")}
        views={views}
        view={view}
        onView={(key) => setView(key as View)}
      />
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
      <Card>
        <CardContent>
          {shown.length === 0 ? (
            <EmptyState
              icon={<NiReceipt size="large" />}
              illustration={<IllustrationDocumentation />}
              title={view === "esperam" ? t("finance-lines-none-pending") : t("finance-lines-none")}
              description={lines.length === 0 ? t("finance-lines-empty-body") : undefined}
              titleAs="h2"
              framed={false}
            />
          ) : (
            <Box component="ul" className="m-0 flex list-none flex-col p-0">
              {listed.part.map((line) => (
                <Box
                  component="li"
                  key={line.id}
                  className="border-grey-100 flex flex-col gap-2 border-b py-3 last:border-b-0"
                >
                  <Box className="flex items-start justify-between gap-3">
                    <Box className="flex min-w-0 flex-col gap-1">
                      <Typography variant="body1" className="break-words">
                        {line.memo || t("finance-line-no-memo")}
                      </Typography>
                      <Typography variant="body2" className="text-text-secondary">
                        {[dayLabel(line.postedOn), line.account].join(" · ")}
                      </Typography>
                    </Box>
                    <Box className="flex shrink-0 items-start gap-2">
                      <Typography variant="body1" className="tabular-nums">
                        {money(line.cents)}
                      </Typography>
                      {writes && line.state === "pending" ? (
                        <Button size="small" variant="outlined" onClick={() => setDeciding(line)}>
                          {t("finance-line-decide")}
                        </Button>
                      ) : null}
                      {writes && line.state !== "pending" ? (
                        <QuickActions
                          label={t("finance-line-actions")}
                          actions={[
                            {
                              key: "undo",
                              label: t("finance-line-undo"),
                              onClick: () => void undo(line),
                              disabled: busy === line.id,
                            },
                          ]}
                        />
                      ) : null}
                    </Box>
                  </Box>
                  {line.state === "pending" ? (
                    line.repeated ? (
                      <StateLine tone="attention">{t("finance-line-repeated")}</StateLine>
                    ) : line.reading ? (
                      <StateLine tone="waiting">{t("finance-line-reading")}</StateLine>
                    ) : line.suggestion?.categoryId ? (
                      <StateLine tone="attention">
                        {t("finance-line-suggested", {
                          category:
                            state.registrations.categories.find(
                              (category) => category.id === line.suggestion?.categoryId,
                            )?.name ?? "",
                        })}
                      </StateLine>
                    ) : (
                      <StateLine tone="waiting">{t(STATE_KEY.pending)}</StateLine>
                    )
                  ) : (
                    <StateLine tone={line.state === "ignored" ? "info" : "done"}>
                      {t(STATE_KEY[line.state])}
                      {line.byOne ? ` ${t(ruleKey(line.rule))}` : ""}
                    </StateLine>
                  )}
                  {line.byOne && line.state !== "pending" ? (
                    <Box>
                      <StatusChip tone="neutral" label={t("finance-by-one")} />
                    </Box>
                  ) : null}
                </Box>
              ))}
            </Box>
          )}
          <ListMore shown={listed.part.length} total={listed.total} step={LINES_STEP} onMore={listed.more} />
        </CardContent>
      </Card>
      <Typography variant="caption" className="text-text-secondary">
        {t("finance-one-may-err")}
      </Typography>
      {deciding ? (
        <LinePanel
          line={deciding}
          registrations={state.registrations}
          onClose={() => setDeciding(null)}
          onSaved={() => {
            setDeciding(null);
            router.refresh();
          }}
        />
      ) : null}
    </Box>
  );
}

/** Sends a statement: the file read here, its account chosen, its lines sent a few hundred at a time. */
function ImportCard({ registrations, onDone }: { registrations: FinanceRegistrations; onDone: () => void }) {
  const t = useTranslations("product");
  const accounts = registrations.accounts.filter((account) => !account.archived);
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [file, setFile] = useState<Extract<StatementFile, { ok: true }> | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<Imported | null>(null);
  const input = useRef<HTMLInputElement | null>(null);

  const [readingPdf, setReadingPdf] = useState(false);
  const [difference, setDifference] = useState<number | null>(null);
  const choose = async (chosen: File) => {
    setProblem(null);
    setFile(null);
    setDifference(null);
    const read = await readStatementFile(chosen);
    if (read.ok) return setFile(read);
    if (read.code !== "pdf") return setProblem(`file_${read.code}`);
    // A PDF is read by ONE on the server, and comes back only when its lines add up (0169).
    setReadingPdf(true);
    try {
      const sent = await sendStatementPdf(chosen);
      if (sent.ok) setFile(sent);
      else {
        setProblem(sent.code.startsWith("pdf_") ? `file_${sent.code}` : "file_pdf_failed");
        if ("differenceCents" in sent && typeof sent.differenceCents === "number") setDifference(sent.differenceCents);
      }
    } catch {
      setProblem("file_pdf_failed");
    } finally {
      setReadingPdf(false);
    }
  };

  const send = async () => {
    if (!file || !accountId) return;
    setBusy(true);
    setProblem(null);
    try {
      const { statement } = file;
      const begun = await beginFinanceStatement(accountId, {
        fileName: file.fileName,
        sha256: file.sha256,
        startsOn: statement.startsOn,
        endsOn: statement.endsOn,
        balanceCents: statement.balance?.cents ?? null,
        balanceOn: statement.balance?.on ?? null,
        format: file.format,
      });
      if (!begun.ok) return setProblem(begun.code);
      const totals = { added: 0, known: 0, repeated: 0 };
      for (let start = 0; start < statement.lines.length; start += SEND) {
        const sent = await addFinanceStatementLines(begun.statementId, statement.lines.slice(start, start + SEND));
        if (!sent.ok) return setProblem(sent.code);
        totals.added += sent.added;
        totals.known += sent.known;
        totals.repeated += sent.repeated;
      }
      const finished = await finishFinanceStatement(begun.statementId);
      if (!finished.ok) return setProblem(finished.code);
      setOutcome({ ...totals, decided: finished.decided, pending: finished.pending, gapCents: finished.gapCents });
      setFile(null);
    } catch {
      setProblem("failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card component="section" aria-labelledby="finance-import">
      <CardContent className="flex flex-col gap-4">
        <CardTitle
          id="finance-import"
          icon={<NiUploadCloud size="medium" />}
          tone="primary"
          title={t("finance-import-title")}
          description={t("finance-import-description")}
        />
        {accounts.length === 0 ? (
          <StateLine tone="attention">{t("finance-entry-no-account")}</StateLine>
        ) : (
          <Box className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <TextField
              select
              label={t("finance-field-account")}
              value={accountId}
              onChange={(event) => setAccountId(event.target.value)}
              className="sm:min-w-64"
            >
              {accounts.map((account) => (
                <MenuItem key={account.id} value={account.id}>
                  {account.name}
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant="outlined"
              color="grey"
              disabled={busy || readingPdf}
              loading={readingPdf}
              onClick={() => input.current?.click()}
            >
              {t("finance-import-choose")}
            </Button>
            <input
              ref={input}
              type="file"
              accept=".ofx,.qfx,.csv,.txt,.xlsx,.pdf,application/x-ofx,text/plain,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf"
              hidden
              aria-label={t("finance-import-choose")}
              onChange={(event) => {
                const chosen = event.target.files?.[0];
                event.target.value = "";
                if (chosen) void choose(chosen);
              }}
            />
          </Box>
        )}
        {file ? (
          <Box className="flex flex-col gap-2">
            <StateLine tone="info">
              {t("finance-import-read", {
                name: file.fileName,
                count: file.statement.lines.length,
                from: dayLabel(file.statement.startsOn ?? file.statement.lines.at(-1)?.postedOn ?? null),
                to: dayLabel(file.statement.endsOn ?? file.statement.lines[0]?.postedOn ?? null),
              })}
            </StateLine>
            {file.statement.balance ? (
              <StateLine tone="info">
                {t("finance-import-bank-balance", {
                  value: money(file.statement.balance.cents),
                  day: dayLabel(file.statement.balance.on),
                })}
              </StateLine>
            ) : null}
            <Box>
              <Button variant="contained" disabled={busy} onClick={() => void send()}>
                {busy ? t("finance-import-sending") : t("finance-import-send")}
              </Button>
            </Box>
          </Box>
        ) : null}
        {readingPdf ? <StateLine tone="waiting">{t("finance-import-pdf-reading")}</StateLine> : null}
        {file?.format === "pdf" ? <StateLine tone="info">{t("finance-import-pdf-read")}</StateLine> : null}
        {problem ? (
          <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
            {problem === "file_pdf_unbalanced" && difference !== null
              ? t("finance-import-pdf-unbalanced", { value: money(Math.abs(difference)) })
              : t(FILE_KEY[problem] ?? financeErrorKey(problem))}
          </Alert>
        ) : null}
        <Typography variant="caption" className="text-text-secondary">
          {t("finance-import-privacy")}
        </Typography>
      </CardContent>
      {outcome ? (
        <OutcomeDialog
          open
          tone={outcome.pending > 0 || (outcome.gapCents ?? 0) !== 0 ? "info" : "done"}
          title={t("finance-import-done-title")}
          lines={[
            {
              key: "added",
              icon: <NiReceipt size="medium" />,
              text: t("finance-import-done-added", { count: outcome.added }),
            },
            ...(outcome.known > 0
              ? [
                  {
                    key: "known",
                    icon: <NiReceipt size="medium" />,
                    text: t("finance-import-done-known", { count: outcome.known }),
                  },
                ]
              : []),
            ...(outcome.repeated > 0
              ? [
                  {
                    key: "repeated",
                    icon: <NiReceipt size="medium" />,
                    text: t("finance-import-done-repeated", { count: outcome.repeated }),
                  },
                ]
              : []),
            {
              key: "decided",
              icon: <NiReceipt size="medium" />,
              text: t("finance-import-done-decided", { count: outcome.decided }),
            },
            ...(outcome.pending > 0
              ? [
                  {
                    key: "pending",
                    icon: <NiReceipt size="medium" />,
                    text: t("finance-import-done-pending", { count: outcome.pending }),
                  },
                ]
              : []),
            ...(outcome.gapCents === null
              ? []
              : [
                  {
                    key: "gap",
                    icon: <NiReceipt size="medium" />,
                    text:
                      outcome.gapCents === 0
                        ? t("finance-import-done-agrees")
                        : t("finance-import-done-gap", { gap: money(Math.abs(outcome.gapCents)) }),
                  },
                ]),
          ]}
          closeLabel={t("finance-understood")}
          onClose={() => {
            setOutcome(null);
            onDone();
          }}
        />
      ) : null}
    </Card>
  );
}

/** A person decides a line: what kind of money it is and its category, or that it is nothing (a repetition), with a rule. */
function LinePanel({
  line,
  registrations,
  onClose,
  onSaved,
}: {
  line: FinanceLine;
  registrations: FinanceRegistrations;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const incoming = line.cents > 0;
  const kinds: (Exclude<EntryKind, "transfer"> | "ignore")[] = incoming
    ? ["income", "client_money", "partner", "ignore"]
    : ["expense", "client_money", "partner", "ignore"];
  const suggested = registrations.categories.find(
    (category) => category.id === line.suggestion?.categoryId && !category.archived,
  );
  // ONE's suggestion opens the panel: its kind and its category, which the person confirms or changes.
  const suggestedKind: (typeof kinds)[number] | null = !suggested
    ? null
    : suggested.kind === "income" || suggested.kind === "expense" || suggested.kind === "client_money"
      ? suggested.kind
      : suggested.kind === "partner_in" || suggested.kind === "partner_out"
        ? "partner"
        : null;
  const [kind, setKind] = useState<(typeof kinds)[number]>(
    suggestedKind && kinds.includes(suggestedKind) ? suggestedKind : kinds[0],
  );
  const categories = registrations.categories.filter(
    (category) =>
      !category.archived &&
      kind !== "ignore" &&
      categoryFits(kind, category.kind) &&
      (kind !== "partner" || (incoming ? category.kind === "partner_in" : category.kind === "partner_out")),
  );
  const centers = registrations.costCenters.filter((center) => !center.archived);
  const [categoryId, setCategoryId] = useState(suggested?.id ?? "");
  const [centerId, setCenterId] = useState("");
  const [counterparty, setCounterparty] = useState(line.suggestion?.counterparty ?? "");
  const [keepRule, setKeepRule] = useState(false);
  const [ruleWords, setRuleWords] = useState(memoWords(line.memo).split(" ").slice(0, 3).join(" "));
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ code: string; field?: string } | null>(null);
  const chosenCategory = categories.some((category) => category.id === categoryId)
    ? categoryId
    : (categories[0]?.id ?? "");

  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await decideFinanceLine(line.id, {
        kind,
        categoryId: kind === "ignore" ? null : chosenCategory || null,
        costCenterId: kind === "ignore" ? null : centerId || null,
        counterparty,
        ruleWords: kind !== "ignore" && keepRule ? ruleWords : "",
        ignoreReason: kind === "ignore" ? reason : "",
      });
      if (result.ok) onSaved();
      else setProblem({ code: result.code, field: result.field });
    } catch {
      setProblem({ code: "failed" });
    } finally {
      setBusy(false);
    }
  };

  const KIND_KEY: Record<(typeof kinds)[number], string> = {
    income: "finance-kind-income",
    expense: "finance-kind-expense",
    client_money: "finance-kind-client-money",
    partner: "finance-kind-partner",
    ignore: "finance-line-ignore",
  };

  return (
    <SidePanel
      onClose={onClose}
      closeLabel={t("finance-cancel")}
      icon={<NiReceipt size="medium" />}
      tone="primary"
      busy={busy}
      title={t("finance-line-panel-title", { value: money(line.cents) })}
      description={t("finance-line-panel-body")}
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
        <StateLine tone="info">
          {[dayLabel(line.postedOn), line.account, line.memo].filter(Boolean).join(" · ")}
        </StateLine>
        {suggested ? (
          <StateLine tone="attention">
            {t(line.suggestion?.sure ? SUGGESTION_KEY.sure : SUGGESTION_KEY.unsure, {
              category: suggested.name,
            })}
          </StateLine>
        ) : null}
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
          onChange={(event) => setKind(event.target.value as typeof kind)}
        >
          {kinds.map((option) => (
            <MenuItem key={option} value={option}>
              {t(KIND_KEY[option])}
            </MenuItem>
          ))}
        </TextField>
        {kind === "ignore" ? (
          <TextField
            label={t("finance-field-reason")}
            value={reason}
            onChange={(event) => setReason(event.target.value.slice(0, 300))}
            helperText={t("finance-line-ignore-help")}
          />
        ) : (
          <>
            <TextField
              select
              label={t("finance-field-category")}
              value={chosenCategory}
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
            <FormControlLabel
              control={<Checkbox checked={keepRule} onChange={(event) => setKeepRule(event.target.checked)} />}
              label={t("finance-line-keep-rule")}
            />
            {keepRule ? (
              <TextField
                label={t("finance-field-rule-words")}
                value={ruleWords}
                onChange={(event) => setRuleWords(event.target.value.slice(0, 80))}
                helperText={t("finance-field-rule-words-help")}
              />
            ) : null}
          </>
        )}
      </Box>
    </SidePanel>
  );
}
