"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Dialog,
  DialogContent,
  Grid,
  TextField,
  Typography,
} from "@mui/material";

import DeadlineDialog from "@/components/deadlines/deadline-dialog";
import HearingDialog from "@/components/hearings/hearing-dialog";
import DialogHeader from "@/components/product/dialog-header";
import EmptyState from "@/components/product/empty-state";
import { StatTile } from "@/components/product/home-tiles";
import ModuleScope from "@/components/product/module-scope";
import PageHeader from "@/components/product/page-header";
import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import type { TileTone } from "@/components/product/tile-tone";
import NiDocumentCheck from "@/icons/nexture/ni-document-check";
import NiDocumentCross from "@/icons/nexture/ni-document-cross";
import NiInbox from "@/icons/nexture/ni-inbox";
import NiShieldCheck from "@/icons/nexture/ni-shield-check";
import NiUsers from "@/icons/nexture/ni-users";
import { caseLabel } from "@/lib/cases/cases";
import { STATUS_KEY as DEADLINE_STATUS_KEY } from "@/lib/deadlines/deadlines";
import type { DeadlineAct } from "@/lib/deadlines/facts";
import type { Colleague } from "@/lib/hearings/facts";
import {
  type CourtZones,
  isHearingZone,
  momentIn,
  STATUS_KEY as HEARING_STATUS_KEY,
  ZONE_KEY,
} from "@/lib/hearings/hearings";
import { type PageScope, scopeCrumbs } from "@/lib/modules/offer";
import {
  acknowledgePublicationCancel,
  readPublication,
  readPublicationProgress,
  requestPublicationsCapture,
  searchPublications,
  setFirmAiTriage,
  triagePublication,
} from "@/lib/publications/actions";
import type {
  AiTriage,
  CaptureRow,
  PublicationProgress,
  PublicationRow,
  PublicationsData,
  StoppedRow,
} from "@/lib/publications/facts";
import {
  countsNow,
  type HeldList,
  holdList,
  type Said,
  triagedInList,
  withSaid,
  withSeen,
} from "@/lib/publications/list-state";
import {
  captureErrorKey,
  type CaptureHealth,
  CATEGORY_HINT_KEY,
  CATEGORY_KEY,
  HEALTH_KEY,
  isUnsureReading,
  PUBLICATION_CATEGORIES,
  type PublicationCategory,
  publicationErrorKey,
  PUBLICATIONS_SHOWN,
  publicationsAddress,
  type PublicationView,
  readingState,
  VIEW_COUNT,
} from "@/lib/publications/publications";
import { readingAdviceKey, readingOnCard, readingReasonKey, readingStatusKey } from "@/lib/publications/reading-words";
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

/** A deadline is what nobody may miss: it takes the accent the app uses for "look at this". */
const CATEGORY_TONE: Record<PublicationCategory, StatusTone> = {
  prazo: "attention",
  audiencia: "attention",
  decisao: "primary",
  pagamento: "positive",
  ciencia: "neutral",
  outro: "neutral",
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
  const unsure = isUnsureReading(reading);
  const leftOut = (data?.captures ?? []).filter((capture) => capture.leftOut > 0);
  // The words each state takes, named here: a call that reads a message is handed its key and nothing else.
  const readingWarningKey =
    reading === "failing" ? "publications-reading-warning-failing" : "publications-reading-warning-late";
  // What a reading left out is said by each reading that left it, right below.
  const warnsOfReading = reading === "failing" || reading === "late";
  const nothingKey = unsure
    ? "publications-nothing-unsure"
    : reading === "ok"
      ? "publications-nothing-ok"
      : "publications-nothing-pending";
  const emptyBodyKey =
    ready && ready.view === "por-triar" && (unsure || reading === "none")
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

      {ready && data && !ready.captureOn ? (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("publications-capture-off")}
        </Alert>
      ) : null}

      {/* What the list below may be missing is said before it, never behind it. */}
      {ready && data && ready.captureOn && warnsOfReading ? (
        <Alert severity="warning" className="neutral bg-background-paper/60!">
          {t(readingWarningKey)}
        </Alert>
      ) : null}
      {ready && data && total > 0 && reading === "none" ? (
        <Alert
          severity="warning"
          className="neutral bg-background-paper/60!"
          action={
            <Button color="inherit" size="small" href="/settings/team" LinkComponent={Link}>
              {t("publications-no-registration-action")}
            </Button>
          }
        >
          {t("publications-reading-warning-none")}
        </Alert>
      ) : null}
      {leftOut.map((capture) => (
        <Alert key={capture.id} severity="warning" className="neutral bg-background-paper/60!">
          {t("publications-reading-left-out", {
            count: capture.leftOut,
            when: capture.leftOutLabel ?? "",
            uf: capture.uf,
            number: capture.number,
          })}
          {/* Which ones, as far as each could be told apart: what a person opens at the DJEN itself. */}
          {capture.leftOutItems.length > 0 ? (
            <Box component="ul" className="m-0 mt-2 flex list-none flex-col gap-1 p-0">
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
                      color="inherit"
                      size="small"
                      href={item.certificateUrl}
                      target="_blank"
                      rel="noopener noreferrer nofollow"
                    >
                      {t("publication-certificate")}
                    </Button>
                  ) : (
                    <Typography variant="body2" component="span">
                      {t("publications-left-out-no-hash")}
                    </Typography>
                  )}
                </Box>
              ))}
            </Box>
          ) : null}
        </Alert>
      ))}

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
          title={t("publications-nothing-title")}
          description={t(nothingKey)}
          action={mayAsk && !asking ? { label: t("publications-capture-now"), onClick: askForReading } : undefined}
          secondaryAction={{ label: t("publications-first-read-team"), href: "/settings/team" }}
        />
      ) : null}

      {ready && data && counts && total > 0 ? (
        <>
          <Grid container spacing={2.5}>
            {/* What to check shows when there is something of it, or the AI's word is a firm's triage somewhere. */}
            {(Object.keys(VIEW_TILE) as PublicationView[])
              .filter((view) => view !== "conferir" || showsReview)
              .map((view) => (
                <Grid key={view} size={{ xs: 12, sm: showsReview ? 6 : 4, lg: showsReview ? 3 : 4 }}>
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

          <Card component="section" aria-labelledby="publications-search">
            <CardContent className="flex flex-col gap-3">
              <Typography id="publications-search" variant="subtitle2" component="h2" className="mb-0">
                {t("publications-search-title")}
              </Typography>
              <Box
                component="form"
                className="flex flex-wrap items-start gap-3"
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
                  helperText={searchError ?? t("publications-search-help")}
                  className="min-w-64 flex-1"
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
              {found ? (
                <Typography variant="body2" className="text-text-secondary" role="status">
                  {[
                    t("publications-search-results", { count: found.rows.length }),
                    found.more ? t("publications-search-more", { count: PUBLICATIONS_SHOWN }) : null,
                  ]
                    .filter(Boolean)
                    .join(" ")}
                </Typography>
              ) : null}
            </CardContent>
          </Card>
        </>
      ) : null}

      {ready && data && (data.captures.length > 0 || data.stopped.length > 0) ? (
        <ReadingCard captures={data.captures} stopped={data.stopped} />
      ) : null}

      {ready && data && total > 0 ? (
        <>
          {!ready.mayTriage ? (
            <Typography variant="body2" className="text-text-secondary">
              {t("publications-read-only")}
            </Typography>
          ) : null}

          {data.aiTriage.sampled.length > 0 ? (
            <AiTriageCard aiTriage={data.aiTriage} mayDecide={ready.mayDecideAi} onChanged={onReadAgain} />
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
        </>
      ) : null}
    </Box>
  );
}

/** How far the reading of the gazette went, per registration at the bar: what makes "nothing new" mean something. */
function ReadingCard({ captures, stopped }: { captures: CaptureRow[]; stopped: StoppedRow[] }) {
  const t = useTranslations("product");
  return (
    <Card component="section" aria-labelledby="publications-reading">
      <CardContent className="flex flex-col gap-3">
        <Typography id="publications-reading" variant="h5" component="h2" className="mb-0">
          {t("publications-reading-title")}
        </Typography>
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
                <StatusChip tone={HEALTH_TONE[capture.health]} label={t(HEALTH_KEY[capture.health])} />
              </Box>
            );
          })}
        </Box>
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
              {stopped.map((reading) => (
                <Box component="li" key={reading.id} className="flex flex-wrap items-center gap-3 py-2">
                  <Box className="flex min-w-0 flex-1 flex-col">
                    <Typography variant="body1" className="font-semibold">
                      {[t("publications-reading-oab", { uf: reading.uf, number: reading.number }), reading.lawyer]
                        .filter(Boolean)
                        .join(" · ")}
                    </Typography>
                    <Typography variant="body2" className="text-text-secondary">
                      {[
                        reading.stoppedLabel
                          ? t("publications-reading-stopped-when", { when: reading.stoppedLabel })
                          : null,
                        reading.readThrough
                          ? t("publications-reading-through", {
                              day: formatDayBr(reading.readThrough) ?? reading.readThrough,
                            })
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
      </CardContent>
    </Card>
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
  return (
    <Box component="section" aria-labelledby="publications-legend" className="flex flex-col gap-2">
      <Typography id="publications-legend" variant="body2" component="h2" className="text-text-secondary mb-0">
        {t("publications-legend-title")}
      </Typography>
      <Box component="dl" className="m-0 grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
        {PUBLICATION_CATEGORIES.map((category) => (
          <Box key={category} className="flex flex-wrap gap-x-1">
            <Typography component="dt" variant="body2" className="font-semibold">
              {t(CATEGORY_KEY[category])}
            </Typography>
            <Typography component="dd" variant="body2" className="text-text-secondary m-0">
              {t(CATEGORY_HINT_KEY[category])}
            </Typography>
          </Box>
        ))}
      </Box>
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

/**
 * One publication: where it comes from, the case it belongs to, the start
 * and the end of its text, and the six answers. The text is a court's: it is
 * rendered as plain text, never as markup. What the person says of it shows
 * on the spot and stays there, so a wrong click is one more click to undo.
 */
function PublicationCard({
  row,
  progress,
  acts,
  colleagues,
  courtZones,
  mayTriage,
  said,
  seen,
  onSaid,
  onSeen,
}: {
  row: PublicationRow;
  /** What ONE recorded of it since the list was read, while ONE reads it. */
  progress: PublicationProgress | null;
  acts: readonly DeadlineAct[];
  colleagues: readonly Colleague[];
  courtZones: Readonly<Record<string, CourtZones>>;
  mayTriage: boolean;
  /** What the person said of it since the list was read: kept by the screen, so it is one word wherever it shows. */
  said: Said | null;
  /** The person said they saw its cancelling since the list was read. */
  seen: boolean;
  onSaid: (said: Said) => void;
  onSeen: () => void;
}) {
  const t = useTranslations("product");
  const [pending, startTransition] = useTransition();
  const [changing, setChanging] = useState(false);
  const [note, setNote] = useState((said ? said.note : row.note) ?? "");
  const [noteOpen, setNoteOpen] = useState(Boolean(said ? said.note : row.note));
  const [error, setError] = useState<string | null>(null);
  const [full, setFull] = useState<{ text: string | null; truncated: boolean; failed: boolean } | null>(null);
  /** The form of a deadline counted from this publication, open; and what came of the last one sent. */
  const [counting, setCounting] = useState(false);
  const [counted, setCounted] = useState<string | null>(null);
  /** The form of a hearing written from this publication, open; and whether one was written since the list was read. */
  const [scheduling, setScheduling] = useState(false);
  const [scheduled, setScheduled] = useState(false);
  /** The reading in course of the whole text: one that was closed meanwhile shows nothing when it arrives. */
  const reading = useRef(0);
  const changeButton = useRef<HTMLButtonElement | null>(null);
  const moveFocus = useRef(false);

  const category = said ? said.category : row.category;
  const savedNote = said ? said.note : row.note;
  const deadlines = progress?.deadlines ?? row.deadlines;
  const hearings = progress?.hearings ?? row.hearings;
  /** What ONE read of what the publication set, or is reading now. */
  const readingNow = row.active
    ? readingOnCard(category, progress?.readings ?? row.readings, said?.reading ?? null, said?.at, progress?.readAt)
    : null;
  const leftToPerson = readingNow?.status === "unread" || readingNow?.status === "failed";
  /** What ONE left to a person was done since (a deadline, whatever became of it; a hearing, or its word): nothing more is asked. */
  const doneSince =
    readingNow?.kind === "deadline"
      ? deadlines.length > 0 || (progress?.anyDeadline ?? row.anyDeadline) || Boolean(counted)
      : hearings.length > 0 || (progress?.hearingSettled ?? row.hearingSettled) || scheduled;
  const readingWords =
    readingNow && !(leftToPerson && doneSince)
      ? t(readingStatusKey(readingNow), {
          reason: t(readingReasonKey(readingNow.reason)),
          advice: t(readingAdviceKey(readingNow.kind, readingNow.reason)),
        })
      : null;
  /** What ONE recorded from the publication stays where it is after its triage changed, and the card says so. */
  const staysWords = [
    category !== "prazo" && deadlines.some((deadline) => deadline.auto) ? t("publication-deadline-stays") : null,
    category !== "audiencia" && hearings.some((hearing) => hearing.auto && hearing.status === "scheduled")
      ? t("publication-hearing-stays")
      : null,
  ].filter(Boolean);
  const controls = mayTriage && row.active && (category === null || changing);

  // The answers leave the screen once one is given: the focus goes to what stands in their place.
  useEffect(() => {
    if (moveFocus.current && !controls) {
      moveFocus.current = false;
      changeButton.current?.focus();
    }
  }, [controls, category]);

  const triage = (chosen: PublicationCategory) =>
    startTransition(async () => {
      setError(null);
      try {
        const kept = note.trim() || null;
        const result = await triagePublication({ publicationId: row.id, category: chosen, note: kept });
        if (!result.ok) {
          setError(t(publicationErrorKey(result.code)));
          return;
        }
        moveFocus.current = true;
        onSaid({ category: chosen, note: kept, reading: result.reading ?? null, at: Date.now() });
        setChanging(false);
        // ONE reads what the publication set (0040): the card says so, and the form stays one click away.
        if (result.reading) return;
        // A publication that sets a time is counted right away, unless one of its deadlines already is.
        if (chosen === "prazo" && deadlines.length === 0 && !counted) setCounting(true);
        // One that sets a hearing of a lawsuit of the firm is written in the agenda right away, the same way.
        if (chosen === "audiencia" && row.proceedingId && hearings.length === 0 && !scheduled) setScheduling(true);
      } catch {
        setError(t("publication-error-failed"));
      }
    });

  const acknowledge = () =>
    startTransition(async () => {
      setError(null);
      try {
        const result = await acknowledgePublicationCancel(row.id);
        if (result.ok) onSeen();
        else setError(t(publicationErrorKey(result.code)));
      } catch {
        setError(t("publication-error-failed"));
      }
    });

  const readAll = async () => {
    const mine = reading.current + 1;
    reading.current = mine;
    setFull({ text: null, truncated: false, failed: false });
    let next: { text: string | null; truncated: boolean; failed: boolean };
    try {
      const result = await readPublication(row.id);
      next = result.ok
        ? { text: result.text, truncated: result.truncated, failed: false }
        : { text: null, truncated: false, failed: true };
    } catch {
      next = { text: null, truncated: false, failed: true };
    }
    // Closed, or asked again, while it was on its way: this answer is nobody's.
    if (reading.current === mine) setFull(next);
  };
  const closeFull = () => {
    reading.current += 1;
    setFull(null);
  };

  const headline = [row.court, row.kind, row.documentType].filter(Boolean).join(" · ");
  const titleId = `publication-${row.id}`;
  const answers = (
    <TriageAnswers
      current={category}
      pending={pending}
      note={note}
      noteOpen={noteOpen}
      noteChanged={(note.trim() || null) !== (savedNote ?? null)}
      onNote={setNote}
      onOpenNote={() => setNoteOpen(true)}
      onChoose={triage}
      onKeep={category !== null ? () => setChanging(false) : undefined}
      error={error}
    />
  );

  return (
    <Card component="article" aria-labelledby={titleId}>
      <CardContent className="flex flex-col gap-3">
        <Box className="flex flex-wrap items-start gap-3">
          <Box className="flex min-w-0 flex-1 flex-col gap-1">
            <Typography id={titleId} variant="subtitle2" component="h3" className="mb-0">
              {headline}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {[
                t("publication-available-on", { day: formatDayBr(row.availableOn) ?? row.availableOn }),
                t("publication-case-number", { number: row.cnj }),
                row.unit,
                row.className,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Typography>
          </Box>
          {!row.active ? <StatusChip tone="danger" label={t("publication-cancelled")} /> : null}
          {category ? <StatusChip tone={CATEGORY_TONE[category]} label={t(CATEGORY_KEY[category])} /> : null}
        </Box>

        <Box className="flex flex-wrap items-center gap-x-4 gap-y-1">
          {row.caseId ? (
            <Button
              variant="text"
              color="primary"
              size="small"
              href={`/casos/${row.caseId}`}
              LinkComponent={Link}
              className="-ml-2"
            >
              {row.caseSeq !== null
                ? t("publication-open-case", { label: caseLabel(row.caseSeq) })
                : t("publication-open-case-plain")}
            </Button>
          ) : (
            <Typography variant="body2" className="text-text-secondary">
              {t("publication-no-case")}
            </Typography>
          )}
          {row.lawyers.length > 0 ? (
            <Typography variant="body2" className="text-text-secondary">
              {t("publication-addressed-to", { names: row.lawyers.join(", ") })}
            </Typography>
          ) : null}
        </Box>

        {!row.active ? (
          <Alert
            severity="warning"
            className="neutral bg-background-paper/60!"
            action={
              row.cancelUnseen && !seen && mayTriage ? (
                <Button color="inherit" size="small" onClick={acknowledge} disabled={pending}>
                  {t("publication-cancel-seen-action")}
                </Button>
              ) : undefined
            }
          >
            {[
              row.cancelUnseen && !seen && category
                ? t("publication-cancel-unseen", { category: t(CATEGORY_KEY[category]) })
                : null,
              row.cancelReason ? t("publication-cancel-reason", { reason: row.cancelReason }) : null,
              row.cancelledLabel ? t("publication-cancelled-at", { when: row.cancelledLabel }) : null,
            ]
              .filter(Boolean)
              .join(" ") || t("publication-cancelled")}
          </Alert>
        ) : null}

        <Box className="flex flex-col gap-1">
          <Typography variant="body1" className="break-words">
            {row.head || t("publication-no-text")}
          </Typography>
          {row.tail ? (
            <>
              <Typography variant="body2" className="text-text-secondary" aria-hidden>
                {t("publication-text-gap")}
              </Typography>
              <Typography variant="body1" className="break-words">
                {row.tail}
              </Typography>
            </>
          ) : null}
          {row.truncated ? (
            <Typography variant="body2" className="text-text-secondary">
              {t("publication-truncated")}
            </Typography>
          ) : null}
        </Box>

        {readingWords && leftToPerson ? (
          <Alert severity="warning" className="neutral bg-background-paper/60!">
            {readingWords}
          </Alert>
        ) : readingWords ? (
          <Typography variant="body2" className="text-text-secondary" role="status">
            {readingWords}
          </Typography>
        ) : null}
        {staysWords.length > 0 ? (
          <Typography variant="body2" className="text-text-secondary">
            {staysWords.join(" ")}
          </Typography>
        ) : null}

        {hearings.length > 0 || scheduled ? (
          <Box className="flex flex-col gap-1" role="status">
            {hearings.map((hearing) => {
              const when = momentIn(hearing.startsAt, hearing.timeZone);
              // Brasília goes unsaid, as on the hearing's own card.
              const zoneWords =
                hearing.timeZone !== "America/Sao_Paulo" && isHearingZone(hearing.timeZone)
                  ? t(ZONE_KEY[hearing.timeZone])
                  : null;
              return (
                <Typography key={hearing.id} variant="body2">
                  {t("publication-hearing", {
                    day: when.day,
                    time: when.time,
                    status: t(HEARING_STATUS_KEY[hearing.status]),
                  })}
                  {zoneWords ? ` · ${zoneWords}` : ""}
                </Typography>
              );
            })}
            {scheduled && hearings.length === 0 ? (
              <Typography variant="body2">{t("hearing-scheduled-notice")}</Typography>
            ) : null}
          </Box>
        ) : null}

        {deadlines.length > 0 || counted ? (
          <Box className="flex flex-col gap-1" role="status">
            {deadlines.map((deadline) => (
              <Typography key={deadline.id} variant="body2">
                {deadline.urgentOn
                  ? t("publication-deadline", {
                      title: deadline.title,
                      day: formatDayBr(deadline.urgentOn) ?? deadline.urgentOn,
                      status: t(DEADLINE_STATUS_KEY[deadline.status]),
                    })
                  : t("publication-deadline-counting", { title: deadline.title })}
              </Typography>
            ))}
            {counted ? <Typography variant="body2">{counted}</Typography> : null}
          </Box>
        ) : null}

        <Box className="flex flex-wrap gap-2">
          {mayTriage && row.active ? (
            <Button variant="outlined" color="grey" size="small" onClick={() => setCounting(true)}>
              {t("publication-deadline-action")}
            </Button>
          ) : null}
          {deadlines.length > 0 ? (
            <Button variant="text" color="grey" size="small" href="/prazos" LinkComponent={Link}>
              {t("publication-deadline-see")}
            </Button>
          ) : null}
          {mayTriage && row.active && row.proceedingId && category === "audiencia" ? (
            <Button variant="outlined" color="grey" size="small" onClick={() => setScheduling(true)}>
              {t("publication-hearing-action")}
            </Button>
          ) : null}
          {hearings.length > 0 || scheduled ? (
            <Button variant="text" color="grey" size="small" href="/agenda" LinkComponent={Link}>
              {t("publication-hearing-see")}
            </Button>
          ) : null}
          {row.tail || row.truncated ? (
            <Button variant="outlined" color="grey" size="small" onClick={readAll}>
              {t("publication-read-all")}
            </Button>
          ) : null}
          {row.link ? (
            <Button
              variant="text"
              color="grey"
              size="small"
              href={row.link}
              target="_blank"
              rel="noopener noreferrer nofollow"
            >
              {t("publication-open-court")}
            </Button>
          ) : null}
          <Button
            variant="text"
            color="grey"
            size="small"
            href={row.certificateUrl}
            target="_blank"
            rel="noopener noreferrer nofollow"
          >
            {t("publication-certificate")}
          </Button>
        </Box>

        {row.byAi && row.reviewDue && !said && category && !controls && row.active ? (
          <Alert
            severity="info"
            className="neutral bg-background-paper/60!"
            action={
              mayTriage ? (
                <Button color="inherit" size="small" disabled={pending} onClick={() => triage(category)}>
                  {t("publication-by-ai-confirm")}
                </Button>
              ) : undefined
            }
          >
            {t("publication-by-ai-review", { category: t(CATEGORY_KEY[category]) })}
          </Alert>
        ) : null}

        {category && !controls ? (
          <Box className="border-grey-100 flex flex-wrap items-center gap-3 border-t pt-3">
            <Typography variant="body2" className="text-text-secondary min-w-0 flex-1" role="status">
              {[
                said
                  ? t("publication-triage-done", { category: t(CATEGORY_KEY[category]) })
                  : row.byAi && row.triagedLabel
                    ? // What ONE classified may be wrong, until a person checked it.
                      row.reviewedBy
                      ? t("publication-by-ai", { when: row.triagedLabel })
                      : [t("publication-by-ai", { when: row.triagedLabel }), t("publication-one-may-err")].join(" · ")
                    : row.triagedBy && row.triagedLabel
                      ? t("publication-triaged-by", { name: row.triagedBy, when: row.triagedLabel })
                      : row.triagedLabel
                        ? t("publication-triaged-at", { when: row.triagedLabel })
                        : null,
                !said && row.reviewedBy && row.reviewedLabel
                  ? t("publication-reviewed-by", { name: row.reviewedBy, when: row.reviewedLabel })
                  : null,
                savedNote,
              ]
                .filter(Boolean)
                .join(" · ")}
            </Typography>
            {mayTriage && row.active ? (
              <Button ref={changeButton} variant="text" color="grey" size="small" onClick={() => setChanging(true)}>
                {t("publication-change")}
              </Button>
            ) : null}
          </Box>
        ) : null}

        {controls && !full ? <Box className="border-grey-100 border-t pt-3">{answers}</Box> : null}
        {!controls && error ? (
          <Alert severity="error" className="neutral bg-background-paper/60!">
            {error}
          </Alert>
        ) : null}
      </CardContent>

      {scheduling && row.proceedingId ? (
        <HearingDialog
          subject={{
            proceedingId: row.proceedingId,
            lawsuitLabel: [row.caseSeq !== null ? caseLabel(row.caseSeq) : null, row.cnj, row.court]
              .filter(Boolean)
              .join(" · "),
            publicationId: row.id,
            zones: row.court ? (courtZones[row.court] ?? null) : null,
          }}
          colleagues={colleagues}
          onClose={() => setScheduling(false)}
          onSaved={() => {
            setScheduling(false);
            setScheduled(true);
          }}
        />
      ) : null}

      {counting ? (
        <DeadlineDialog
          subject={{
            kind: "publication",
            publicationId: row.id,
            availableOn: row.availableOn,
            proceedingKind: row.proceedingKind,
          }}
          existing={deadlines.map((deadline) => deadline.title)}
          acts={acts}
          onClose={() => setCounting(false)}
          onSaved={(saved) => {
            setCounting(false);
            setCounted(
              saved.dueOn
                ? t("deadline-proposed-notice", { day: formatDayBr(saved.dueOn) ?? saved.dueOn })
                : t("deadline-proposed-notice-counting"),
            );
          }}
        />
      ) : null}

      {full ? (
        <Dialog open onClose={closeFull} aria-labelledby={`${titleId}-full`} maxWidth="md" fullWidth>
          <DialogHeader
            id={`${titleId}-full`}
            title={headline}
            onClose={closeFull}
            closeLabel={t("publication-close")}
          />
          <DialogContent className="flex flex-col gap-4">
            {full.failed ? (
              <Alert severity="error" className="neutral bg-background-paper/60!">
                {t("publication-read-all-error")}
              </Alert>
            ) : full.text === null ? (
              <Box className="flex justify-center py-10">
                <CircularProgress aria-label={t("publication-read-all-loading")} />
              </Box>
            ) : (
              <>
                {full.truncated ? (
                  <Alert severity="info" className="neutral bg-background-paper/60!">
                    {t("publication-truncated")}
                  </Alert>
                ) : null}
                <Typography variant="body1" component="div" className="break-words whitespace-pre-line">
                  {full.text}
                </Typography>
              </>
            )}
            {/* Who read the whole text says what it is right there. */}
            {controls ? <Box className="border-grey-100 border-t pt-3">{answers}</Box> : null}
          </DialogContent>
        </Dialog>
      ) : null}
    </Card>
  );
}

/**
 * The six answers, with the note that may go with one. The note is written
 * before the answer is chosen, because choosing is what saves; on a
 * publication already triaged, the note alone is saved with the word it has.
 */
function TriageAnswers({
  current,
  pending,
  note,
  noteOpen,
  noteChanged,
  onNote,
  onOpenNote,
  onChoose,
  onKeep,
  error,
}: {
  current: PublicationCategory | null;
  pending: boolean;
  note: string;
  noteOpen: boolean;
  noteChanged: boolean;
  onNote: (value: string) => void;
  onOpenNote: () => void;
  onChoose: (category: PublicationCategory) => void;
  /** Leaves the publication as it is: only when it already has a word. */
  onKeep?: () => void;
  error: string | null;
}) {
  const t = useTranslations("product");
  return (
    <Box className="flex flex-col gap-3">
      {noteOpen ? (
        <TextField
          size="small"
          label={t("publication-note-label")}
          helperText={t("publication-note-help")}
          value={note}
          onChange={(event) => onNote(event.target.value.slice(0, 1000))}
          disabled={pending}
          fullWidth
        />
      ) : null}
      <Typography variant="body2" className="text-text-secondary">
        {t("publication-triage-question")}
      </Typography>
      <Box className="flex flex-wrap gap-2" role="group" aria-label={t("publication-triage-question")}>
        {PUBLICATION_CATEGORIES.map((category) => (
          <Button
            key={category}
            variant={current === category ? "contained" : "outlined"}
            color={current === category ? "primary" : "grey"}
            size="small"
            aria-pressed={current === category}
            disabled={pending}
            onClick={() => onChoose(category)}
          >
            {t(CATEGORY_KEY[category])}
          </Button>
        ))}
      </Box>
      <Box className="flex flex-wrap gap-2">
        {!noteOpen ? (
          <Button variant="text" color="grey" size="small" disabled={pending} onClick={onOpenNote}>
            {t("publication-note-add")}
          </Button>
        ) : null}
        {current !== null && noteOpen && noteChanged ? (
          <Button variant="outlined" color="grey" size="small" disabled={pending} onClick={() => onChoose(current)}>
            {t("publication-note-save")}
          </Button>
        ) : null}
        {onKeep ? (
          <Button variant="text" color="grey" size="small" disabled={pending} onClick={onKeep}>
            {t("publication-change-cancel")}
          </Button>
        ) : null}
      </Box>
      {error ? (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {error}
        </Alert>
      ) : null}
    </Box>
  );
}
