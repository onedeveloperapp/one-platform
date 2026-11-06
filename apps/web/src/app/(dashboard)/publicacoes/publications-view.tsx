"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import { Alert, Box, Button, Card, CardContent, Collapse, Grid, TextField, Typography } from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import EmptyState from "@/components/product/empty-state";
import { StatTile } from "@/components/product/home-tiles";
import ModuleScope from "@/components/product/module-scope";
import PageHeader from "@/components/product/page-header";
import StateLine from "@/components/product/state-line";
import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import { TILE_TONE, type TileTone } from "@/components/product/tile-tone";
import PublicationCard, { CATEGORY_LOOK } from "@/components/publications/publication-card";
import NiDocumentCheck from "@/icons/nexture/ni-document-check";
import NiDocumentCross from "@/icons/nexture/ni-document-cross";
import NiInbox from "@/icons/nexture/ni-inbox";
import NiInfoSquare from "@/icons/nexture/ni-info-square";
import NiShieldCheck from "@/icons/nexture/ni-shield-check";
import NiUsers from "@/icons/nexture/ni-users";
import type { DeadlineAct } from "@/lib/deadlines/facts";
import type { Colleague } from "@/lib/hearings/facts";
import type { CourtZones } from "@/lib/hearings/hearings";
import { type PageScope, scopeCrumbs } from "@/lib/modules/offer";
import {
  readPublicationProgress,
  requestPublicationsCapture,
  searchPublications,
  setFirmAiTriage,
} from "@/lib/publications/actions";
import type {
  AiTriage,
  CaptureRow,
  PublicationProgress,
  PublicationRow,
  PublicationsData,
  StoppedRow,
} from "@/lib/publications/facts";
import { countsNow, type HeldList, holdList, triagedInList, withSaid, withSeen } from "@/lib/publications/list-state";
import {
  captureErrorKey,
  type CaptureHealth,
  CATEGORY_HINT_KEY,
  CATEGORY_KEY,
  HEALTH_KEY,
  isUnsureReading,
  PUBLICATION_CATEGORIES,
  publicationErrorKey,
  PUBLICATIONS_SHOWN,
  publicationsAddress,
  type PublicationView,
  type ReadingState,
  readingState,
  VIEW_COUNT,
} from "@/lib/publications/publications";
import { readingOnCard } from "@/lib/publications/reading-words";
import { cn } from "@/lib/utils";
import { formatDayBr } from "@flyee/rules/person";

export type PublicationsState =
  | {
      kind: "ready";
      view: PublicationView;
      data: PublicationsData;
      /** The person reading may say what a publication is, and ask for a reading. */
      mayTriage: boolean;
      /** This environment reads the DJEN. */
      captureOn: boolean;
      /** The person decides whether the AI's word may be the firm's triage: a partner, or, with none, who manages it. */
      mayDecideAi: boolean;
      /** The acts a term is usually set for, for a deadline counted from a publication. */
      acts: DeadlineAct[];
      /** The firm's people, for who attends a hearing written from a publication. */
      colleagues: Colleague[];
      /** The zones of each court, for the zone a hearing written from a publication is said in. */
      courtZones: Record<string, CourtZones>;
      /** The modules of the firm, and the one the page is under (0078). */
      scope: PageScope;
    }
  | { kind: "no-firm" }
  | { kind: "unavailable" }
  | { kind: "error" };

const VIEW_TILE: Record<PublicationView, { label: string; hint: string; tone: TileTone; icon: React.ReactNode }> = {
  "por-triar": {
    label: "publications-view-untriaged",
    hint: "publications-view-untriaged-hint",
    tone: "accent-3",
    icon: <NiInbox size="large" />,
  },
  conferir: {
    label: "publications-view-review",
    hint: "publications-view-review-hint",
    tone: "accent-4",
    icon: <NiShieldCheck size="large" />,
  },
  triadas: {
    label: "publications-view-triaged",
    hint: "publications-view-triaged-hint",
    tone: "primary",
    icon: <NiDocumentCheck size="large" />,
  },
  canceladas: {
    label: "publications-view-cancelled",
    hint: "publications-view-cancelled-hint",
    tone: "secondary",
    icon: <NiDocumentCross size="large" />,
  },
};

/** What an empty list says, by what the list is. */
const EMPTY_KEY: Record<PublicationView, { title: string; body: string }> = {
  "por-triar": { title: "publications-empty-untriaged-title", body: "publications-empty-untriaged-body" },
  conferir: { title: "publications-empty-review-title", body: "publications-empty-review-body" },
  triadas: { title: "publications-empty-triaged-title", body: "publications-empty-triaged-body" },
  canceladas: { title: "publications-empty-cancelled-title", body: "publications-empty-cancelled-body" },
};

const HEALTH_TONE: Record<CaptureHealth, StatusTone> = {
  ok: "positive",
  reading: "info",
  waiting: "neutral",
  late: "attention",
  incomplete: "attention",
  failed: "attention",
};

/**
 * What the courts published to the firm's lawyers. Somebody who runs the
 * firm's deadlines opens this every day to go through what arrived and say
 * what each publication is, so none is left unread: success is nothing left
 * to triage. So the screen opens on what nobody triaged yet, the oldest
 * first, each publication with the start and the end of its text and its six
 * answers one click away, and a triaged one stays where it was until the
 * person asks for the next ones, so a wrong click is put right on the spot.
 * And it says, per registration at the bar, how far the reading of the
 * gazette went: a list with nothing new means something only when the
 * reading is up to date, so a reading that failed or is late is said before
 * the list, never hidden behind it.
 *
 * The list the person works through is held by the screen: saving an answer
 * reads the page again behind it (so the home and the next visit are
 * right), and what comes of that reading replaces nothing the person is
 * looking at. The screen starts over from what the server read only when
 * the person asks: another list, another page, or the next ones.
 */
export default function PublicationsView({ state }: { state: PublicationsState }) {
  const router = useRouter();
  const [epoch, setEpoch] = useState(0);
  const asked = useRef(false);
  const readAt = state.kind === "ready" ? state.data.readAt : "";
  useEffect(() => {
    // The reading the person asked for arrived: the screen starts over from it. One nobody asked for
    // (the page is read again each time an answer is saved) starts nothing over.
    if (asked.current) {
      asked.current = false;
      setEpoch((count) => count + 1);
    }
  }, [readAt]);
  const readAgain = useCallback(() => {
    asked.current = true;
    router.refresh();
  }, [router]);
  const listKey = state.kind === "ready" ? `${state.view}:${state.data.page}:${epoch}` : state.kind;
  return <PublicationsScreen key={listKey} state={state} onReadAgain={readAgain} />;
}

function PublicationsScreen({ state, onReadAgain }: { state: PublicationsState; onReadAgain: () => void }) {
  const t = useTranslations("product");
  const router = useRouter();
  const [asking, startAsking] = useTransition();
  const [searching, startSearching] = useTransition();
  const [notice, setNotice] = useState<{ tone: "success" | "info" | "error"; text: string } | null>(null);
  const [typed, setTyped] = useState("");
  const [found, setFound] = useState<{ rows: PublicationRow[]; more: boolean } | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const ready = state.kind === "ready" ? state : null;
  const data = ready?.data ?? null;
  // Under a module (0078), every list and page of the screen stays under it.
  const module = ready?.scope.current?.key ?? null;
  /** The list as the server read it last. */
  const fresh = useMemo(
    () => holdList(data?.rows ?? [], data?.counts ?? { untriaged: 0, review: 0, triaged: 0, cancelled: 0 }),
    [data],
  );
  /**
   * The list the person is working on: held from their first answer on, with what they said. Until then
   * there is nothing of theirs to keep, and the list is the one the server read last (a reading that was
   * asked for may bring the first publications a moment later).
   */
  const [held, setHeld] = useState<HeldList<PublicationRow> | null>(null);
  const list = held ?? fresh;
  const change = (apply: (current: HeldList<PublicationRow>) => HeldList<PublicationRow>) =>
    setHeld((current) => apply(current ?? fresh));

  const total = data ? data.counts.untriaged + data.counts.triaged + data.counts.cancelled : 0;
  const showsReview = Boolean(
    data && (data.counts.review > 0 || data.aiTriage.sampled.length > 0 || ready?.view === "conferir"),
  );
  const reading = data ? readingState(data.captures.map((capture) => capture.health)) : "none";
  // Where the DJEN is not read at all (a development machine, a preview), no registration is ever read: its reading
  // is neither late nor unsure, and the screen says only that (2026-11-05).
  const off = Boolean(ready && !ready.captureOn);
  const unsure = !off && isUnsureReading(reading);
  const leftOut = (data?.captures ?? []).filter((capture) => capture.leftOut > 0);
  // What the team puts right: a registration the DJEN refuses as it is written, or a reading that stopped. Anything
  // else of the reading is ONE's own work, which it tries again by itself.
  const teamFixes = Boolean(
    data &&
      (data.stopped.length > 0 ||
        data.captures.some((capture) => capture.health === "failed" && capture.error === "djen_invalid_registration")),
  );
  const nothingKey = off
    ? "publications-nothing-off"
    : unsure
      ? "publications-nothing-unsure"
      : reading === "ok"
        ? "publications-nothing-ok"
        : "publications-nothing-pending";
  const emptyBodyKey =
    ready && ready.view === "por-triar" && !off && (unsure || reading === "none")
      ? "publications-empty-untriaged-unsure"
      : EMPTY_KEY[ready?.view ?? "por-triar"].body;

  const askForReading = () =>
    startAsking(async () => {
      try {
        const result = await requestPublicationsCapture();
        if (result.ok) {
          setNotice({ tone: "success", text: t("publications-capture-requested") });
          router.refresh();
          return;
        }
        setNotice({
          tone: ["too_soon", "in_course", "capture_off"].includes(result.code) ? "info" : "error",
          text: t(publicationErrorKey(result.code), { minutes: result.minutes ?? 30 }),
        });
      } catch {
        setNotice({ tone: "error", text: t("publication-error-failed") });
      }
    });

  const search = () =>
    startSearching(async () => {
      setSearchError(null);
      try {
        const result = await searchPublications(typed);
        if (result.ok) setFound({ rows: result.rows, more: result.more });
        else setSearchError(t(publicationErrorKey(result.code)));
      } catch {
        setSearchError(t("publication-error-failed"));
      }
    });
  const clearSearch = () => {
    setFound(null);
    setTyped("");
    setSearchError(null);
  };

  const mayAsk = Boolean(ready?.mayTriage && ready.captureOn && data?.hasRegistrations);
  const readNow = mayAsk ? (
    <Button variant="outlined" color="grey" onClick={askForReading} disabled={asking}>
      {t("publications-capture-now")}
    </Button>
  ) : undefined;
  const counts = data ? countsNow(list) : null;
  const rows = found ? found.rows : list.rows;
  /**
   * What the screen knows of each publication since the list was read: what ONE read of it, its deadlines and
   * hearings, and what a person did by hand. The list is held while the person works it, so every read of the
   * server (the list again, a search, the questions below) adds to this, the newest read of a publication
   * winning, and the cards read it instead of their held rows.
   */
  const [progress, setProgress] = useState<Record<string, PublicationProgress>>({});
  useEffect(() => {
    if (data) setProgress((current) => newestProgress(current, progressOf(data.rows, Date.now())));
  }, [data]);
  useEffect(() => {
    if (found) setProgress((current) => newestProgress(current, progressOf(found.rows, Date.now())));
  }, [found]);
  const waitingKey = rows
    .filter((row) => {
      if (!row.active) return false;
      const said = list.said[row.id];
      const known = progress[row.id];
      return (
        readingOnCard(
          said ? said.category : row.category,
          known?.readings ?? row.readings,
          said?.reading ?? null,
          said?.at,
          known?.readAt,
        )?.status === "due"
      );
    })
    .map((row) => row.id)
    .join(",");
  // While ONE reads some of them, the screen asks what it recorded: one question at a time, less often as time goes.
  useEffect(() => {
    if (!waitingKey) return;
    const ids = waitingKey.split(",");
    let stopped = false;
    let turn = 0;
    let timer: number | undefined;
    const ask = () => {
      if (stopped || turn >= READING_POLLS) return;
      turn += 1;
      const askedAt = Date.now();
      readPublicationProgress(ids, askedAt)
        .then(
          (result) => {
            if (!stopped && result.ok) setProgress((current) => newestProgress(current, result.progress));
          },
          () => undefined,
        )
        .finally(() => {
          if (!stopped) timer = window.setTimeout(ask, pollDelay(turn));
        });
    };
    timer = window.setTimeout(ask, pollDelay(0));
    return () => {
      stopped = true;
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [waitingKey]);
  /** The publications of the list itself that got their first word since it was read: still shown in it. */
  const triagedHere = triagedInList(list);

  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title={t("publications-title")}
        crumbs={scopeCrumbs(t("approvals-home"), t("publications-title"), ready?.scope.current ?? null)}
        description={ready ? t("publications-description") : undefined}
        action={total > 0 ? readNow : undefined}
      />
      {ready ? (
        <ModuleScope
          path="/publicacoes"
          modules={ready.scope.modules}
          current={module}
          keep={{ ver: ready.view === "por-triar" ? null : ready.view }}
        />
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
          {t("publications-load-error")}
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

      {notice ? (
        <Alert
          severity={notice.tone}
          role="status"
          className="neutral bg-background-paper/60!"
          onClose={() => setNotice(null)}
        >
          {notice.text}
        </Alert>
      ) : null}

      {/*
        How far the reading of the gazette went, in one card before the list (a list with nothing new means something
        only when the reading is up to date): its state on its head, and the registrations, what a reading left out
        and the readings that stopped inside it, open by itself when the team has something to put right there.
      */}
      {ready && data && total > 0 && (data.captures.length > 0 || data.stopped.length > 0 || reading === "none") ? (
        <ReadingCard
          captures={data.captures}
          stopped={data.stopped}
          off={off}
          reading={reading}
          leftOut={leftOut}
          teamFixes={teamFixes}
        />
      ) : null}

      {ready && data && total === 0 && reading === "none" && !data.hasRegistrations ? (
        <EmptyState
          icon={<NiUsers size="large" />}
          title={t("publications-no-registration-title")}
          description={t("publications-no-registration-body")}
          action={{ label: t("publications-no-registration-action"), href: "/settings/team" }}
        />
      ) : null}

      {ready && data && total === 0 && (reading !== "none" || data.hasRegistrations) ? (
        <EmptyState
          icon={<NiInbox size="large" />}
          title={t(off ? "publications-nothing-off-title" : "publications-nothing-title")}
          description={t(nothingKey)}
          action={mayAsk && !asking ? { label: t("publications-capture-now"), onClick: askForReading } : undefined}
          secondaryAction={teamFixes ? { label: t("publications-first-read-team"), href: "/settings/team" } : undefined}
        />
      ) : null}

      {ready && data && counts && total > 0 ? (
        <>
          <Grid container spacing={2.5}>
            {/* What to check shows when there is something of it, or the AI's word is a firm's triage somewhere. */}
            {(Object.keys(VIEW_TILE) as PublicationView[])
              .filter((view) => view !== "conferir" || showsReview)
              .map((view) => (
                <Grid key={view} size={{ xs: showsReview ? 6 : 4, lg: showsReview ? 3 : 4 }}>
                  <StatTile
                    onClick={() => {
                      const searching = Boolean(found);
                      clearSearch();
                      // The list already on the screen, asked for again, is read again from its start.
                      if (view !== ready.view || data.page > 0) router.push(publicationsAddress(view, 0, module));
                      else if (!searching) onReadAgain();
                    }}
                    pressed={!found && ready.view === view}
                    icon={VIEW_TILE[view].icon}
                    tone={VIEW_TILE[view].tone}
                    label={t(VIEW_TILE[view].label)}
                    hint={t(VIEW_TILE[view].hint)}
                    value={counts[VIEW_COUNT[view]]}
                  />
                </Grid>
              ))}
          </Grid>
        </>
      ) : null}

      {/* Where nothing was published yet, the reading is said under what the empty list says. */}
      {ready && data && total === 0 && (data.captures.length > 0 || data.stopped.length > 0) ? (
        <ReadingCard
          captures={data.captures}
          stopped={data.stopped}
          off={off}
          reading={reading}
          leftOut={leftOut}
          teamFixes={teamFixes}
        />
      ) : null}

      {ready && data && total > 0 ? (
        <Box component="section" aria-labelledby="publications-list" className="flex flex-col gap-4">
          {/* The list's head: which list it is, the search of a lawsuit's publications, and what the answers mean. */}
          <Box className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
            <Box className="flex min-w-0 flex-col gap-1">
              <Typography id="publications-list" variant="h5" component="h2" className="mb-0">
                {found ? t("publications-search-found-title") : t(VIEW_TILE[ready.view].label)}
              </Typography>
              <Typography variant="body2" className="text-text-secondary" role={found ? "status" : undefined}>
                {found
                  ? [
                      t("publications-search-results", { count: found.rows.length }),
                      found.more ? t("publications-search-more", { count: PUBLICATIONS_SHOWN }) : null,
                    ]
                      .filter(Boolean)
                      .join(" ")
                  : t(VIEW_TILE[ready.view].hint)}
              </Typography>
            </Box>
            <Box
              component="form"
              role="search"
              aria-label={t("publications-search-title")}
              className="flex flex-none flex-wrap items-start gap-2"
              onSubmit={(event: React.FormEvent) => {
                event.preventDefault();
                search();
              }}
            >
              <TextField
                size="small"
                label={t("publications-search-label")}
                value={typed}
                onChange={(event) => setTyped(event.target.value.slice(0, 40))}
                error={Boolean(searchError)}
                helperText={searchError ?? undefined}
                className="w-full sm:w-72"
                slotProps={{ htmlInput: { inputMode: "numeric", autoComplete: "off" } }}
              />
              <Button type="submit" variant="outlined" color="grey" disabled={searching || typed.trim() === ""}>
                {t("publications-search-action")}
              </Button>
              {found ? (
                <Button variant="text" color="grey" onClick={clearSearch}>
                  {t("publications-search-clear")}
                </Button>
              ) : null}
            </Box>
          </Box>

          {!ready.mayTriage ? (
            <Typography variant="body2" className="text-text-secondary">
              {t("publications-read-only")}
            </Typography>
          ) : null}

          {ready.mayTriage && rows.some((row) => row.active) ? <CategoryLegend /> : null}

          {rows.length === 0 && !found ? (
            <EmptyState
              icon={ready.view === "por-triar" ? <NiDocumentCheck size="large" /> : <NiInbox size="large" />}
              title={t(EMPTY_KEY[ready.view].title)}
              description={t(emptyBodyKey)}
              action={
                ready.view === "por-triar"
                  ? data.counts.triaged > 0
                    ? { label: t("publications-empty-see-triaged"), href: publicationsAddress("triadas", 0, module) }
                    : undefined
                  : { label: t("publications-empty-see-untriaged"), href: publicationsAddress("por-triar", 0, module) }
              }
            />
          ) : null}

          {rows.length > 0 ? (
            <Box component="ul" className="m-0 flex list-none flex-col gap-4 p-0">
              {rows.map((row) => (
                <Box component="li" key={row.id}>
                  <PublicationCard
                    row={row}
                    progress={progress[row.id] ?? null}
                    acts={ready.acts}
                    colleagues={ready.colleagues}
                    courtZones={ready.courtZones}
                    mayTriage={ready.mayTriage}
                    said={list.said[row.id] ?? null}
                    seen={list.seen.includes(row.id)}
                    onSaid={(said) =>
                      change((current) => withSaid(current, row.id, row.category, said, row.byAi && row.reviewDue))
                    }
                    onSeen={() => change((current) => withSeen(current, row.id))}
                  />
                </Box>
              ))}
            </Box>
          ) : null}

          {!found ? (
            <Box className="flex flex-wrap items-center gap-3">
              {ready.view === "por-triar" && triagedHere > 0 ? (
                <>
                  <Typography variant="body2" className="text-text-secondary min-w-0 flex-1" role="status">
                    {t("publications-triaged-here", { count: triagedHere })}
                  </Typography>
                  <Button variant="contained" onClick={onReadAgain}>
                    {t(counts && counts.untriaged > 0 ? "publications-next-batch" : "publications-refresh-list")}
                  </Button>
                </>
              ) : (
                <>
                  <Typography variant="body2" className="text-text-secondary min-w-0 flex-1">
                    {data.page > 0 || data.more ? t("publications-page", { page: data.page + 1 }) : ""}
                  </Typography>
                  {data.page > 0 ? (
                    <Button
                      variant="outlined"
                      color="grey"
                      href={publicationsAddress(ready.view, data.page - 1, module)}
                      LinkComponent={Link}
                    >
                      {t("publications-page-previous")}
                    </Button>
                  ) : null}
                  {data.more ? (
                    <Button
                      variant="outlined"
                      color="grey"
                      href={publicationsAddress(ready.view, data.page + 1, module)}
                      LinkComponent={Link}
                    >
                      {t("publications-page-next")}
                    </Button>
                  ) : null}
                </>
              )}
            </Box>
          ) : null}

          {/* How the firm lets the AI triage: a setting of the firm's, after the work of the day. */}
          {data.aiTriage.sampled.length > 0 ? (
            <AiTriageCard aiTriage={data.aiTriage} mayDecide={ready.mayDecideAi} onChanged={onReadAgain} />
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}

/** What the reading as a whole says on the card's head: its words and its tone. */
const READING_CHIP: Record<ReadingState, { key: string; tone: StatusTone }> = {
  none: { key: "publications-reading-chip-none", tone: "attention" },
  failing: { key: "publication-capture-failed", tone: "attention" },
  late: { key: "publication-capture-late", tone: "attention" },
  incomplete: { key: "publication-capture-incomplete", tone: "attention" },
  pending: { key: "publication-capture-waiting", tone: "info" },
  ok: { key: "publication-capture-ok", tone: "positive" },
};

/**
 * How far the reading of the gazette went, in one card: what makes "nothing new" mean something. Closed, its head
 * says where the reading stands and one line of why; open, each registration with how far it was read, what a
 * reading left out (each one at the DJEN by its certificate) and the readings that stopped, with the way to the team.
 * It opens by itself when the team has something to put right there; a reading that is only late is ONE's own work,
 * said and never asked of anybody.
 */
function ReadingCard({
  captures,
  stopped,
  off,
  reading,
  leftOut,
  teamFixes,
}: {
  captures: CaptureRow[];
  stopped: StoppedRow[];
  off: boolean;
  reading: ReadingState;
  leftOut: CaptureRow[];
  teamFixes: boolean;
}) {
  const t = useTranslations("product");
  const chip = off
    ? { key: "publication-capture-off", tone: "neutral" as const }
    : stopped.length > 0 && (reading === "ok" || reading === "pending")
      ? { key: "publications-reading-stopped-chip", tone: "attention" as const }
      : READING_CHIP[reading];
  const summary = off
    ? t("publications-capture-off")
    : reading === "failing"
      ? t("publications-reading-warning-failing")
      : reading === "late"
        ? t("publications-reading-warning-late")
        : reading === "none"
          ? t("publications-reading-warning-none")
          : leftOut.length > 0
            ? t("publications-reading-summary-left-out")
            : stopped.length > 0
              ? t("publications-reading-summary-stopped", { count: stopped.length })
              : reading === "pending"
                ? t("publications-reading-summary-pending")
                : t("publications-reading-summary-ok", { count: captures.length });
  return (
    <CollapsibleCard
      id="publications-reading"
      anchor="leitura"
      title={t("publications-reading-title")}
      chip={<StatusChip tone={chip.tone} label={t(chip.key)} />}
      summary={summary}
      defaultOpen={!off && (teamFixes || leftOut.length > 0 || reading === "none")}
      bodyClassName="gap-3"
    >
      {captures.length > 0 ? (
        <Box component="ul" className="m-0 flex list-none flex-col p-0">
          {captures.map((capture) => {
            const read = [
              capture.capturedThrough
                ? t("publications-reading-through", {
                    day: formatDayBr(capture.capturedThrough) ?? capture.capturedThrough,
                  })
                : null,
              capture.capturedLabel ? t("publications-reading-last", { when: capture.capturedLabel }) : null,
            ]
              .filter(Boolean)
              .join(" · ");
            return (
              <Box
                component="li"
                key={capture.id}
                className="border-grey-100 flex flex-wrap items-center gap-3 border-b py-3 last:border-b-0"
              >
                <Box className="flex min-w-0 flex-1 flex-col">
                  <Typography variant="body1" className="font-semibold">
                    {[t("publications-reading-oab", { uf: capture.uf, number: capture.number }), capture.lawyer]
                      .filter(Boolean)
                      .join(" · ")}
                  </Typography>
                  {/* How far the reading is good stays said when the last try failed: that is when it matters. */}
                  <Typography variant="body2" className="text-text-secondary">
                    {read || t("publications-reading-never")}
                  </Typography>
                  {capture.health === "failed" && capture.error ? (
                    <Typography variant="body2" className="text-text-primary">
                      {capture.error === "djen_too_many" && capture.stoppedAt
                        ? t("publication-capture-error-too-many", {
                            day: formatDayBr(capture.stoppedAt) ?? capture.stoppedAt,
                          })
                        : t(captureErrorKey(capture.error === "djen_too_many" ? "" : capture.error))}
                    </Typography>
                  ) : null}
                </Box>
                {/* Where nothing is read, no reading is late: the chip says only that. */}
                {off ? (
                  <StatusChip tone="neutral" label={t("publication-capture-off")} />
                ) : (
                  <StatusChip tone={HEALTH_TONE[capture.health]} label={t(HEALTH_KEY[capture.health])} />
                )}
              </Box>
            );
          })}
        </Box>
      ) : null}

      {/* What a reading left out, as far as each could be told apart: what a person opens at the DJEN itself. */}
      {leftOut.map((capture) => (
        <Box
          key={capture.id}
          className="border-accent-3/30 bg-accent-3-light/5 flex flex-col gap-2 rounded-2xl border p-3"
        >
          <StateLine tone="attention">
            {t("publications-reading-left-out", {
              count: capture.leftOut,
              when: capture.leftOutLabel ?? "",
              uf: capture.uf,
              number: capture.number,
            })}
          </StateLine>
          {capture.leftOutItems.length > 0 ? (
            <Box component="ul" className="m-0 flex list-none flex-col gap-1 p-0 pl-7">
              {capture.leftOutItems.map((item, index) => (
                <Box component="li" key={index} className="flex flex-wrap items-center gap-x-3">
                  <Typography variant="body2" component="span">
                    {[
                      item.court,
                      item.day ? t("publication-available-on", { day: formatDayBr(item.day) ?? item.day }) : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || t("publications-left-out-unknown")}
                  </Typography>
                  {item.certificateUrl ? (
                    <Button
                      variant="text"
                      color="primary"
                      size="small"
                      href={item.certificateUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                    >
                      {t("publication-certificate")}
                    </Button>
                  ) : (
                    <Typography variant="body2" component="span" className="text-text-secondary">
                      {t("publications-left-out-no-hash")}
                    </Typography>
                  )}
                </Box>
              ))}
            </Box>
          ) : null}
        </Box>
      ))}

      {/* A reading that stopped is never quiet: the courts go on addressing that lawyer. */}
      {stopped.length > 0 ? (
        <Box className="border-grey-100 flex flex-col gap-2 border-t pt-3">
          <Typography variant="subtitle2" component="h3" className="mb-0">
            {t("publications-reading-stopped-title")}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {t("publications-reading-stopped-body")}
          </Typography>
          <Box component="ul" className="m-0 flex list-none flex-col p-0">
            {stopped.map((row) => (
              <Box component="li" key={row.id} className="flex flex-wrap items-center gap-3 py-2">
                <Box className="flex min-w-0 flex-1 flex-col">
                  <Typography variant="body1" className="font-semibold">
                    {[t("publications-reading-oab", { uf: row.uf, number: row.number }), row.lawyer]
                      .filter(Boolean)
                      .join(" · ")}
                  </Typography>
                  <Typography variant="body2" className="text-text-secondary">
                    {[
                      row.stoppedLabel ? t("publications-reading-stopped-when", { when: row.stoppedLabel }) : null,
                      row.readThrough
                        ? t("publications-reading-through", { day: formatDayBr(row.readThrough) ?? row.readThrough })
                        : t("publications-reading-never"),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Typography>
                </Box>
                <StatusChip tone="attention" label={t("publications-reading-stopped-chip")} />
              </Box>
            ))}
          </Box>
        </Box>
      ) : null}

      {/* The team is where a registration is put right: a reading that stopped, one the DJEN refuses, or none at all. */}
      {teamFixes || reading === "none" ? (
        <Box className="-ml-2">
          <Button component={Link} href="/settings/team" variant="text" color="primary" size="small">
            {reading === "none" ? t("publications-no-registration-action") : t("publications-reading-stopped-team")}
          </Button>
        </Box>
      ) : null}
    </CollapsibleCard>
  );
}

/** What each of the six answers means, said once for the whole list, where a keyboard and a finger reach it. */
/**
 * What the AI's word is, in this firm: the categories the ONE classifies by
 * itself, with the share a person checks, and whether the firm lets it. A
 * partner turns it on or off; anybody else reads it.
 */
function AiTriageCard({
  aiTriage,
  mayDecide,
  onChanged,
}: {
  aiTriage: AiTriage;
  mayDecide: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const switchTo = (enabled: boolean) =>
    startTransition(async () => {
      setError(null);
      try {
        const result = await setFirmAiTriage(enabled);
        if (!result.ok) {
          setError(t(publicationErrorKey(result.code)));
          return;
        }
        onChanged();
      } catch {
        setError(t("publication-error-failed"));
      }
    });
  const categories = aiTriage.sampled
    .map((policy) =>
      t("publications-ai-share", { category: t(CATEGORY_KEY[policy.category]), share: policy.samplePercent }),
    )
    .join(", ");
  return (
    <Card component="section" aria-labelledby="publications-ai">
      <CardContent className="flex flex-col gap-2">
        <Typography id="publications-ai" variant="subtitle2" component="h2" className="mb-0">
          {t("publications-ai-title")}
        </Typography>
        <Typography variant="body2" className="text-text-secondary">
          {!aiTriage.firmAllows ? t("publications-ai-off") : t("publications-ai-body", { categories })}
        </Typography>
        {mayDecide ? (
          <Box>
            <Button
              variant="outlined"
              color="grey"
              size="small"
              disabled={pending}
              onClick={() => switchTo(!aiTriage.firmAllows)}
            >
              {t(aiTriage.firmAllows ? "publications-ai-disallow" : "publications-ai-allow")}
            </Button>
          </Box>
        ) : (
          <Typography variant="body2" className="text-text-secondary">
            {t("publications-ai-partner")}
          </Typography>
        )}
        {error ? (
          <Alert severity="error" className="neutral bg-background-paper/60!">
            {error}
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}

function CategoryLegend() {
  const t = useTranslations("product");
  const [open, setOpen] = useState(false);
  return (
    <Box className="flex flex-col gap-2">
      <Box className="-ml-2">
        <Button
          variant="text"
          color="grey"
          size="small"
          startIcon={<NiInfoSquare size="small" />}
          aria-expanded={open}
          aria-controls="publications-legend"
          onClick={() => setOpen((now) => !now)}
        >
          {t("publications-legend-title")}
        </Button>
      </Box>
      <Collapse in={open} unmountOnExit>
        <Box
          id="publications-legend"
          component="dl"
          className="bg-grey-25 m-0 grid grid-cols-1 gap-x-6 gap-y-2 rounded-2xl p-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {PUBLICATION_CATEGORIES.map((category) => (
            <Box key={category} className="flex flex-row items-start gap-2">
              <Box
                aria-hidden
                className={cn(
                  "flex h-7 w-7 flex-none items-center justify-center rounded-lg",
                  TILE_TONE[CATEGORY_LOOK[category].tone].bg,
                  TILE_TONE[CATEGORY_LOOK[category].tone].text,
                )}
              >
                {CATEGORY_LOOK[category].icon}
              </Box>
              <Box className="flex min-w-0 flex-col">
                <Typography component="dt" variant="body2" className="font-semibold">
                  {t(CATEGORY_KEY[category])}
                </Typography>
                <Typography component="dd" variant="body2" className="text-text-secondary m-0">
                  {t(CATEGORY_HINT_KEY[category])}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>
      </Collapse>
    </Box>
  );
}

/**
 * How often, and for how long, a list asks what ONE recorded of the publications it is reading: every few
 * seconds at first, then less often, for some ten minutes (a reading waits its turn behind others).
 */
const READING_POLLS = 30;
const pollDelay = (turn: number): number => (turn < 5 ? 4000 : turn < 15 ? 10_000 : 30_000);

/** What the screen knows of some rows read at one moment. */
function progressOf(rows: readonly PublicationRow[], readAt: number): Record<string, PublicationProgress> {
  return Object.fromEntries(
    rows.map((row) => [
      row.id,
      {
        readings: row.readings,
        deadlines: row.deadlines,
        hearings: row.hearings,
        anyDeadline: row.anyDeadline,
        hearingSettled: row.hearingSettled,
        readAt,
      },
    ]),
  );
}

/** What the screen knows with some more read: of each publication, the newest read wins. */
function newestProgress(
  current: Record<string, PublicationProgress>,
  incoming: Record<string, PublicationProgress>,
): Record<string, PublicationProgress> {
  let next = current;
  for (const [id, entry] of Object.entries(incoming)) {
    const known = current[id];
    if (known && known.readAt > entry.readAt) continue;
    if (next === current) next = { ...current };
    next[id] = entry;
  }
  return next;
}
