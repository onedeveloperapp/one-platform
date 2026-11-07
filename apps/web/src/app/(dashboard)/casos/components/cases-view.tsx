"use client";

import { type CasesState, GROUP_TONE } from "../cases-types";
import NewCaseDialog from "./new-case-dialog";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert, Box, Button, Grid, MenuItem, TextField, Typography } from "@mui/material";
import type { GridColDef, GridRenderCellParams } from "@mui/x-data-grid";

import DataTable from "@/components/data-grid/data-table";
import EmptyState from "@/components/product/empty-state";
import ListBar, { type ListChip, type ListView } from "@/components/product/list-bar";
import ModuleIcon from "@/components/product/module-icon";
import ModuleScope from "@/components/product/module-scope";
import NumberCard from "@/components/product/number-card";
import PageHeader from "@/components/product/page-header";
import { ProgressBar } from "@/components/product/progress-steps";
import StatusChip from "@/components/product/status-chip";
import type { TileTone } from "@/components/product/tile-tone";
import NiArchive from "@/icons/nexture/ni-archive";
import NiArrowInUp from "@/icons/nexture/ni-arrow-in-up";
import NiBuilding from "@/icons/nexture/ni-building";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiFlag from "@/icons/nexture/ni-flag";
import NiFolder from "@/icons/nexture/ni-folder";
import NiFolderCheck from "@/icons/nexture/ni-folder-check";
import NiFolderPlus from "@/icons/nexture/ni-folder-plus";
import NiMicrophone from "@/icons/nexture/ni-microphone";
import NiPaperclip from "@/icons/nexture/ni-paperclip";
import NiPen from "@/icons/nexture/ni-pen";
import NiScale from "@/icons/nexture/ni-scale";
import NiTimeline from "@/icons/nexture/ni-timeline";
import NiUsers from "@/icons/nexture/ni-users";
import { caseLabel, groupOf, STATUS_KEY } from "@/lib/cases/cases";
import { JOURNEY_STEP_KEY, JOURNEY_STEPS, stepOf } from "@/lib/cases/journey";
import {
  CASE_SORTS,
  type CaseFilter,
  type CaseListPage,
  type CaseListQuery,
  type CaseListRow,
  type CaseSort,
  DEFAULT_PAGE_SIZE,
  isCaseSort,
  lastPage,
  PAGE_SIZES,
} from "@/lib/cases/list";
import { listFirmCases } from "@/lib/cases/list-actions";
import { type CaseCardKey, caseCards, spanText } from "@/lib/cases/numbers";
import { caseKindLabelKey, caseKindsOf, firmCaseKinds } from "@/lib/modules/registry";
import { countText, deltaText, isHoped } from "@/lib/numbers/compare";
import { formatDayBr } from "@flyee/rules/person";

const FILTER_TILE: Record<CaseFilter, { label: string; hint: string; tone: TileTone; icon: React.ReactNode }> = {
  open: {
    label: "cases-filter-open",
    hint: "cases-filter-open-hint",
    tone: "accent-3",
    icon: <NiUsers size="large" />,
  },
  preparing: {
    label: "cases-filter-preparing",
    hint: "cases-filter-preparing-hint",
    tone: "primary",
    icon: <NiPen size="large" />,
  },
  filed: {
    label: "cases-filter-filed",
    hint: "cases-filter-filed-hint",
    tone: "accent-4",
    icon: <NiScale size="large" />,
  },
  ended: {
    label: "cases-filter-ended",
    hint: "cases-filter-ended-hint",
    tone: "secondary",
    icon: <NiArchive size="large" />,
  },
  documentos: {
    label: "cases-filter-documents",
    hint: "cases-filter-documents-hint",
    tone: "secondary",
    icon: <NiPaperclip size="large" />,
  },
  "cliente-terminou": {
    label: "cases-filter-client-finished",
    hint: "cases-filter-client-finished-hint",
    tone: "primary",
    icon: <NiFolderCheck size="large" />,
  },
  cronologia: {
    label: "cases-filter-chronology",
    hint: "cases-filter-chronology-hint",
    tone: "accent-3",
    icon: <NiMicrophone size="large" />,
  },
  reclamacao: {
    label: "cases-filter-complaint",
    hint: "cases-filter-complaint-hint",
    tone: "accent-4",
    icon: <NiFlag size="large" />,
  },
  pecas: {
    label: "cases-filter-pieces",
    hint: "cases-filter-pieces-hint",
    tone: "primary",
    icon: <NiDocumentFull size="large" />,
  },
  andamento: {
    label: "cases-filter-moved",
    hint: "cases-filter-moved-hint",
    tone: "secondary",
    icon: <NiTimeline size="large" />,
  },
  "vara-civel": {
    label: "cases-filter-civil",
    hint: "cases-filter-civil-hint",
    tone: "accent-4",
    icon: <NiScale size="large" />,
  },
  agencia: {
    label: "cases-filter-agency",
    hint: "cases-filter-agency-hint",
    tone: "accent-1",
    icon: <NiBuilding size="large" />,
  },
  "novos-mes": {
    label: "cases-filter-new-month",
    hint: "cases-filter-new-month-hint",
    tone: "accent-1",
    icon: <NiFolderPlus size="large" />,
  },
  "ajuizados-mes": {
    label: "cases-filter-filed-month",
    hint: "cases-filter-filed-month-hint",
    tone: "accent-4",
    icon: <NiScale size="large" />,
  },
  "encerrados-mes": {
    label: "cases-filter-ended-month",
    hint: "cases-filter-ended-month-hint",
    tone: "secondary",
    icon: <NiArchive size="large" />,
  },
};

/**
 * The ready views of the list, by group (the screen pattern of phase 0): the cases still going, what happened in the
 * month, each stage, and what waits for the firm, the last ones listed only while something of theirs waits.
 */
const MONTH_VIEWS: readonly CaseFilter[] = ["novos-mes", "ajuizados-mes", "encerrados-mes"];
const STAGE_VIEWS: readonly CaseFilter[] = ["open", "preparing", "filed", "ended"];
const STANDING_WAITS: readonly CaseFilter[] = ["documentos", "cliente-terminou"];
const EXCEPTION_WAITS: readonly CaseFilter[] = [
  "cronologia",
  "reclamacao",
  "pecas",
  "andamento",
  "vara-civel",
  "agencia",
];
/** The view of the cases still going, the list's own (no filter). */
const GOING = "going";

/** The cards above the list: what each counts, with its icon and tint. */
const CARD: Record<CaseCardKey, { label: string; hint: string; tone: TileTone; icon: React.ReactNode }> = {
  going: {
    label: "cases-number-going",
    hint: "cases-number-going-hint",
    tone: "primary",
    icon: <NiFolder size="medium" />,
  },
  opened: {
    label: "cases-number-opened",
    hint: "cases-number-opened-hint",
    tone: "accent-1",
    icon: <NiFolderPlus size="medium" />,
  },
  filed: {
    label: "cases-number-filed",
    hint: "cases-number-filed-hint",
    tone: "accent-4",
    icon: <NiScale size="medium" />,
  },
  ended: {
    label: "cases-number-ended",
    hint: "cases-number-ended-hint",
    tone: "secondary",
    icon: <NiArchive size="medium" />,
  },
};

/** The words of each order of the list. */
const SORT_KEY: Record<CaseSort, string> = {
  recent: "cases-sort-recent",
  oldest: "cases-sort-oldest",
  newest: "cases-sort-newest",
  first: "cases-sort-first",
};

type Ready = Extract<CasesState, { kind: "ready" }>;

/**
 * The firm's cases. Somebody comes here to find a case and open it, to see
 * where the cases stand (with the client, in preparation, in court) and to
 * open a new one or bring a portfolio. The tiles filter by what waits on
 * whom; without a filter the list shows every case still going; the search
 * finds a client or a lawsuit among all of them. It is the one screen of the
 * firm that is really a list of many rows, so it is the app's table, read a
 * page at a time: the database counts, filters and searches (`firm_cases`),
 * so the numbers are right for a firm of any size.
 */
export default function CasesView({ state, embedded = false }: { state: CasesState; embedded?: boolean }) {
  const t = useTranslations("product");
  const router = useRouter();

  // Arriving by another address (`?ver=`, from a count of the home) starts the list again under its filter.
  if (state.kind === "ready")
    return (
      <CasesList
        key={`${state.scope?.module.key ?? "all"}:${state.filter ?? "going"}`}
        ready={state}
        embedded={embedded}
      />
    );
  return (
    <Box className="flex flex-col gap-6">
      {embedded ? null : (
        <PageHeader
          title={t("cases-title")}
          crumbs={[{ label: t("cases-home"), href: "/inicio" }, { label: t("cases-title") }]}
          description={t("cases-description")}
        />
      )}
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
          {t("cases-load-error")}
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
    </Box>
  );
}

/**
 * The list itself. In a module's area (`embedded`) it is the area's list of its lawsuits, under the area's own
 * title; on `/casos` it is the page, with the choice of every module or one above it. Under a module it offers
 * what only that module has (its partner's filter, its portfolio from a spreadsheet, its kinds of problem); for
 * every module of a firm that has more than one, each row names its module.
 */
function CasesList({ ready, embedded }: { ready: Ready; embedded: boolean }) {
  const t = useTranslations("product");
  const router = useRouter();
  const scope = ready.scope;
  const [creating, setCreating] = useState(Boolean(ready.prefill));
  const [list, setList] = useState<CaseListPage>(ready.list);
  const [query, setQuery] = useState<CaseListQuery>({
    filter: ready.filter,
    search: "",
    module: scope?.module.key ?? null,
    page: 0,
    pageSize: DEFAULT_PAGE_SIZE,
    sort: "recent",
    incident: null,
    airline: null,
  });
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  /** What was asked last: an answer to an older question is not the list's. */
  const asked = useRef(0);
  const current = useRef(query);

  const load = useCallback(async (next: CaseListQuery) => {
    const turn = (asked.current += 1);
    current.current = next;
    setQuery(next);
    setLoading(true);
    setFailed(false);
    let answer: Awaited<ReturnType<typeof listFirmCases>>;
    try {
      answer = await listFirmCases(next);
    } catch {
      answer = { ok: false };
    }
    if (turn !== asked.current) return;
    if (!answer.ok) {
      setLoading(false);
      setFailed(true);
      return;
    }
    // The page asked for is past the end (the list got shorter meanwhile): its last page is read instead. A page
    // within the list is shown as it came, even with nothing this screen can show in it.
    const last = lastPage(answer.page.total, next.pageSize);
    if (answer.page.rows.length === 0 && next.page > last) {
      void load({ ...next, page: last });
      return;
    }
    setLoading(false);
    setList(answer.page);
  }, []);

  // The server read the list again (somebody asked the page to refresh): what the person is looking at is
  // read again too, under the filter, the search and the page they are on.
  const firstList = useRef(ready.list);
  useEffect(() => {
    if (firstList.current === ready.list) return;
    firstList.current = ready.list;
    void load(current.current);
  }, [ready.list, load]);

  const airlineName = useMemo(
    () => new Map(ready.airlines.map((airline) => [airline.iata, airline.name])),
    [ready.airlines],
  );
  const moduleOfRow = useMemo(() => new Map(ready.modules.map((module) => [module.key, module])), [ready.modules]);
  // Every module of a firm that has more than one: each row says which.
  const namesModule = !scope && ready.modules.length > 1;

  const columns = useMemo<GridColDef<CaseListRow>[]>(
    () => [
      {
        field: "seq",
        headerName: t("cases-column-case"),
        minWidth: 90,
        flex: 0.4,
        renderCell: (params: GridRenderCellParams<CaseListRow, number>) => (
          <Box className="flex h-full items-center">
            <Typography variant="body1" className="font-semibold">
              {caseLabel(params.row.seq)}
            </Typography>
          </Box>
        ),
      },
      {
        field: "client",
        headerName: t("cases-column-client"),
        minWidth: 200,
        flex: 1.4,
        renderCell: (params: GridRenderCellParams<CaseListRow, string>) => (
          <Box className="flex h-full min-w-0 flex-col justify-center">
            <Typography variant="body1" className="truncate font-medium">
              {params.row.client || t("cases-no-client")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary truncate">
              {params.row.incident === null
                ? (moduleOfRow.get(params.row.module)?.name ?? "")
                : params.row.agency
                  ? t("cases-from-agency", {
                      kind: t(caseKindLabelKey(params.row.incident) ?? "case-incident-other"),
                      agency: params.row.agency,
                    })
                  : t(caseKindLabelKey(params.row.incident) ?? "case-incident-other")}
            </Typography>
          </Box>
        ),
      },
      ...(namesModule
        ? [
            {
              field: "module",
              headerName: t("cases-column-module"),
              minWidth: 170,
              flex: 0.9,
              renderCell: (params: GridRenderCellParams<CaseListRow, string>) => {
                const module = moduleOfRow.get(params.row.module);
                return (
                  <Box className="flex h-full min-w-0 items-center gap-2">
                    <ModuleIcon name={module?.icon} size="small" className="text-text-secondary flex-none" />
                    <Typography variant="body2" className="truncate">
                      {module?.name ?? ""}
                    </Typography>
                  </Box>
                );
              },
            } satisfies GridColDef<CaseListRow>,
          ]
        : []),
      {
        field: "airline",
        headerName: t("cases-column-flight"),
        minWidth: 160,
        flex: 1,
        renderCell: (params: GridRenderCellParams<CaseListRow, string | null>) => (
          <Box className="flex h-full min-w-0 flex-col justify-center">
            <Typography variant="body2" className="truncate">
              {params.row.airline ? (airlineName.get(params.row.airline) ?? params.row.airline) : t("cases-no-airline")}
            </Typography>
            {params.row.flightDate && (
              <Typography variant="body2" className="text-text-secondary">
                {formatDayBr(params.row.flightDate)}
              </Typography>
            )}
          </Box>
        ),
      },
      {
        field: "status",
        headerName: t("cases-column-status"),
        minWidth: 170,
        flex: 0.9,
        renderCell: (params: GridRenderCellParams<CaseListRow, CaseListRow["status"]>) => {
          // Where the case is along its way, in small under its stage (the case's own screen shows it whole): in
          // court, the step its lawsuits show.
          const status = params.row.status;
          const step = stepOf(status, params.row.court ?? { held: false, decided: false, paid: false });
          const at = step ? JOURNEY_STEPS.indexOf(step) : -1;
          return (
            <Box className="flex h-full flex-col items-start justify-center gap-1.5">
              <StatusChip tone={GROUP_TONE[groupOf(status)]} label={t(STATUS_KEY[status])} />
              {step && at >= 0 ? (
                <ProgressBar
                  steps={JOURNEY_STEPS.length}
                  reached={at}
                  state={status === "closed" ? "done" : "progress"}
                  label={t("journey-bar-label", {
                    label: t(JOURNEY_STEP_KEY[step]),
                    position: at + 1,
                    total: JOURNEY_STEPS.length,
                  })}
                />
              ) : null}
            </Box>
          );
        },
      },
      {
        field: "toReview",
        headerName: t("cases-column-waiting"),
        minWidth: 180,
        flex: 1,
        renderCell: (params: GridRenderCellParams<CaseListRow, number>) => (
          <Box className="flex h-full flex-col justify-center">
            {params.row.toReview > 0 && (
              <Typography variant="body2">{t("cases-waiting-documents", { count: params.row.toReview })}</Typography>
            )}
            {params.row.clientFinished && <Typography variant="body2">{t("cases-waiting-client-finished")}</Typography>}
            {params.row.chronologyContested && <Typography variant="body2">{t("cases-waiting-chronology")}</Typography>}
            {params.row.complaintOverdue && <Typography variant="body2">{t("cases-waiting-complaint")}</Typography>}
            {params.row.pieceWaiting && <Typography variant="body2">{t("cases-waiting-piece")}</Typography>}
            {params.row.courtMoved && <Typography variant="body2">{t("cases-waiting-moved")}</Typography>}
            {params.row.civilRefused && <Typography variant="body2">{t("cases-waiting-civil")}</Typography>}
          </Box>
        ),
      },
    ],
    [t, airlineName, moduleOfRow, namesModule],
  );

  const { filter } = query;
  const searching = query.search !== "";
  const setFilter = (next: CaseFilter | null) => void load({ ...current.current, filter: next, page: 0 });

  // A firm that arrives with lawsuits already in court brings them from a spreadsheet, never one by one: a module's
  // portfolio, so offered under the module whose lawsuits the spreadsheet holds.
  const mayImport = ready.canImport && !ready.supportVisit && Boolean(scope?.importable);
  const hasCases = list.counts.all > 0;

  // The views, by group; a wait of the firm is listed while something of it waits (or it is the view in force), and
  // the cases a partner sent only under the module that has partners.
  const viewOf = (key: CaseFilter, group: string): ListView => ({
    key,
    label: t(FILTER_TILE[key].label),
    count: countText(list.counts[key]),
    group,
  });
  const views: ListView[] = [
    { key: GOING, label: t("cases-view-going"), count: countText(list.counts.going), group: "going" },
    ...MONTH_VIEWS.map((key) => viewOf(key, "month")),
    ...STAGE_VIEWS.map((key) => viewOf(key, "stage")),
    ...STANDING_WAITS.map((key) => viewOf(key, "waits")),
    ...EXCEPTION_WAITS.filter(
      (key) => (key !== "agencia" || scope?.partner) && (list.counts[key] > 0 || filter === key),
    ).map((key) => viewOf(key, "waits")),
  ];

  // What the list's own filters offer: the kinds of problem of the module (or of the firm's modules) and the airlines.
  const kinds = scope ? caseKindsOf(scope.module.key) : firmCaseKinds(ready.modules.map((module) => module.key));
  const kindName = (key: string) => t(caseKindLabelKey(key) ?? "case-incident-other");
  const chips: ListChip[] = [
    ...(query.incident
      ? [
          {
            key: "incident",
            label: kindName(query.incident),
            onRemove: () => void load({ ...current.current, incident: null, page: 0 }),
          },
        ]
      : []),
    ...(query.airline
      ? [
          {
            key: "airline",
            label: airlineName.get(query.airline) ?? query.airline,
            onRemove: () => void load({ ...current.current, airline: null, page: 0 }),
          },
        ]
      : []),
  ];

  const numbers = list.numbers;
  const cards = numbers ? caseCards(numbers) : [];

  // Why the table is empty says what to do next: another search, another view, or the cases that ended.
  const nothing = searching ? (
    <EmptyState
      icon={<NiFolder size="large" />}
      title={t("cases-search-empty-title")}
      description={t(filter ? "cases-search-empty-filter-body" : "cases-search-empty-body")}
      action={filter ? { label: t("cases-search-everywhere"), onClick: () => setFilter(null) } : undefined}
    />
  ) : filter || query.incident || query.airline ? (
    <EmptyState
      icon={<NiFolder size="large" />}
      title={t("cases-filter-empty-title")}
      description={t("cases-filter-empty-body")}
      action={{
        label: t("cases-filter-clear"),
        onClick: () => void load({ ...current.current, filter: null, incident: null, airline: null, page: 0 }),
      }}
    />
  ) : (
    <EmptyState
      icon={<NiArchive size="large" />}
      title={t("cases-none-going-title")}
      description={t("cases-none-going-body")}
      action={{ label: t("cases-see-ended"), onClick: () => setFilter("ended") }}
    />
  );

  return (
    <Box className="flex flex-col gap-6">
      {embedded ? (
        <Box className="flex flex-wrap items-end justify-between gap-3">
          <Box className="flex flex-col gap-1">
            <Typography id="module-cases" variant="h5" component="h2" className="mb-0">
              {t("module-area-cases-title")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {t("module-area-cases-body", { module: scope?.module.name ?? "" })}
            </Typography>
          </Box>
        </Box>
      ) : (
        <>
          <PageHeader
            title={t("cases-title")}
            crumbs={
              scope
                ? [
                    { label: t("cases-home"), href: "/inicio" },
                    { label: scope.module.name, href: `/modulos/${scope.module.key}` },
                    { label: t("cases-title") },
                  ]
                : [{ label: t("cases-home"), href: "/inicio" }, { label: t("cases-title") }]
            }
            description={scope ? t("cases-description-module", { module: scope.module.name }) : t("cases-description")}
          />
          <ModuleScope path="/casos" modules={ready.modules} current={scope?.module.key ?? null} />
        </>
      )}

      {ready.supportVisit && (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("cases-support-visit")}
        </Alert>
      )}

      {/*
        No case yet is ONE's wait, never the firm's task: a module brings the case and ONE opens it and carries it
        (the owner, 2026-11-03). What the firm may do meanwhile is bring the lawsuits it already has, or see what ONE
        does by itself; opening a case by hand stays, as the exception it is.
      */}
      {!hasCases && (
        <EmptyState
          icon={<NiFolder size="large" />}
          title={t("cases-empty-title")}
          description={t("cases-empty-body")}
          action={
            mayImport
              ? { label: t("cases-empty-import"), href: "/casos/importar" }
              : { label: t("cases-empty-what-one-does"), href: "/settings/autonomia" }
          }
          secondaryAction={
            ready.supportVisit ? undefined : { label: t("cases-empty-by-hand"), onClick: () => setCreating(true) }
          }
        />
      )}

      {hasCases && (
        <>
          {/* The numbers of the list, each beside the same days of the month before, each opening the list it counts. */}
          {numbers && (
            <Grid container spacing={2.5}>
              {cards.map((card) => (
                <Grid key={card.key} size={{ xs: 6, lg: 3 }}>
                  <NumberCard
                    icon={CARD[card.key].icon}
                    tone={CARD[card.key].tone}
                    label={t(CARD[card.key].label)}
                    hint={t(CARD[card.key].hint)}
                    value={countText(card.value)}
                    comparison={{
                      delta: deltaText(card.compared),
                      same: t("cases-number-same"),
                      hoped: isHoped(card.compared, card.hope),
                      text: t("cases-number-vs", { span: spanText(numbers, card.span), value: countText(card.before) }),
                    }}
                    onClick={() => setFilter(card.view)}
                    pressed={!searching && filter === card.view}
                  />
                </Grid>
              ))}
            </Grid>
          )}

          {failed && (
            <Alert
              severity="error"
              className="neutral bg-background-paper/60!"
              action={
                <Button color="inherit" size="small" onClick={() => void load(current.current)}>
                  {t("cases-retry")}
                </Button>
              }
            >
              {t("cases-load-error")}
            </Alert>
          )}

          <Box className="flex flex-col gap-2">
            <ListBar
              label={t("cases-bar-label")}
              viewsTitle={t("cases-views-title")}
              views={views}
              view={filter ?? GOING}
              onView={(key) => setFilter(key === GOING ? null : (key as CaseFilter))}
              search={{
                label: t("cases-search-label"),
                placeholder: t("cases-bar-search"),
                value: query.search,
                onChange: (text) => {
                  if (text === current.current.search) return;
                  void load({ ...current.current, search: text, page: 0 });
                },
              }}
              filter={{
                label: t("cases-bar-filter"),
                active: (query.incident ? 1 : 0) + (query.airline ? 1 : 0),
                clearLabel: t("cases-bar-filter-clear"),
                onClear: () => void load({ ...current.current, incident: null, airline: null, page: 0 }),
                content: (
                  <>
                    <TextField
                      select
                      fullWidth
                      size="small"
                      id="cases-filter-kind"
                      label={t("cases-bar-filter-kind")}
                      value={query.incident ?? ""}
                      onChange={(event) =>
                        void load({ ...current.current, incident: event.target.value || null, page: 0 })
                      }
                      slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
                    >
                      <MenuItem value="">{t("cases-bar-filter-any-kind")}</MenuItem>
                      {kinds.map((kind) => (
                        <MenuItem key={kind.key} value={kind.key}>
                          {t(kind.labelKey)}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      select
                      fullWidth
                      size="small"
                      id="cases-filter-airline"
                      label={t("cases-bar-filter-airline")}
                      value={query.airline ?? ""}
                      onChange={(event) =>
                        void load({ ...current.current, airline: event.target.value || null, page: 0 })
                      }
                      slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
                    >
                      <MenuItem value="">{t("cases-bar-filter-any-airline")}</MenuItem>
                      {ready.airlines.map((airline) => (
                        <MenuItem key={airline.iata} value={airline.iata}>
                          {airline.name}
                        </MenuItem>
                      ))}
                    </TextField>
                  </>
                ),
              }}
              sort={{
                label: t("cases-bar-sort"),
                options: CASE_SORTS.map((key) => ({ key, label: t(SORT_KEY[key]) })),
                value: query.sort ?? "recent",
                onChange: (key) => {
                  if (isCaseSort(key)) void load({ ...current.current, sort: key, page: 0 });
                },
              }}
              more={
                ready.supportVisit
                  ? undefined
                  : {
                      label: t("cases-bar-more"),
                      actions: [
                        {
                          key: "by-hand",
                          label: t("cases-empty-by-hand"),
                          icon: <NiFolderPlus size="medium" />,
                          onClick: () => setCreating(true),
                        },
                        ...(mayImport
                          ? [
                              {
                                key: "import",
                                label: t("cases-import"),
                                icon: <NiArrowInUp size="medium" />,
                                onClick: () => router.push("/casos/importar"),
                              },
                            ]
                          : []),
                      ],
                    }
              }
              chips={chips}
            />
            {searching && !loading ? (
              <Typography variant="body2" role="status" className="text-text-secondary px-1">
                {t("cases-found", { count: list.total })}.{" "}
                {filter ? t("cases-search-in-filter", { filter: t(FILTER_TILE[filter].label) }) : t("cases-search-all")}
              </Typography>
            ) : null}
          </Box>

          <DataTable
            rows={list.rows}
            columns={columns}
            loading={loading}
            onRowClick={(row) => router.push(`/casos/${row.id}`)}
            // The list is the server's, a page at a time: an export here would be of the page alone.
            enableExport={false}
            hideToolbar
            pageSize={query.pageSize}
            pageSizeOptions={[...PAGE_SIZES]}
            server={{
              total: list.total,
              page: query.page,
              pageSize: query.pageSize,
              onPageChange: (page, pageSize) => {
                const now = current.current;
                if (page === now.page && pageSize === now.pageSize) return;
                void load({ ...now, pageSize, page: pageSize === now.pageSize ? page : 0 });
              },
              // The search is the bar's.
              onSearchChange: () => undefined,
            }}
            noRowsOverlay={nothing}
          />
        </>
      )}

      {creating && (
        <NewCaseDialog
          airlines={ready.airlines}
          module={scope?.module.key ?? null}
          prefill={ready.prefill}
          onClose={() => setCreating(false)}
          onCreated={(caseId) => router.push(`/casos/${caseId}`)}
        />
      )}
    </Box>
  );
}
