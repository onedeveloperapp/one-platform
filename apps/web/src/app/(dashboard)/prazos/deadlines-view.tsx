"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useState } from "react";

import { Alert, Box, Button, Card, CardContent, Grid, Typography } from "@mui/material";

import DeadlineCard from "@/components/deadlines/deadline-card";
import DeadlinePanel from "@/components/deadlines/deadline-panel";
import EmptyState from "@/components/product/empty-state";
import { StatTile } from "@/components/product/home-tiles";
import ModuleScope from "@/components/product/module-scope";
import PageHeader from "@/components/product/page-header";
import type { TileTone } from "@/components/product/tile-tone";
import IllustrationConfigure from "@/icons/illustrations/illustration-configure";
import NiCalendarClock from "@/icons/nexture/ni-calendar-clock";
import NiCheckSquare from "@/icons/nexture/ni-check-square";
import NiClock from "@/icons/nexture/ni-clock";
import NiDocumentFull from "@/icons/nexture/ni-document-full";
import NiExclamationSquare from "@/icons/nexture/ni-exclamation-square";
import NiListCheck from "@/icons/nexture/ni-list-check";
import NiUsers from "@/icons/nexture/ni-users";
import { caseLabel } from "@/lib/cases/cases";
import { linkDeadlinePublication } from "@/lib/deadlines/actions";
import {
  DEADLINE_VIEWS,
  deadlineErrorKey,
  deadlinesAddress,
  type DeadlineView,
  VIEW_KEY,
} from "@/lib/deadlines/deadlines";
import type {
  DeadlineAct,
  DeadlinesData,
  PublicationsWithoutDeadline,
  PublicationWithoutDeadline,
} from "@/lib/deadlines/facts";
import { type PageScope, scopeCrumbs } from "@/lib/modules/offer";
import { readingAdviceKey, readingReasonKey, readingStatusKey } from "@/lib/publications/reading-words";
import { formatDayBr } from "@flyee/rules/person";

export type DeadlinesState =
  | {
      kind: "ready";
      view: DeadlineView;
      data: DeadlinesData;
      acts: DeadlineAct[];
      /** Publications triaged as a deadline that no deadline came from: shown before the lists. */
      untimed: PublicationsWithoutDeadline;
      /** The person confirms deadlines: a partner or the controladoria. */
      mayConfirm: boolean;
      /** The person proposes, corrects, completes and dismisses them. */
      mayWork: boolean;
      /** The modules of the firm, and the one the page is under (0078). */
      scope: PageScope;
    }
  | { kind: "no-firm" }
  | { kind: "unavailable" }
  | { kind: "error" };

const VIEW_LOOK: Record<DeadlineView, { tone: TileTone; icon: React.ReactNode }> = {
  confirmar: { tone: "accent-3", icon: <NiListCheck size="large" /> },
  proximos: { tone: "primary", icon: <NiCalendarClock size="large" /> },
  vencidos: { tone: "accent-3", icon: <NiClock size="large" /> },
  rever: { tone: "accent-4", icon: <NiExclamationSquare size="large" /> },
  concluidos: { tone: "secondary", icon: <NiCheckSquare size="large" /> },
};

/**
 * The firm's deadlines. Who runs them (the controladoria, a partner) opens
 * this every day to confirm what the rule counted and to see what is due:
 * success is nothing waiting to be confirmed and nothing past its day. So it
 * opens on what waits for confirmation, each deadline with its day, how it
 * was counted and what the count could not know, the confirmation one click
 * away; the other lists are a click on their count. A deadline is born from
 * a publication or from a lawsuit of a case, never here; but a publication
 * somebody triaged as a deadline and no deadline came from is shown here,
 * with the count of its deadline one click away, so none is lost between the
 * two steps.
 */
export default function DeadlinesView({ state }: { state: DeadlinesState }) {
  const t = useTranslations("product");
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  const ready = state.kind === "ready" ? state : null;
  const data = ready?.data ?? null;
  // Under a module (0078), every list and page of the screen stays under it.
  const module = ready?.scope.current?.key ?? null;
  const total = data ? data.counts.confirmar + data.counts.proximos + data.counts.vencidos + data.counts.concluidos : 0;

  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title={t("deadlines-title")}
        crumbs={scopeCrumbs(t("approvals-home"), t("deadlines-title"), ready?.scope.current ?? null)}
        description={ready ? t("deadlines-description") : undefined}
      />
      {ready ? (
        <ModuleScope
          path="/prazos"
          modules={ready.scope.modules}
          current={module}
          keep={{ ver: ready.view === "confirmar" ? null : ready.view }}
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
          {t("deadlines-load-error")}
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

      {ready && ready.untimed.total > 0 ? (
        <UntimedCard untimed={ready.untimed} acts={ready.acts} mayWork={ready.mayWork} onChanged={refresh} />
      ) : null}

      {ready && data && total === 0 && data.counts.rever === 0 && ready.untimed.total === 0 ? (
        <EmptyState
          illustration={<IllustrationConfigure />}
          title={t("deadlines-first-title")}
          description={t("deadlines-first-body")}
          action={{ label: t("deadlines-first-action"), href: "/publicacoes" }}
          secondaryAction={{ label: t("deadlines-first-cases"), href: "/casos" }}
        />
      ) : null}

      {ready && data && (total > 0 || data.counts.rever > 0) ? (
        <>
          <Grid container spacing={2.5}>
            {DEADLINE_VIEWS.map((view) => (
              <Grid key={view} size={{ xs: 12, sm: 6, lg: "grow" }}>
                <StatTile
                  onClick={() => router.push(deadlinesAddress(view, 0, module))}
                  pressed={ready.view === view}
                  icon={VIEW_LOOK[view].icon}
                  tone={VIEW_LOOK[view].tone}
                  label={t(VIEW_KEY[view].label)}
                  hint={
                    view === "proximos" && data.soonCount > 0
                      ? t("deadlines-view-next-hint-soon", { count: data.soonCount, days: data.soonDays })
                      : t(VIEW_KEY[view].hint)
                  }
                  value={data.counts[view]}
                />
              </Grid>
            ))}
          </Grid>

          {!ready.mayWork ? (
            <Typography variant="body2" className="text-text-secondary">
              {t("deadlines-read-only")}
            </Typography>
          ) : !ready.mayConfirm && ready.view === "confirmar" ? (
            <Typography variant="body2" className="text-text-secondary">
              {t("deadlines-confirm-note")}
            </Typography>
          ) : null}

          {data.rows.length === 0 ? (
            <EmptyState
              illustration={<IllustrationConfigure />}
              title={t(VIEW_KEY[ready.view].emptyTitle)}
              description={t(VIEW_KEY[ready.view].emptyBody)}
              action={
                ready.view === "confirmar"
                  ? { label: t("deadlines-empty-see-next"), href: deadlinesAddress("proximos", 0, module) }
                  : { label: t("deadlines-empty-see-confirm"), href: deadlinesAddress("confirmar", 0, module) }
              }
            />
          ) : (
            <Box component="ul" className="m-0 flex list-none flex-col gap-4 p-0">
              {data.rows.map((row) => (
                <Box component="li" key={`${row.id}:${row.revision}:${row.status}`}>
                  <DeadlineCard
                    row={row}
                    today={data.today}
                    soonDays={data.soonDays}
                    acts={ready.acts}
                    mayConfirm={ready.mayConfirm}
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
                {t("deadlines-page", { page: data.page + 1 })}
              </Typography>
              {data.page > 0 ? (
                <Button
                  variant="outlined"
                  color="grey"
                  href={deadlinesAddress(ready.view, data.page - 1, module)}
                  LinkComponent={Link}
                >
                  {t("deadlines-page-previous")}
                </Button>
              ) : null}
              {data.more ? (
                <Button
                  variant="outlined"
                  color="grey"
                  href={deadlinesAddress(ready.view, data.page + 1, module)}
                  LinkComponent={Link}
                >
                  {t("deadlines-page-next")}
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
 * The publications somebody of the firm triaged as a deadline, in the last
 * days, that no deadline came from: a time runs in each, and nothing else
 * says so. Each is one click from the count of its deadline.
 *
 * Closest component: the card of a publication in `/publicacoes`, whose
 * "Calcular prazo" opens the same form; here only what tells one apart is
 * shown (its lawsuit, its day, the start of its text).
 */
function UntimedCard({
  untimed,
  acts,
  mayWork,
  onChanged,
}: {
  untimed: PublicationsWithoutDeadline;
  acts: readonly DeadlineAct[];
  mayWork: boolean;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const [counting, setCounting] = useState<PublicationWithoutDeadline | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const link = async (publicationId: string, deadlineId: string) => {
    setBusy(true);
    setError(null);
    try {
      const result = await linkDeadlinePublication({ deadlineId, publicationId });
      if (!result.ok) {
        setError(t(deadlineErrorKey(result.code)));
        return;
      }
      onChanged();
    } catch {
      setError(t("deadline-error-failed"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card component="section" id="sem-prazo" aria-labelledby="deadlines-untimed">
      <CardContent className="flex flex-col gap-3">
        <Box className="flex items-center gap-2">
          <NiDocumentFull size="medium" className="text-accent-3" />
          <Typography id="deadlines-untimed" variant="h5" component="h2" className="mb-0">
            {t("deadlines-untimed-title", { count: untimed.total })}
          </Typography>
        </Box>
        <Typography variant="body2" className="text-text-secondary">
          {t("deadlines-untimed-body", { days: untimed.watchDays })}
        </Typography>
        <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
          {untimed.rows.map((row) => (
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
                    t("deadlines-untimed-day", { day: formatDayBr(row.availableOn) ?? row.availableOn }),
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Typography>
                {row.head ? (
                  <Typography variant="body2" className="text-text-secondary line-clamp-2">
                    {row.head}
                  </Typography>
                ) : null}
                {row.reading ? (
                  <Typography variant="body2">
                    {t(readingStatusKey(row.reading), {
                      reason: t(readingReasonKey(row.reading.reason)),
                      advice: t(readingAdviceKey(row.reading.kind, row.reading.reason)),
                    })}
                  </Typography>
                ) : null}
                {row.triagedLabel ? (
                  <Typography variant="caption" className="text-text-secondary">
                    {row.triagedBy
                      ? t("deadlines-untimed-triaged-by", { name: row.triagedBy, when: row.triagedLabel })
                      : t("deadlines-untimed-triaged", { when: row.triagedLabel })}
                  </Typography>
                ) : null}
                {mayWork && row.lawsuitDeadlines.length > 0 ? (
                  <Box className="flex flex-col items-start gap-1">
                    <Typography variant="body2" className="text-text-secondary">
                      {t("deadlines-untimed-lawsuit")}
                    </Typography>
                    {row.lawsuitDeadlines.map((deadline) => (
                      <Button
                        key={deadline.id}
                        variant="text"
                        color="grey"
                        size="small"
                        className="-ml-2"
                        disabled={busy}
                        onClick={() => void link(row.id, deadline.id)}
                      >
                        {deadline.dueOn
                          ? t("deadlines-untimed-link", {
                              title: deadline.title,
                              day: formatDayBr(deadline.dueOn) ?? deadline.dueOn,
                            })
                          : t("deadlines-untimed-link-counting", { title: deadline.title })}
                      </Button>
                    ))}
                  </Box>
                ) : null}
              </Box>
              <Box className="flex flex-wrap gap-2">
                {mayWork ? (
                  <Button variant="contained" size="small" onClick={() => setCounting(row)}>
                    {t("deadlines-untimed-action")}
                  </Button>
                ) : null}
                {row.caseId ? (
                  <Button variant="text" color="grey" size="small" href={`/casos/${row.caseId}`} LinkComponent={Link}>
                    {t("deadline-open-case")}
                  </Button>
                ) : null}
              </Box>
            </Box>
          ))}
        </Box>
        {error ? (
          <Alert severity="error" className="neutral bg-background-paper/60!">
            {error}
          </Alert>
        ) : null}
        {untimed.total > untimed.rows.length ? (
          <Typography variant="body2" className="text-text-secondary">
            {t("deadlines-untimed-more", { count: untimed.total - untimed.rows.length })}
          </Typography>
        ) : null}
      </CardContent>
      {counting ? (
        <DeadlinePanel
          subject={{
            kind: "publication",
            publicationId: counting.id,
            availableOn: counting.availableOn,
            proceedingKind: counting.proceedingKind,
          }}
          acts={acts}
          onClose={() => setCounting(null)}
          onSaved={() => {
            setCounting(null);
            onChanged();
          }}
        />
      ) : null}
    </Card>
  );
}
