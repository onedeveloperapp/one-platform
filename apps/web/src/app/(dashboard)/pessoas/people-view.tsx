"use client";

import SegmentsCard from "./segments-card";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Alert, Box, Button, Card, CardContent, Grid, Typography } from "@mui/material";

import { useViewer } from "@/components/layout/viewer-context";
import NewPersonPanel from "@/components/people/new-person-panel";
import CardTitle from "@/components/product/card-title";
import EmptyState from "@/components/product/empty-state";
import ListBar from "@/components/product/list-bar";
import ListMore from "@/components/product/list-more";
import NumberCard from "@/components/product/number-card";
import PageHeader from "@/components/product/page-header";
import StatusChip from "@/components/product/status-chip";
import TallyTile from "@/components/product/tally-tile";
import { TILE_TONE } from "@/components/product/tile-tone";
import IllustrationSupport from "@/icons/illustrations/illustration-support";
import NiBriefcase from "@/icons/nexture/ni-briefcase";
import NiCake from "@/icons/nexture/ni-cake";
import NiChartBar from "@/icons/nexture/ni-chart-bar";
import NiChevronRightSmall from "@/icons/nexture/ni-chevron-right-small";
import NiCompass from "@/icons/nexture/ni-compass";
import NiPin from "@/icons/nexture/ni-pin";
import NiPlane from "@/icons/nexture/ni-plane";
import NiScale from "@/icons/nexture/ni-scale";
import NiSigns from "@/icons/nexture/ni-signs";
import NiUser from "@/icons/nexture/ni-user";
import NiUserCheck from "@/icons/nexture/ni-user-check";
import NiUserCross from "@/icons/nexture/ni-user-cross";
import NiUsers from "@/icons/nexture/ni-users";
import { REASON_KEY } from "@/lib/cases/qualification";
import { caseKindLabelKey } from "@/lib/modules/registry";
import { listPeople } from "@/lib/people/actions";
import {
  AGE_KEY,
  FUNNEL_POINT_KEY,
  type FunnelPoint,
  isFunnelView,
  ORIGIN_KEY,
  OUTCOME_KEY,
  PEOPLE_CARD_VIEWS,
  PEOPLE_SHOWN,
  PEOPLE_VIEW_KEY,
  PEOPLE_VIEWS,
  type PeopleNumbers,
  type PeoplePage,
  type PeopleView as View,
  type Segment,
  type Tally,
} from "@/lib/people/people";
import type { MarketingTerm } from "@/lib/people/read";
import { cn } from "@/lib/utils";

export type PeopleState =
  | {
      kind: "ready";
      view: View;
      page: PeoplePage;
      numbers: PeopleNumbers;
      /** Null for who does not manage the segments, or when they could not be read. */
      segments: Segment[] | null;
      term: MarketingTerm | null;
      factor: "ok" | "challenge" | "missing";
    }
  | { kind: "no-firm" }
  | { kind: "unavailable" }
  | { kind: "error" };

const POINT_TONE: Record<FunnelPoint, "positive" | "info" | "attention" | "neutral"> = {
  cliente: "positive",
  lead: "info",
  nao_qualificado: "attention",
  contato: "neutral",
};

/** A person's initials, for the circle that leads their row. */
const initialsOf = (name: string) =>
  name
    .split(/\s+/)
    .filter((word) => word.length > 2 || /^[A-ZÀ-Ý]/.test(word))
    .filter((_, index, words) => index === 0 || index === words.length - 1)
    .map((word) => word.charAt(0).toUpperCase())
    .join("");

// The cards are the funnel, in its order (the owner, 2026-11-11).
const VIEW_LOOK: Record<
  (typeof PEOPLE_CARD_VIEWS)[number],
  { tone: "primary" | "secondary" | "accent-3" | "accent-4"; icon: React.ReactNode }
> = {
  contatos: { tone: "accent-4", icon: <NiUser size="medium" /> },
  leads: { tone: "primary", icon: <NiUsers size="medium" /> },
  clientes: { tone: "secondary", icon: <NiUserCheck size="medium" /> },
  "nao-qualificados": { tone: "accent-3", icon: <NiUserCross size="medium" /> },
};

/** The tint of a row's circle: the colour of its card of the funnel. */
const POINT_LOOK: Record<FunnelPoint, "primary" | "secondary" | "accent-3" | "accent-4"> = {
  contato: "accent-4",
  lead: "primary",
  cliente: "secondary",
  nao_qualificado: "accent-3",
};

/**
 * The firm's people (phase 9): who the firm serves, found by a name, a CPF or a telephone, each one click from their
 * page, with the numbers of who they are and where they came from, and the marketing segments the firm uses in its
 * own tools, at its own risk. Success is anybody of the firm finding a client in seconds when they call.
 */
export default function PeopleView({ state }: { state: PeopleState }) {
  const t = useTranslations("product");
  const router = useRouter();
  const viewer = useViewer();
  const ready = state.kind === "ready" ? state : null;
  // "Nova pessoa", whatever the modules: the core registers, and each module offers its step after (2026-11-11).
  const [adding, setAdding] = useState(false);
  const [search, setSearch] = useState("");
  const [shown, setShown] = useState<PeoplePage | null>(ready?.page ?? null);
  const view = ready?.view ?? "todos";
  // How many pages past the first are open, of the view they were opened in: another view starts at its first page.
  const [opened, setOpened] = useState<{ view: string; pages: number }>({ view, pages: 0 });
  const more = opened.view === view ? opened.pages : 0;
  const setMore = (pages: (now: number) => number) => setOpened({ view, pages: pages(more) });
  const [failed, setFailed] = useState(false);
  const asked = useRef(0);

  // A search is asked a moment after the last key, in the request's body; the newest answer wins.
  useEffect(() => {
    if (!ready) return;
    const turn = ++asked.current;
    if (search.trim() === "" && more === 0) {
      setShown(ready.page);
      return;
    }
    const timer = window.setTimeout(async () => {
      try {
        const pages = await Promise.all(
          Array.from({ length: more + 1 }, (_, index) => listPeople(view, search.trim(), index)),
        );
        if (turn !== asked.current) return;
        if (pages.some((page) => !page.ok)) return setFailed(true);
        const read = pages
          .map((page) => (page.ok ? page.page : null))
          .filter((page): page is PeoplePage => page !== null);
        setFailed(false);
        setShown({ counts: read[0]!.counts, total: read[0]!.total, rows: read.flatMap((page) => page.rows) });
      } catch {
        if (turn === asked.current) setFailed(true);
      }
    }, 300);
    return () => window.clearTimeout(timer);
  }, [search, more, view, ready]);

  const numbers = ready?.numbers;
  const label = (map: Record<string, string>, key: string) => (map[key] ? t(map[key]!) : key);
  const items = (tallies: Tally[], words: (key: string) => string) =>
    tallies.map((tally) => ({ key: tally.key, label: words(tally.key), value: tally.count }));
  const moreWords = (count: number) => t("people-numbers-more", { count });
  // Everybody in the funnel: each card's share is of them.
  const funnelWhole = ready ? PEOPLE_CARD_VIEWS.reduce((sum, key) => sum + (ready.page.counts[key] ?? 0), 0) : 0;

  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title={t("people-title")}
        crumbs={[{ label: t("approvals-home"), href: "/inicio" }, { label: t("people-title") }]}
        description={ready ? t("people-description") : undefined}
      />

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
          {t("people-load-error")}
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

      {ready && numbers ? (
        <>
          <Grid container spacing={2.5}>
            {PEOPLE_CARD_VIEWS.map((key) => (
              <Grid key={key} size={{ xs: 6, lg: "grow" }}>
                <NumberCard
                  icon={VIEW_LOOK[key].icon}
                  tone={VIEW_LOOK[key].tone}
                  label={t(PEOPLE_VIEW_KEY[key])}
                  value={String(ready.page.counts[key] ?? 0)}
                  ratio={
                    funnelWhole > 0
                      ? {
                          part: ready.page.counts[key] ?? 0,
                          whole: funnelWhole,
                          text: t("people-funnel-of", { count: funnelWhole }),
                          label: t("people-funnel-share", {
                            part: ready.page.counts[key] ?? 0,
                            count: funnelWhole,
                            share: Math.round(((ready.page.counts[key] ?? 0) / funnelWhole) * 100),
                          }),
                        }
                      : null
                  }
                  pressed={view === key}
                  onClick={() => router.push(view === key ? "/pessoas" : `/pessoas?ver=${key}`)}
                />
              </Grid>
            ))}
          </Grid>

          {numbers.testsCounted ? (
            <Typography variant="body2" className="text-text-secondary">
              {t("people-tests-counted")}
            </Typography>
          ) : null}

          <ListBar
            label={t("people-title")}
            viewsTitle={t("list-views-title")}
            views={PEOPLE_VIEWS.map((key) => ({
              key,
              label: t(PEOPLE_VIEW_KEY[key]),
              count: String(shown?.counts[key] ?? 0),
              group: t(isFunnelView(key) ? "people-funnel-title" : "people-title"),
            }))}
            view={view}
            onView={(key) => router.push(key === "todos" ? "/pessoas" : `/pessoas?ver=${key}`)}
            create={{ label: t("people-new"), onClick: () => setAdding(true) }}
            search={{
              label: t("list-bar-search"),
              placeholder: t("people-search-placeholder"),
              value: search,
              onChange: (typed) => {
                setMore(() => 0);
                setSearch(typed);
              },
            }}
          />

          {failed ? (
            <Alert severity="error" className="neutral bg-background-paper/60!">
              {t("people-load-error")}
            </Alert>
          ) : null}

          {shown && shown.rows.length === 0 ? (
            <EmptyState
              illustration={<IllustrationSupport />}
              title={t(search.trim() ? "people-empty-search-title" : "people-empty-title")}
              description={t(search.trim() ? "people-empty-search-body" : "people-empty-body")}
            />
          ) : shown ? (
            <Card component="section" aria-label={t("people-title")}>
              <Box component="ul" className="m-0 list-none p-0">
                {shown.rows.map((row) => (
                  <Box component="li" key={row.id} className="border-grey-100 border-b last:border-b-0">
                    <Link
                      href={`/pessoas/${row.id}`}
                      className="hover:bg-grey-25 flex items-center gap-3 px-5 py-3 no-underline"
                    >
                      <Box
                        aria-hidden
                        className={cn(
                          "flex h-10 w-10 flex-none items-center justify-center rounded-full text-sm font-semibold",
                          row.point
                            ? [TILE_TONE[POINT_LOOK[row.point]].bg, TILE_TONE[POINT_LOOK[row.point]].text]
                            : "bg-grey-50 text-text-secondary",
                        )}
                      >
                        {initialsOf(row.name)}
                      </Box>
                      <Box className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <Typography variant="body1" className="text-text-primary truncate font-semibold">
                          {row.name}
                        </Typography>
                        <Typography variant="body2" className="text-text-secondary truncate">
                          {[row.cpfMiddle ? t("people-cpf-middle", { middle: row.cpfMiddle }) : null, row.place]
                            .filter(Boolean)
                            .join(" · ") || t("people-no-data")}
                        </Typography>
                        {row.point === "nao_qualificado" && row.reasons.length > 0 ? (
                          <Typography variant="body2" className="text-text-secondary">
                            {row.reasons
                              .map((reason) =>
                                reason in REASON_KEY ? t(REASON_KEY[reason as keyof typeof REASON_KEY]) : null,
                              )
                              .filter(Boolean)
                              .join(" ")}
                          </Typography>
                        ) : null}
                      </Box>
                      <Box className="hidden flex-wrap justify-end gap-1 sm:flex">
                        {row.point ? (
                          <StatusChip tone={POINT_TONE[row.point]} label={t(FUNNEL_POINT_KEY[row.point])} />
                        ) : null}
                        {row.erased ? <StatusChip tone="neutral" label={t("people-chip-erased")} /> : null}
                        {!row.adult ? <StatusChip tone="info" label={t("people-chip-minor")} /> : null}
                        {row.marketingOff ? <StatusChip tone="neutral" label={t("people-chip-no-marketing")} /> : null}
                        <StatusChip
                          tone={row.active ? "positive" : "neutral"}
                          label={t(
                            row.active
                              ? "people-chip-active"
                              : row.hasCase
                                ? "people-chip-inactive"
                                : "people-chip-no-case",
                          )}
                        />
                      </Box>
                      <NiChevronRightSmall size="small" className="text-text-secondary shrink-0" />
                    </Link>
                  </Box>
                ))}
              </Box>
            </Card>
          ) : null}

          {shown ? (
            <ListMore
              shown={shown.rows.length}
              total={shown.total}
              step={PEOPLE_SHOWN}
              onMore={() => setMore((count) => count + 1)}
            />
          ) : null}

          {numbers.registered > 0 ? (
            // Who the firm serves, each way of counting them a tile with its few largest parts (the owner, 2026-11-12):
            // seven headings each over one bar had left most of the card empty. Eight tiles, four across.
            <Card component="section" aria-labelledby="people-numbers">
              <CardContent className="flex flex-col gap-4">
                <CardTitle id="people-numbers" icon={<NiChartBar size="medium" />} title={t("people-numbers-title")} />
                <Box className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <TallyTile
                    icon={<NiUserCheck size="medium" />}
                    tone="primary"
                    title={t("people-numbers-standing")}
                    total={numbers.registered}
                    items={[
                      { key: "active", label: t("people-view-active"), value: numbers.active },
                      { key: "inactive", label: t("people-view-inactive"), value: numbers.inactive },
                      { key: "no-marketing", label: t("people-view-no-marketing"), value: numbers.marketingOff },
                    ]}
                    empty={t("people-numbers-none")}
                  />
                  <TallyTile
                    icon={<NiCompass size="medium" />}
                    tone="accent-1"
                    title={t("people-numbers-origin")}
                    items={items(numbers.origins, (key) => label(ORIGIN_KEY, key))}
                    more={moreWords}
                    empty={t("people-numbers-none")}
                  />
                  <TallyTile
                    icon={<NiCake size="medium" />}
                    tone="accent-2"
                    title={t("people-numbers-age")}
                    items={items(
                      numbers.ages.filter((tally) => tally.count > 0),
                      (key) => label(AGE_KEY, key),
                    )}
                    more={moreWords}
                    empty={t("people-numbers-none")}
                  />
                  <TallyTile
                    icon={<NiSigns size="medium" />}
                    tone="accent-4"
                    title={t("people-numbers-incident")}
                    items={items(numbers.incidents, (key) => t(caseKindLabelKey(key) ?? "case-incident-other"))}
                    more={moreWords}
                    empty={t("people-numbers-none")}
                  />
                  <TallyTile
                    icon={<NiScale size="medium" />}
                    tone="primary"
                    title={t("people-numbers-outcome")}
                    items={items(numbers.outcomes, (key) => label(OUTCOME_KEY, key))}
                    more={moreWords}
                    empty={t("people-numbers-none")}
                  />
                  <TallyTile
                    icon={<NiPin size="medium" />}
                    tone="secondary"
                    title={t("people-numbers-city")}
                    items={items(numbers.cities, (key) => key)}
                    more={moreWords}
                    empty={t("people-numbers-none")}
                  />
                  <TallyTile
                    icon={<NiPlane size="medium" />}
                    tone="secondary"
                    title={t("people-numbers-airline")}
                    items={items(numbers.airlines, (key) => key)}
                    more={moreWords}
                    empty={t("people-numbers-none")}
                  />
                  <TallyTile
                    icon={<NiBriefcase size="medium" />}
                    tone="accent-1"
                    title={t("people-numbers-profession")}
                    items={items(numbers.professions, (key) => key)}
                    more={moreWords}
                    empty={t("people-numbers-none")}
                  />
                </Box>
              </CardContent>
            </Card>
          ) : null}

          <SegmentsCard segments={ready.segments} term={ready.term} factor={ready.factor} numbers={numbers} />
        </>
      ) : null}
      {adding ? (
        <NewPersonPanel
          modules={viewer?.modules}
          onClose={(personId) => {
            setAdding(false);
            if (personId) router.refresh();
          }}
          onDone={(personId) => {
            setAdding(false);
            router.push(`/pessoas/${personId}`);
          }}
        />
      ) : null}
    </Box>
  );
}
