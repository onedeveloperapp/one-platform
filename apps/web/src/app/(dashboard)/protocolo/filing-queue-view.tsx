"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useMemo, useState } from "react";

import { Alert, Box, Button, Card, CardContent, Grid, MenuItem, TextField, Typography } from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import ListBar, { type ListChip, type ListView } from "@/components/product/list-bar";
import ModuleScope from "@/components/product/module-scope";
import NumberCard from "@/components/product/number-card";
import PageHeader from "@/components/product/page-header";
import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import type { TileTone } from "@/components/product/tile-tone";
import NiClock from "@/icons/nexture/ni-clock";
import NiExclamationHexagon from "@/icons/nexture/ni-exclamation-hexagon";
import NiLock from "@/icons/nexture/ni-lock";
import NiScale from "@/icons/nexture/ni-scale";
import NiUsers from "@/icons/nexture/ni-users";
import { caseLabel } from "@/lib/cases/cases";
import { PACKAGE_STATUS_KEY, QUEUE_SHOWN } from "@/lib/cases/filing";
import type { QueuedFiling } from "@/lib/cases/filing-facts";
import {
  isQueueSort,
  isQueueView,
  QUEUE_SORTS,
  QUEUE_VIEWS,
  queueCounts,
  queueFacets,
  queueGroups,
  queueRows,
  type QueueSort,
  type QueueView,
} from "@/lib/cases/filing-queue";
import { type PageScope, scopeCrumbs } from "@/lib/modules/offer";
import { countText } from "@/lib/numbers/compare";

export type FilingQueueState =
  | {
      kind: "ready";
      firm: string;
      rows: QueuedFiling[];
      /** True when more packages wait than the screen reads at once. */
      truncated: boolean;
      /** A lawyer can authorize ONE at some PSC here: otherwise no signature waits for an authorization. */
      cloudSigning: boolean;
      /** The person reading is a partner or a lawyer: who files. */
      lawyer: boolean;
      /** The modules of the firm, and the one the page is under (0078). */
      scope: PageScope;
      /** The view the page opens on (`?ver=`), so a line elsewhere may lead to the packages ready to file. */
      view: QueueView;
    }
  | { kind: "no-firm" }
  | { kind: "unavailable" }
  | { kind: "error" };

const STATUS_TONE: Record<QueuedFiling["status"], StatusTone> = {
  ready: "attention",
  requested: "info",
  failed: "danger",
};

const SYSTEM_KEY: Record<string, string> = {
  projudi: "case-system-projudi",
  eproc: "case-system-eproc",
  pje: "case-system-pje",
  esaj: "case-system-esaj",
  outro: "case-system-outro",
};

const KIND_KEY: Record<"juizado" | "comum", string> = {
  juizado: "case-proceeding-kind-juizado",
  comum: "case-proceeding-kind-comum",
};

const SORT_KEY: Record<QueueSort, string> = {
  oldest: "filing-queue-sort-oldest",
  newest: "filing-queue-sort-newest",
};

/** The views a card counts, with its icon and tint: what is to file, being built, held, and what failed. */
const CARD: Record<Exclude<QueueView, "todos">, { tone: TileTone; icon: ReactNode }> = {
  prontos: { tone: "primary", icon: <NiScale size="medium" /> },
  montagem: { tone: "accent-1", icon: <NiClock size="medium" /> },
  impedidos: { tone: "accent-4", icon: <NiLock size="medium" /> },
  falha: { tone: "accent-3", icon: <NiExclamationHexagon size="medium" /> },
};

/**
 * The firm's filing queue. A lawyer comes here to know what is ready to be filed and where: the cards say how many
 * packages are ready, being built, held by something of their case and not built, each opening the list it counts;
 * the bar of every list of ONE finds a client, a case or a comarca and keeps to a court or a system; the packages
 * are grouped by court and system, because a lawyer files a run of them in one system with one login, and each one
 * opens its case, where the files are downloaded in order and the receipt is attached. Success is an empty queue.
 * The queue is read whole (at most `QUEUE_SHOWN`), so the bar decides in the browser and never asks again.
 */
export default function FilingQueueView({ state }: { state: FilingQueueState }) {
  const t = useTranslations("product");
  const router = useRouter();
  const ready = state.kind === "ready" ? state : null;

  const [view, setView] = useState<QueueView>(ready?.view ?? "todos");
  const [search, setSearch] = useState("");
  const [court, setCourt] = useState<string | null>(null);
  const [system, setSystem] = useState<string | null>(null);
  const [sort, setSort] = useState<QueueSort>("oldest");

  const rows = useMemo(() => ready?.rows ?? [], [ready]);
  const facets = useMemo(() => queueFacets(rows), [rows]);
  const counts = useMemo(() => queueCounts(rows, { search, court, system }), [rows, search, court, system]);
  const groups = useMemo(
    () => queueGroups(queueRows(rows, { view, search, court, system, sort })),
    [rows, view, search, court, system, sort],
  );
  const systemName = (key: string) => t(SYSTEM_KEY[key] ?? "case-system-outro");
  const narrowed = Boolean(search.trim()) || court !== null || system !== null;

  const views: ListView[] = QUEUE_VIEWS.map((key) => ({
    key,
    label: t(`filing-queue-view-${key}`),
    count: countText(counts[key]),
    group: key === "todos" ? "all" : "state",
  }));
  const chips: ListChip[] = [
    ...(court !== null ? [{ key: "court", label: court, onRemove: () => setCourt(null) }] : []),
    ...(system !== null ? [{ key: "system", label: systemName(system), onRemove: () => setSystem(null) }] : []),
  ];
  const showAll = () => {
    setView("todos");
    setSearch("");
    setCourt(null);
    setSystem(null);
  };

  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title={t("filing-queue-title")}
        crumbs={scopeCrumbs(t("approvals-home"), t("filing-queue-title"), ready?.scope.current ?? null)}
        description={ready ? t("filing-queue-description") : undefined}
      />
      {ready ? (
        <ModuleScope path="/protocolo" modules={ready.scope.modules} current={ready.scope.current?.key ?? null} />
      ) : null}

      {state.kind === "unavailable" ? (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("settings-unavailable")}
        </Alert>
      ) : null}

      {state.kind === "error" ? (
        <Alert
          severity="error"
          className="neutral bg-background-paper/60!"
          action={
            <Button color="inherit" size="small" onClick={() => router.refresh()}>
              {t("approvals-retry")}
            </Button>
          }
        >
          {t("filing-queue-load-error")}
        </Alert>
      ) : null}

      {state.kind === "no-firm" ? (
        <EmptyState
          icon={<NiUsers size="large" />}
          title={t("cases-no-firm-title")}
          description={t("cases-no-firm-body")}
          action={{ label: t("cases-no-firm-action"), href: "/admin" }}
        />
      ) : null}

      {ready && ready.rows.length === 0 ? (
        <EmptyState
          icon={<NiScale size="large" />}
          title={t("filing-queue-empty-title")}
          description={t("filing-queue-empty-body")}
          action={{ label: t("filing-queue-empty-action"), href: "/casos?ver=preparing" }}
        />
      ) : null}

      {ready && ready.rows.length > 0 ? (
        <>
          {/* How many packages each state holds, under the search and the filters; each opens the list it counts. */}
          <Grid container spacing={2.5}>
            {(Object.keys(CARD) as (keyof typeof CARD)[]).map((key) => (
              <Grid key={key} size={{ xs: 6, lg: 3 }}>
                <NumberCard
                  icon={CARD[key].icon}
                  tone={CARD[key].tone}
                  label={t(`filing-queue-view-${key}`)}
                  hint={t(`filing-queue-view-${key}-hint`)}
                  value={countText(counts[key])}
                  onClick={() => setView(view === key ? "todos" : key)}
                  pressed={view === key}
                />
              </Grid>
            ))}
          </Grid>

          {ready.truncated ? (
            <Alert severity="info" className="neutral bg-background-paper/60!">
              {t("filing-queue-truncated", { count: QUEUE_SHOWN })}
            </Alert>
          ) : null}

          <Box className="flex flex-col gap-2">
            <ListBar
              label={t("filing-queue-bar-label")}
              viewsTitle={t("list-views-title")}
              views={views}
              view={view}
              onView={(key) => {
                if (isQueueView(key)) setView(key);
              }}
              search={{
                label: t("filing-queue-search-label"),
                placeholder: t("list-bar-search"),
                value: search,
                onChange: setSearch,
              }}
              filter={{
                label: t("list-bar-filter"),
                active: (court !== null ? 1 : 0) + (system !== null ? 1 : 0),
                clearLabel: t("list-bar-filter-clear"),
                onClear: () => {
                  setCourt(null);
                  setSystem(null);
                },
                content: (
                  <>
                    <TextField
                      select
                      fullWidth
                      size="small"
                      id="filing-queue-filter-court"
                      label={t("filing-queue-filter-court")}
                      value={court ?? ""}
                      onChange={(event) => setCourt(event.target.value || null)}
                      slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
                    >
                      <MenuItem value="">{t("filing-queue-filter-any-court")}</MenuItem>
                      {facets.courts.map((item) => (
                        <MenuItem key={item} value={item}>
                          {item}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      select
                      fullWidth
                      size="small"
                      id="filing-queue-filter-system"
                      label={t("filing-queue-filter-system")}
                      value={system ?? ""}
                      onChange={(event) => setSystem(event.target.value || null)}
                      slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
                    >
                      <MenuItem value="">{t("filing-queue-filter-any-system")}</MenuItem>
                      {facets.systems.map((item) => (
                        <MenuItem key={item} value={item}>
                          {systemName(item)}
                        </MenuItem>
                      ))}
                    </TextField>
                  </>
                ),
              }}
              sort={{
                label: t("list-bar-sort"),
                options: QUEUE_SORTS.map((key) => ({ key, label: t(SORT_KEY[key]) })),
                value: sort,
                onChange: (key) => {
                  if (isQueueSort(key)) setSort(key);
                },
              }}
              chips={chips}
            />
            {narrowed ? (
              <Typography variant="body2" role="status" className="text-text-secondary px-1">
                {t("filing-queue-found", { count: counts[view] })}
              </Typography>
            ) : null}
            {!ready.lawyer ? (
              <Typography variant="body2" className="text-text-secondary px-1">
                {t("filing-queue-not-lawyer")}
              </Typography>
            ) : null}
          </Box>

          {groups.length === 0 ? (
            <EmptyState
              icon={<NiScale size="large" />}
              title={t("filing-queue-view-empty-title")}
              description={t("filing-queue-view-empty-body")}
              action={{ label: t("filing-queue-view-empty-action"), onClick: showAll }}
            />
          ) : null}

          {groups.map((group) => (
            <Card component="section" key={group.key} aria-labelledby={`filing-group-${group.key}`}>
              <CardContent className="flex flex-col gap-3">
                <Typography id={`filing-group-${group.key}`} variant="h5" component="h2" className="mb-0">
                  {[group.court, systemName(group.system)].join(" · ")}
                </Typography>
                <Box component="ul" className="m-0 flex list-none flex-col p-0">
                  {group.rows.map((row) => (
                    <Box
                      component="li"
                      key={row.id}
                      className="border-grey-100 flex flex-wrap items-center gap-3 border-b py-3 last:border-b-0"
                    >
                      <Box className="flex min-w-0 flex-1 basis-full flex-col sm:basis-0">
                        <Typography variant="body1" className="font-semibold">
                          {[row.caseSeq !== null ? caseLabel(row.caseSeq) : null, row.client]
                            .filter(Boolean)
                            .join(" · ")}
                        </Typography>
                        <Typography variant="body2" className="text-text-secondary">
                          {[
                            row.kind ? t(KIND_KEY[row.kind]) : null,
                            row.comarca,
                            row.status === "ready" ? t("filing-queue-files", { count: row.files }) : null,
                            t("filing-queue-asked", { when: row.requestedLabel }),
                            row.blocker ? t("filing-queue-blocked") : null,
                            // What the signature waits for is said only where a lawyer can give it, and of a
                            // package nothing keeps from being filed.
                            row.status !== "ready" || !row.signature || row.blocker
                              ? null
                              : row.signature === "signed"
                                ? t("filing-queue-signed")
                                : !ready.cloudSigning
                                  ? null
                                  : row.signature === "waiting"
                                    ? t("filing-queue-signature-waiting")
                                    : row.signature === "failed"
                                      ? t("filing-queue-signature-failed")
                                      : t("filing-queue-signing"),
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </Typography>
                      </Box>
                      {/* A package something of its case holds is never said ready: it waits for that first. */}
                      {row.blocker && row.status !== "failed" ? (
                        <StatusChip tone="attention" label={t("filing-queue-view-impedidos")} />
                      ) : (
                        <StatusChip tone={STATUS_TONE[row.status]} label={t(PACKAGE_STATUS_KEY[row.status])} />
                      )}
                      <Button
                        variant={row.status === "ready" && !row.blocker ? "contained" : "outlined"}
                        color={row.status === "ready" && !row.blocker ? "primary" : "grey"}
                        size="small"
                        href={`/casos/${row.caseId}#case-filing`}
                        LinkComponent={Link}
                      >
                        {t("filing-queue-open")}
                      </Button>
                    </Box>
                  ))}
                </Box>
              </CardContent>
            </Card>
          ))}
        </>
      ) : null}
    </Box>
  );
}
