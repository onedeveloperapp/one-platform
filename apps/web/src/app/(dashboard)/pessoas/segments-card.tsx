"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import {
  Alert,
  Autocomplete,
  Box,
  Button,
  Card,
  CardContent,
  Checkbox,
  FormControlLabel,
  FormGroup,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";

import { useViewer } from "@/components/layout/viewer-context";
import CardTitle from "@/components/product/card-title";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import EmptyState from "@/components/product/empty-state";
import QuickActions from "@/components/product/quick-actions";
import SecondFactorPrompt from "@/components/product/second-factor-prompt";
import SidePanel from "@/components/product/side-panel";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import IllustrationEmail from "@/icons/illustrations/illustration-email";
import NiFilter from "@/icons/nexture/ni-filter";
import { writeXlsx, XLSX_TYPE } from "@/lib/export/xlsx-write";
import { savedFileName, saveFile } from "@/lib/files/save-file";
import { caseKindLabelKey, firmCaseKinds } from "@/lib/modules/registry";
import { acceptMarketingTerm, archiveSegment, countSegment, exportSegment, saveSegment } from "@/lib/people/actions";
import {
  DEFAULT_COLUMNS,
  EXPORT_COLUMN_KEY,
  EXPORT_COLUMNS,
  type ExportColumn,
  exportLines,
  filterCount,
  ORIGIN_KEY,
  ORIGINS,
  OUTCOME_KEY,
  type PeopleNumbers,
  type Segment,
  type SegmentFilters,
} from "@/lib/people/people";
import type { MarketingTerm } from "@/lib/people/read";

type Factor = "ok" | "challenge" | "missing";

const ERROR_KEY: Record<string, string> = {
  not_allowed: "segments-error-not-allowed",
  support_visit: "segments-error-support",
  second_factor: "segments-error-second-factor",
  term_missing: "segments-error-term",
  term_changed: "segments-error-term-changed",
  too_many: "segments-error-too-many",
  invalid_data: "segments-error-invalid",
};
const errorKey = (code: string) => ERROR_KEY[code] ?? "segments-error-failed";

/**
 * The marketing segments (migration 0134): the firm's own lists for its own marketing tools, at its own risk. Until a
 * partner accepted the term with the second factor, the card says so and makes no segment; then who decides for the
 * firm or the controladoria makes, changes, archives and exports them. ONE sends no campaign, and a segment never holds
 * a minor nor who asked for no marketing.
 */
export default function SegmentsCard({
  segments,
  term,
  factor,
  numbers,
}: {
  segments: Segment[] | null;
  term: MarketingTerm | null;
  factor: Factor;
  numbers: PeopleNumbers;
}) {
  const t = useTranslations("product");
  const router = useRouter();
  const [accepting, setAccepting] = useState(false);
  const [editing, setEditing] = useState<Segment | "new" | null>(null);
  const [exporting, setExporting] = useState<Segment | null>(null);
  const [archiving, setArchiving] = useState<Segment | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  if (!term) return null;
  const manages = term.manages;
  const active = (segments ?? []).filter((segment) => !segment.archivedAt);
  const archived = (segments ?? []).filter((segment) => segment.archivedAt);

  return (
    <Card component="section" id="segmentos" aria-labelledby="people-segments">
      <CardContent className="flex flex-col gap-4">
        <CardTitle
          id="people-segments"
          icon={<NiFilter size="medium" />}
          tone="accent-4"
          title={t("segments-title")}
          description={t("segments-description")}
          chip={
            term.accepted ? (
              <StatusChip tone="positive" label={t("segments-term-accepted")} />
            ) : (
              <StatusChip tone="attention" label={t("segments-term-missing")} />
            )
          }
          actions={
            term.accepted && manages && active.length + archived.length > 0 ? (
              <Button size="small" variant="outlined" color="grey" onClick={() => setEditing("new")}>
                {t("segments-new")}
              </Button>
            ) : undefined
          }
        />
        {problem ? (
          <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
            {problem}
          </Alert>
        ) : null}
        {!term.accepted ? (
          <StateLine
            tone="attention"
            action={
              term.decides ? (
                <Button size="small" variant="contained" onClick={() => setAccepting(true)}>
                  {t("segments-term-read")}
                </Button>
              ) : undefined
            }
          >
            {t(term.decides ? "segments-term-needed-decider" : "segments-term-needed")}
          </StateLine>
        ) : !manages ? (
          <Typography variant="body2" className="text-text-secondary">
            {t("segments-read-only")}
          </Typography>
        ) : active.length === 0 && archived.length === 0 ? (
          <EmptyState
            illustration={<IllustrationEmail />}
            title={t("segments-empty-title")}
            description={t("segments-empty-body")}
            action={{ label: t("segments-new"), onClick: () => setEditing("new") }}
            framed={false}
            layout="row"
            titleAs="h3"
          />
        ) : (
          <Box component="ul" className="m-0 flex list-none flex-col p-0">
            {[...active, ...archived].map((segment) => (
              <Box
                component="li"
                key={segment.id}
                className="border-grey-100 flex items-start justify-between gap-3 border-b py-3 last:border-b-0"
              >
                <Box className="flex min-w-0 flex-col gap-0.5">
                  <Typography variant="body1" className="font-semibold">
                    {segment.name}
                  </Typography>
                  <Typography variant="body2" className="text-text-secondary">
                    {t("segments-line", { count: segment.count, filters: filterCount(segment.filters) })}
                  </Typography>
                  {segment.archivedAt ? (
                    <StateLine tone="info">{t("segments-archived", { reason: segment.archiveReason ?? "" })}</StateLine>
                  ) : null}
                </Box>
                <QuickActions
                  label={t("segments-actions", { name: segment.name })}
                  actions={
                    segment.archivedAt
                      ? [
                          {
                            key: "restore",
                            label: t("segments-restore"),
                            onClick: () =>
                              void archiveSegment(segment.id, null).then((result) =>
                                result.ok ? router.refresh() : setProblem(t(errorKey(result.code))),
                              ),
                          },
                        ]
                      : [
                          { key: "export", label: t("segments-export"), onClick: () => setExporting(segment) },
                          { key: "edit", label: t("segments-edit"), onClick: () => setEditing(segment) },
                          { key: "archive", label: t("segments-archive"), onClick: () => setArchiving(segment) },
                        ]
                  }
                />
              </Box>
            ))}
          </Box>
        )}
      </CardContent>

      {accepting ? (
        <TermPanel term={term} factor={factor} onClose={() => setAccepting(false)} onDone={() => router.refresh()} />
      ) : null}
      {editing ? (
        <SegmentPanel
          segment={editing === "new" ? null : editing}
          numbers={numbers}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            router.refresh();
          }}
        />
      ) : null}
      {exporting ? <ExportPanel segment={exporting} factor={factor} onClose={() => setExporting(null)} /> : null}
      {archiving ? (
        <ConfirmActionDialog
          title={t("segments-archive-title")}
          intro={archiving.name}
          consequences={[t("segments-archive-consequence")]}
          staysTitle={t("segments-archive-stays-title")}
          stays={[t("segments-archive-stays")]}
          reasonLabel={t("segments-archive-reason")}
          reasonMinLength={3}
          requireReason
          confirmLabel={t("segments-archive")}
          cancelLabel={t("segments-cancel")}
          onClose={() => setArchiving(null)}
          onConfirm={async (reason) => {
            const result = await archiveSegment(archiving.id, reason);
            if (!result.ok) return t(errorKey(result.code));
            setArchiving(null);
            router.refresh();
            return null;
          }}
        />
      ) : null}
    </Card>
  );
}

/** The firm's term, read whole and accepted by a partner with the second factor. */
function TermPanel({
  term,
  factor,
  onClose,
  onDone,
}: {
  term: MarketingTerm;
  factor: Factor;
  onClose: () => void;
  onDone: () => void;
}) {
  const t = useTranslations("product");
  const [confirmed, setConfirmed] = useState(factor === "ok");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const accept = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await acceptMarketingTerm(term.version);
      if (result.ok) {
        onClose();
        onDone();
      } else setProblem(t(errorKey(result.code)));
    } catch {
      setProblem(t("segments-error-failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <SidePanel
      onClose={onClose}
      closeLabel={t("segments-cancel")}
      icon={<NiFilter size="medium" />}
      tone="accent-4"
      busy={busy}
      title={t("segments-term-title")}
      description={t("segments-term-body")}
      onSubmit={() => void accept()}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy || !confirmed}>
            {t("segments-term-accept")}
          </Button>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("segments-cancel")}
          </Button>
        </>
      }
    >
      <Box className="flex flex-col gap-4">
        {problem ? (
          <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
            {problem}
          </Alert>
        ) : null}
        <Box className="bg-grey-50 rounded-lg p-4">
          <Typography variant="body2" className="whitespace-pre-line">
            {term.text}
          </Typography>
        </Box>
        {!confirmed ? (
          <SecondFactorPrompt
            state={factor === "missing" ? "missing" : "challenge"}
            onConfirmed={() => setConfirmed(true)}
          />
        ) : null}
      </Box>
    </SidePanel>
  );
}

const UFS = [
  "AC",
  "AL",
  "AP",
  "AM",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MT",
  "MS",
  "MG",
  "PA",
  "PB",
  "PR",
  "PE",
  "PI",
  "RJ",
  "RN",
  "RS",
  "RO",
  "RR",
  "SC",
  "SP",
  "SE",
  "TO",
];

/** A segment's name and filters, with how many people they hold now. */
function SegmentPanel({
  segment,
  numbers,
  onClose,
  onSaved,
}: {
  segment: Segment | null;
  numbers: PeopleNumbers;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const kinds = firmCaseKinds(useViewer()?.modules).map((kind) => kind.key);
  const [name, setName] = useState(segment?.name ?? "");
  const [filters, setFilters] = useState<SegmentFilters>(segment?.filters ?? {});
  const [count, setCount] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const asked = useRef(0);

  useEffect(() => {
    const turn = ++asked.current;
    const timer = window.setTimeout(async () => {
      try {
        const result = await countSegment(filters);
        if (turn === asked.current) setCount(result.ok ? result.count : null);
      } catch {
        if (turn === asked.current) setCount(null);
      }
    }, 400);
    return () => window.clearTimeout(timer);
  }, [filters]);

  const toggle = (key: "origins" | "incidents" | "outcomes", value: string) =>
    setFilters((current) => {
      const list = current[key] ?? [];
      const next = list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
      return { ...current, [key]: next.length > 0 ? next : undefined };
    });
  const setList = (key: "airlines" | "cities" | "ufs" | "professions", value: string[]) =>
    setFilters((current) => ({ ...current, [key]: value.length > 0 ? value : undefined }));
  const setAge = (key: "age_min" | "age_max", value: string) =>
    setFilters((current) => {
      const number = Number.parseInt(value, 10);
      return { ...current, [key]: Number.isInteger(number) && number >= 18 && number <= 120 ? number : undefined };
    });

  const save = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await saveSegment(segment?.id ?? null, name, filters);
      if (result.ok) onSaved();
      else setProblem(t(errorKey(result.code)));
    } catch {
      setProblem(t("segments-error-failed"));
    } finally {
      setBusy(false);
    }
  };

  const checks = (key: "origins" | "incidents" | "outcomes", options: { value: string; label: string }[]) => (
    <FormGroup row>
      {options.map((option) => (
        <FormControlLabel
          key={option.value}
          control={
            <Checkbox
              size="small"
              checked={(filters[key] ?? []).includes(option.value)}
              onChange={() => toggle(key, option.value)}
            />
          }
          label={option.label}
        />
      ))}
    </FormGroup>
  );
  const many = (key: "airlines" | "cities" | "ufs" | "professions", label: string, options: string[]) => (
    <Autocomplete
      multiple
      freeSolo
      options={options}
      value={filters[key] ?? []}
      onChange={(_event, value) => setList(key, value.map((item) => String(item).trim()).filter(Boolean))}
      renderInput={(params) => <TextField {...params} label={label} />}
    />
  );

  return (
    <SidePanel
      onClose={onClose}
      closeLabel={t("segments-cancel")}
      icon={<NiFilter size="medium" />}
      tone="accent-4"
      busy={busy}
      title={t(segment ? "segments-edit-title" : "segments-new-title")}
      description={t("segments-panel-body")}
      onSubmit={() => void save()}
      note={count === null ? undefined : t("segments-count", { count })}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy || name.trim().length < 3}>
            {t("segments-save")}
          </Button>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("segments-cancel")}
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
        <TextField
          label={t("segments-field-name")}
          value={name}
          onChange={(event) => setName(event.target.value.slice(0, 80))}
        />
        <Box className="flex flex-col gap-1">
          <Typography variant="subtitle2">{t("segments-field-origin")}</Typography>
          {checks(
            "origins",
            ORIGINS.map((origin) => ({ value: origin, label: t(ORIGIN_KEY[origin] ?? "people-origin-other") })),
          )}
        </Box>
        <Box className="grid gap-4 sm:grid-cols-2">
          <TextField
            type="number"
            label={t("segments-field-age-min")}
            value={filters.age_min ?? ""}
            onChange={(event) => setAge("age_min", event.target.value)}
            slotProps={{ htmlInput: { min: 18, max: 120 } }}
          />
          <TextField
            type="number"
            label={t("segments-field-age-max")}
            value={filters.age_max ?? ""}
            onChange={(event) => setAge("age_max", event.target.value)}
            slotProps={{ htmlInput: { min: 18, max: 120 } }}
          />
        </Box>
        <Box className="flex flex-col gap-1">
          <Typography variant="subtitle2">{t("segments-field-incident")}</Typography>
          {checks(
            "incidents",
            kinds.map((kind) => ({ value: kind, label: t(caseKindLabelKey(kind) ?? "case-incident-other") })),
          )}
        </Box>
        <Box className="flex flex-col gap-1">
          <Typography variant="subtitle2">{t("segments-field-outcome")}</Typography>
          {checks(
            "outcomes",
            Object.keys(OUTCOME_KEY).map((outcome) => ({ value: outcome, label: t(OUTCOME_KEY[outcome]!) })),
          )}
        </Box>
        <TextField
          select
          label={t("segments-field-active")}
          value={filters.active === undefined ? "" : String(filters.active)}
          onChange={(event) =>
            setFilters((current) => ({
              ...current,
              active: event.target.value === "" ? undefined : event.target.value === "true",
            }))
          }
        >
          <MenuItem value="">{t("segments-active-any")}</MenuItem>
          <MenuItem value="true">{t("segments-active-yes")}</MenuItem>
          <MenuItem value="false">{t("segments-active-no")}</MenuItem>
        </TextField>
        {many(
          "airlines",
          t("segments-field-airline"),
          numbers.airlines.map((tally) => tally.key),
        )}
        {many(
          "cities",
          t("segments-field-city"),
          numbers.cities.map((tally) => tally.key.split("/")[0] ?? tally.key),
        )}
        {many("ufs", t("segments-field-uf"), UFS)}
        {many(
          "professions",
          t("segments-field-profession"),
          numbers.professions.map((tally) => tally.key),
        )}
        <StateLine tone="info">{t("segments-always-out")}</StateLine>
      </Box>
    </SidePanel>
  );
}

/** A segment to a spreadsheet, with the columns chosen and the second factor, on the record. */
function ExportPanel({ segment, factor, onClose }: { segment: Segment; factor: Factor; onClose: () => void }) {
  const t = useTranslations("product");
  const [columns, setColumns] = useState<ExportColumn[]>(DEFAULT_COLUMNS);
  const [confirmed, setConfirmed] = useState(factor === "ok");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);

  const run = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await exportSegment(segment.id, columns);
      if (!result.ok) return setProblem(t(errorKey(result.code)));
      const bytes = writeXlsx({
        sheet: segment.name,
        columns: result.columns.map((column) => ({ title: t(EXPORT_COLUMN_KEY[column]) })),
        rows: exportLines(result.rows, result.columns),
      });
      saveFile(bytes, savedFileName(segment.name, "xlsx", t("segments-title")), XLSX_TYPE);
      setDone(result.rows.length);
    } catch {
      setProblem(t("segments-error-failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SidePanel
      onClose={onClose}
      closeLabel={t("segments-cancel")}
      icon={<NiFilter size="medium" />}
      tone="accent-4"
      busy={busy}
      title={t("segments-export-title", { name: segment.name })}
      description={t("segments-export-body")}
      onSubmit={() => void run()}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy || !confirmed || columns.length === 0}>
            {t("segments-export-download")}
          </Button>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("segments-cancel")}
          </Button>
        </>
      }
    >
      <Box className="flex flex-col gap-4">
        {problem ? (
          <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
            {problem}
          </Alert>
        ) : null}
        {done !== null ? <StateLine tone="done">{t("segments-export-done", { count: done })}</StateLine> : null}
        <FormGroup>
          {EXPORT_COLUMNS.map((column) => (
            <FormControlLabel
              key={column}
              control={
                <Checkbox
                  size="small"
                  checked={columns.includes(column)}
                  onChange={() =>
                    setColumns((current) =>
                      current.includes(column)
                        ? current.filter((item) => item !== column)
                        : EXPORT_COLUMNS.filter((item) => item === column || current.includes(item)),
                    )
                  }
                />
              }
              label={t(EXPORT_COLUMN_KEY[column])}
            />
          ))}
        </FormGroup>
        <StateLine tone="info">{t("segments-export-record")}</StateLine>
        {!confirmed ? (
          <SecondFactorPrompt
            state={factor === "missing" ? "missing" : "challenge"}
            onConfirmed={() => setConfirmed(true)}
          />
        ) : null}
      </Box>
    </SidePanel>
  );
}
