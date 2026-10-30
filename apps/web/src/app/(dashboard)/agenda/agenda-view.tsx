"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";

import { Alert, Box, Button, Card, CardContent, Grid, Typography } from "@mui/material";

import HearingCard from "@/components/hearings/hearing-card";
import HearingDialog from "@/components/hearings/hearing-dialog";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import EmptyState from "@/components/product/empty-state";
import { StatTile } from "@/components/product/home-tiles";
import ModuleScope from "@/components/product/module-scope";
import PageHeader from "@/components/product/page-header";
import type { TileTone } from "@/components/product/tile-tone";
import NiCalendar from "@/icons/nexture/ni-calendar";
import NiCalendarClock from "@/icons/nexture/ni-calendar-clock";
import NiCheckSquare from "@/icons/nexture/ni-check-square";
import NiCrossSquare from "@/icons/nexture/ni-cross-square";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiExclamationSquare from "@/icons/nexture/ni-exclamation-square";
import NiInbox from "@/icons/nexture/ni-inbox";
import NiUsers from "@/icons/nexture/ni-users";
import { caseLabel } from "@/lib/cases/cases";
import { retryHearingSyncs } from "@/lib/hearings/actions";
import type {
  Colleague,
  HearingsData,
  PublicationsWithoutHearing,
  PublicationWithoutHearing,
} from "@/lib/hearings/facts";
import { agendaAddress, type CourtZones, HEARING_VIEWS, type HearingView, VIEW_KEY } from "@/lib/hearings/hearings";
import { type PageScope, scopeCrumbs } from "@/lib/modules/offer";
import { settlePublicationHearing } from "@/lib/publications/actions";
import { readingAdviceKey, readingReasonKey, readingStatusKey, settleErrorKey } from "@/lib/publications/reading-words";
import { formatDayBr } from "@flyee/rules/person";

export type AgendaState =
  | {
      kind: "ready";
      view: HearingView;
      data: HearingsData;
      colleagues: Colleague[];
      /**
       * Publications triaged as a hearing that still owe it: what ONE left to a person, too. Null when they could
       * not be read: the agenda still shows, and says so.
       */
      unwritten: PublicationsWithoutHearing | null;
      /** The zones of each court, for the zone a hearing written from a publication is said in. */
      courtZones: Readonly<Record<string, CourtZones>>;
      /** The person writes hearings and says what came of them: who signs, or runs the deadlines. */
      mayWork: boolean;
      /** The person manages the firm: the calendar in Google is connected by them. */
      managesFirm: boolean;
      /** A calendar can be connected in this environment (Google's client, or the fake). */
      calendarAvailable: boolean;
      /** The modules of the firm, and the one the page is under (0078). */
      scope: PageScope;
    }
  | { kind: "no-firm" }
  | { kind: "unavailable" }
  | { kind: "error" };

const VIEW_LOOK: Record<HearingView, { tone: TileTone; icon: React.ReactNode }> = {
  proximas: { tone: "primary", icon: <NiCalendarClock size="large" /> },
  sem_resultado: { tone: "accent-3", icon: <NiExclamationSquare size="large" /> },
  realizadas: { tone: "secondary", icon: <NiCheckSquare size="large" /> },
  canceladas: { tone: "accent-4", icon: <NiCrossSquare size="large" /> },
};

const PROBLEM_KEY: Record<string, string> = {
  auth: "agenda-calendar-lost-auth",
  gone: "agenda-calendar-lost-gone",
  expired: "agenda-calendar-lost-expired",
};

/**
 * The firm's hearings. Whoever works the lawsuits comes here to see what is
 * coming, who goes and how, and to say what came of the ones that passed:
 * success is every hearing to come with somebody to attend it, and none
 * past its time with no word on it. So it opens on what is coming, the
 * nearest first; the ones with no word on them are a click on their count,
 * and said first when there are any. A hearing is written from its case or
 * from the publication that set it, never here. The firm's calendar in
 * Google, when connected, takes every hearing by itself.
 */
export default function AgendaView({ state }: { state: AgendaState }) {
  const t = useTranslations("product");
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  const [retrying, setRetrying] = useState(false);
  const [retryFailed, setRetryFailed] = useState(false);
  const ready = state.kind === "ready" ? state : null;
  const data = ready?.data ?? null;
  // Under a module (0078), every list and page of the screen stays under it.
  const module = ready?.scope.current?.key ?? null;
  const total = data ? HEARING_VIEWS.reduce((sum, view) => sum + data.counts[view], 0) : 0;
  // In any list and page: what the calendar refused is offered again wherever the person is.
  const failing = (data?.calendarFailed ?? 0) > 0;
  const otherView: HearingView = ready?.view === "proximas" ? "sem_resultado" : "proximas";
  const otherKey = otherView === "sem_resultado" ? "agenda-empty-see-unresolved" : "agenda-empty-see-next";

  const retry = async () => {
    setRetrying(true);
    setRetryFailed(false);
    try {
      const result = await retryHearingSyncs();
      if (result.ok) refresh();
      else setRetryFailed(true);
    } catch {
      setRetryFailed(true);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title={t("agenda-title")}
        crumbs={scopeCrumbs(t("approvals-home"), t("agenda-title"), ready?.scope.current ?? null)}
        description={ready ? t("agenda-description") : undefined}
      />
      {ready ? (
        <ModuleScope
          path="/agenda"
          modules={ready.scope.modules}
          current={module}
          keep={{ ver: ready.view === "proximas" ? null : ready.view }}
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
            <Button color="inherit" size="small" onClick={refresh}>
              {t("approvals-retry")}
            </Button>
          }
        >
          {t("agenda-load-error")}
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

      {ready && data ? (
        data.calendar?.status === "lost" ? (
          <Alert
            severity="warning"
            className="neutral bg-background-paper/60!"
            action={
              ready.managesFirm ? (
                <Button color="inherit" size="small" href="/settings/connections" LinkComponent={Link}>
                  {t("agenda-calendar-fix")}
                </Button>
              ) : undefined
            }
          >
            {t(PROBLEM_KEY[data.calendar.problem ?? ""] ?? "agenda-calendar-lost-auth")}
          </Alert>
        ) : data.calendar ? (
          <Typography variant="body2" className="text-text-secondary">
            {t("agenda-calendar-active", { name: data.calendar.name })}
          </Typography>
        ) : ready.managesFirm && ready.calendarAvailable ? (
          <Alert
            severity="info"
            className="neutral bg-background-paper/60!"
            action={
              <Button color="inherit" size="small" href="/settings/connections" LinkComponent={Link}>
                {t("agenda-calendar-connect")}
              </Button>
            }
          >
            {t("agenda-calendar-none")}
          </Alert>
        ) : null
      ) : null}

      {ready && ready.unwritten === null ? (
        <Alert
          severity="warning"
          className="neutral bg-background-paper/60!"
          action={
            <Button color="inherit" size="small" onClick={refresh}>
              {t("approvals-retry")}
            </Button>
          }
        >
          {t("agenda-unwritten-load-error")}
        </Alert>
      ) : null}
      {ready && ready.unwritten && ready.unwritten.total > 0 ? (
        <UnwrittenCard
          unwritten={ready.unwritten}
          colleagues={ready.colleagues}
          courtZones={ready.courtZones}
          mayWork={ready.mayWork}
          onChanged={refresh}
        />
      ) : null}

      {ready && data && total === 0 ? (
        <EmptyState
          icon={<NiCalendar size="large" />}
          title={t("agenda-first-title")}
          description={t("agenda-first-body")}
          action={{ label: t("agenda-first-action"), href: "/casos" }}
          secondaryAction={{ label: t("agenda-first-publications"), href: "/publicacoes" }}
        />
      ) : null}

      {ready && data && total > 0 ? (
        <>
          <Grid container spacing={2.5}>
            {HEARING_VIEWS.map((view) => (
              <Grid key={view} size={{ xs: 12, sm: 6, lg: "grow" }}>
                <StatTile
                  onClick={() => router.push(agendaAddress(view, 0, module))}
                  pressed={ready.view === view}
                  icon={VIEW_LOOK[view].icon}
                  tone={VIEW_LOOK[view].tone}
                  label={t(VIEW_KEY[view].label)}
                  hint={
                    view === "proximas" && data.soonCount > 0
                      ? t("agenda-view-next-hint-soon", { count: data.soonCount, days: data.soonDays })
                      : t(VIEW_KEY[view].hint)
                  }
                  value={data.counts[view]}
                />
              </Grid>
            ))}
          </Grid>

          {!ready.mayWork ? (
            <Typography variant="body2" className="text-text-secondary">
              {t("agenda-read-only")}
            </Typography>
          ) : null}

          {failing && ready.mayWork ? (
            <Alert
              severity="warning"
              className="neutral bg-background-paper/60!"
              action={
                <Button color="inherit" size="small" disabled={retrying} onClick={() => void retry()}>
                  {t("agenda-calendar-retry")}
                </Button>
              }
            >
              {retryFailed ? t("agenda-calendar-retry-failed") : t("agenda-calendar-failed")}
            </Alert>
          ) : null}

          {data.rows.length === 0 ? (
            <EmptyState
              icon={<NiInbox size="large" />}
              title={t(VIEW_KEY[ready.view].emptyTitle)}
              description={t(VIEW_KEY[ready.view].emptyBody)}
              action={{ label: t(otherKey), href: agendaAddress(otherView, 0, module) }}
            />
          ) : (
            <Box component="ul" className="m-0 flex list-none flex-col gap-4 p-0">
              {data.rows.map((row) => (
                <Box component="li" key={`${row.id}:${row.revision}:${row.status}`}>
                  <HearingCard
                    row={row}
                    now={data.now}
                    durationMinutes={data.durationMinutes}
                    colleagues={ready.colleagues}
                    mayWork={ready.mayWork}
                    onChanged={refresh}
                  />
                </Box>
              ))}
            </Box>
          )}

          {data.page > 0 || data.more ? (
            <Box className="flex flex-wrap items-center gap-3">
              <Typography variant="body2" className="text-text-secondary min-w-0 flex-1">
                {t("agenda-page", { page: data.page + 1 })}
              </Typography>
              {data.page > 0 ? (
                <Button
                  variant="outlined"
                  color="grey"
                  href={agendaAddress(ready.view, data.page - 1, module)}
                  LinkComponent={Link}
                >
                  {t("agenda-page-previous")}
                </Button>
              ) : null}
              {data.more ? (
                <Button
                  variant="outlined"
                  color="grey"
                  href={agendaAddress(ready.view, data.page + 1, module)}
                  LinkComponent={Link}
                >
                  {t("agenda-page-next")}
                </Button>
              ) : null}
            </Box>
          ) : null}
        </>
      ) : null}
    </Box>
  );
}

/**
 * The publications triaged as a hearing that still owe it: what ONE left to
 * a person (with why and what to do), what ONE could not read in time, what
 * a person triaged and did not write, and what is of a lawsuit not in ONE
 * yet. Each is one click from the form that writes its hearing, or from
 * saying it needs nothing more in the agenda (it is there already, or the
 * publication moved or cancelled one that is). Success is this card gone: no
 * hearing a court set is lost between its publication and the agenda.
 *
 * Closest component: the card of the publications triaged as a deadline in
 * `/prazos` (`UntimedCard`), whose rows and form it follows.
 */
function UnwrittenCard({
  unwritten,
  colleagues,
  courtZones,
  mayWork,
  onChanged,
}: {
  unwritten: PublicationsWithoutHearing;
  colleagues: readonly Colleague[];
  courtZones: Readonly<Record<string, CourtZones>>;
  mayWork: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const [writing, setWriting] = useState<PublicationWithoutHearing | null>(null);
  const [settling, setSettling] = useState<PublicationWithoutHearing | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  return (
    <Card component="section" id="sem-audiencia" aria-labelledby="agenda-unwritten">
      <CardContent className="flex flex-col gap-3">
        <Box className="flex items-center gap-2">
          <NiDocumentFull size="medium" className="text-accent-3" />
          <Typography id="agenda-unwritten" variant="h5" component="h2" className="mb-0">
            {t("agenda-unwritten-title", { count: unwritten.total })}
          </Typography>
        </Box>
        <Typography variant="body2" className="text-text-secondary">
          {t(mayWork ? "agenda-unwritten-body" : "agenda-unwritten-body-read-only", { days: unwritten.watchDays })}
        </Typography>
        {notice ? (
          <Alert severity="success" className="neutral bg-background-paper/60!" onClose={() => setNotice(null)}>
            {notice}
          </Alert>
        ) : null}
        <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
          {unwritten.rows.map((row) => {
            const left = row.reading && (row.reading.status === "unread" || row.reading.status === "failed");
            // A lawsuit not in court is said by the line of the lawsuit, as it is now: the reading's reason may be older.
            const readingWords =
              row.reading && row.reading.reason !== "not_filed"
                ? t(readingStatusKey(row.reading), {
                    reason: t(readingReasonKey(row.reading.reason)),
                    advice: t(readingAdviceKey(row.reading.kind, row.reading.reason)),
                  })
                : null;
            return (
              <Box
                component="li"
                key={row.id}
                className="border-grey-100 flex flex-wrap items-start gap-3 border-t pt-3 first:border-t-0 first:pt-0"
              >
                <Box className="flex min-w-0 flex-1 flex-col gap-1">
                  <Typography variant="body2" className="font-semibold">
                    {[
                      row.caseSeq !== null ? caseLabel(row.caseSeq) : null,
                      row.cnj,
                      row.court,
                      t("agenda-unwritten-day", { day: formatDayBr(row.availableOn) ?? row.availableOn }),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Typography>
                  {row.head ? (
                    <Typography variant="body2" className="text-text-secondary line-clamp-2">
                      {row.head}
                    </Typography>
                  ) : null}
                  {readingWords && left ? (
                    <Alert severity="warning" className="neutral bg-background-paper/60!">
                      {readingWords}
                    </Alert>
                  ) : readingWords ? (
                    <Typography variant="body2">{readingWords}</Typography>
                  ) : null}
                  {!row.proceedingId ? (
                    <Typography variant="body2" className="text-text-secondary">
                      {t("agenda-unwritten-no-lawsuit")}
                    </Typography>
                  ) : !row.lawsuitFiled ? (
                    <Typography variant="body2" className="text-text-secondary">
                      {t("agenda-unwritten-not-filed")}
                    </Typography>
                  ) : null}
                  {row.triagedLabel ? (
                    <Typography variant="caption" className="text-text-secondary">
                      {row.triagedBy
                        ? t("agenda-unwritten-triaged-by", { name: row.triagedBy, when: row.triagedLabel })
                        : t("agenda-unwritten-triaged", { when: row.triagedLabel })}
                    </Typography>
                  ) : null}
                </Box>
                <Box className="flex flex-wrap gap-2">
                  {mayWork && row.proceedingId && row.lawsuitFiled ? (
                    <Button
                      variant="contained"
                      size="small"
                      aria-label={t("agenda-unwritten-action-label", { lawsuit: row.cnj })}
                      onClick={() => setWriting(row)}
                    >
                      {t("agenda-unwritten-action")}
                    </Button>
                  ) : null}
                  {mayWork ? (
                    <Button
                      variant="outlined"
                      color="grey"
                      size="small"
                      aria-label={t("agenda-unwritten-settle-label", { lawsuit: row.cnj })}
                      onClick={() => setSettling(row)}
                    >
                      {t("agenda-unwritten-settle")}
                    </Button>
                  ) : null}
                  {row.caseId ? (
                    <Button
                      variant="text"
                      color="grey"
                      size="small"
                      href={`/casos/${row.caseId}`}
                      LinkComponent={Link}
                      aria-label={t("agenda-unwritten-open-case-label", { lawsuit: row.cnj })}
                    >
                      {t("hearing-open-case")}
                    </Button>
                  ) : null}
                </Box>
              </Box>
            );
          })}
        </Box>
        {unwritten.total > unwritten.rows.length ? (
          <Typography variant="body2" className="text-text-secondary">
            {t("agenda-unwritten-more", { count: unwritten.total - unwritten.rows.length })}
          </Typography>
        ) : null}
      </CardContent>
      {writing && writing.proceedingId ? (
        <HearingDialog
          subject={{
            proceedingId: writing.proceedingId,
            lawsuitLabel: [writing.caseSeq !== null ? caseLabel(writing.caseSeq) : null, writing.cnj, writing.court]
              .filter(Boolean)
              .join(" · "),
            publicationId: writing.id,
            zones: writing.court ? (courtZones[writing.court] ?? null) : null,
          }}
          colleagues={colleagues}
          onClose={() => setWriting(null)}
          onSaved={() => {
            setWriting(null);
            onChanged();
          }}
        />
      ) : null}
      {settling ? (
        <ConfirmActionDialog
          title={t("agenda-unwritten-settle-title")}
          intro={[settling.cnj, settling.court].filter(Boolean).join(" · ")}
          consequences={[t("agenda-unwritten-settle-consequence-1"), t("agenda-unwritten-settle-consequence-2")]}
          staysTitle={t("agenda-unwritten-settle-stays-title")}
          stays={[t("agenda-unwritten-settle-stays-1"), t("agenda-unwritten-settle-stays-2")]}
          requireReason={false}
          confirmLabel={t("agenda-unwritten-settle-confirm")}
          cancelLabel={t("agenda-unwritten-settle-cancel")}
          busyLabel={t("agenda-unwritten-settle-busy")}
          onConfirm={async () => {
            try {
              const result = await settlePublicationHearing(settling.id);
              if (!result.ok) {
                // A publication cancelled or triaged as something else since asks for nothing here: the list is read again.
                if (result.code === "cancelled" || result.code === "invalid_category") onChanged();
                return t(settleErrorKey(result.code));
              }
              setNotice(t("agenda-unwritten-settled"));
              onChanged();
              return null;
            } catch {
              return t("agenda-unwritten-settle-error-failed");
            }
          }}
          onClose={() => setSettling(null)}
        />
      ) : null}
    </Card>
  );
}
