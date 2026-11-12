"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Alert, Box, Button, Card, CardContent, MenuItem, Skeleton, TextField, Typography } from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import StatusChip from "@/components/product/status-chip";
import IllustrationPlatforms from "@/icons/illustrations/illustration-platforms";
import NiChevronLeftSmall from "@/icons/nexture/ni-chevron-left-small";
import NiChevronRightSmall from "@/icons/nexture/ni-chevron-right-small";
import { readAgenda } from "@/lib/agenda/actions";
import {
  agendaEntries,
  type AgendaEntry,
  type AgendaItems,
  type AgendaMode,
  type AgendaPerson,
  entriesByDay,
  entryCase,
  entryId,
  hearingCancelled,
  monthGrid,
  rangeOf,
  stepOf,
  weekDays,
  zoneWords,
} from "@/lib/agenda/agenda";
import { caseLabel } from "@/lib/cases/cases";
import type { Colleague } from "@/lib/hearings/facts";
import { KIND_KEY } from "@/lib/hearings/hearings";

type CalendarMode = Exclude<AgendaMode, "lista">;

/** The weekday's short name in Portuguese, from a day ("seg"): Intl's words, never the project's. */
const weekdayShort = (day: string) =>
  new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" })
    .format(new Date(`${day}T12:00:00Z`))
    .replace(".", "");
const dayNumber = (day: string) => Number.parseInt(day.slice(8, 10), 10);
const longDay = (day: string) =>
  new Intl.DateTimeFormat("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }).format(
    new Date(`${day}T12:00:00Z`),
  );
const monthName = (day: string) =>
  new Intl.DateTimeFormat("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(`${day}T12:00:00Z`),
  );
const shortDay = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}`;

const DEADLINE_KEY = { fatal: "agenda-entry-fatal", internal: "agenda-entry-internal" } as const;

/**
 * What each kind of entry looks like: the fatal day and the limit to register for oral argument in the attention
 * colour, a hearing and a session of judgment in the primary, the internal quiet.
 */
const ENTRY_LOOK: Record<AgendaEntry["kind"], string> = {
  fatal: "border-l-accent-3 bg-accent-3/10",
  oral: "border-l-accent-3 bg-accent-3/10",
  hearing: "border-l-primary bg-primary/10",
  session: "border-l-primary bg-primary/10",
  internal: "border-l-grey-300 bg-grey-50",
};

/** What an entry is, in the screen's words. */
function useEntryWhat(): (entry: AgendaEntry) => string {
  const t = useTranslations("product");
  return (entry) => {
    if (entry.kind === "hearing") return t(KIND_KEY[entry.hearing.kind]);
    if (entry.kind === "session") {
      const virtual = entry.session.kind === "virtual";
      return t(virtual ? "agenda-entry-session-virtual" : "agenda-entry-session");
    }
    if (entry.kind === "oral") return t("agenda-entry-oral");
    return `${t(DEADLINE_KEY[entry.kind])}: ${entry.deadline.actName ?? entry.deadline.title}`;
  };
}

/**
 * The agenda by day, week and month (migration 0132): the fatal and the internal deadlines and the hearings of the
 * days shown, of one person or the whole firm, read from the database for the days on screen. A day of the month is a
 * button (the arrows move between days, Enter opens it); on a phone the week and the month are read as a list of days.
 * Only to look at and to open a case: a deadline and a hearing are written on their case or in their panel.
 */
export default function AgendaCalendar({
  mode,
  day,
  meId,
  colleagues,
  module,
  onDay,
}: {
  mode: CalendarMode;
  day: string;
  meId: string;
  colleagues: readonly Colleague[];
  module: string | null;
  /** Moves the agenda to a day and a mode (the address keeps them). */
  onDay: (day: string, mode: CalendarMode) => void;
}) {
  const t = useTranslations("product");
  const [person, setPerson] = useState<string>("mine");
  const [state, setState] = useState<
    { kind: "loading" } | { kind: "ready"; items: AgendaItems; wholeFirm: boolean } | { kind: "error" }
  >({ kind: "loading" });
  const range = useMemo(() => rangeOf(mode, day), [mode, day]);
  const asked = useRef(0);

  const load = useCallback(async () => {
    const ticket = ++asked.current;
    setState((current) => (current.kind === "ready" ? current : { kind: "loading" }));
    try {
      const answer = await readAgenda(range.from, range.to, module);
      if (ticket !== asked.current) return;
      setState(answer.ok ? { kind: "ready", items: answer.items, wholeFirm: answer.me.wholeFirm } : { kind: "error" });
    } catch {
      if (ticket === asked.current) setState({ kind: "error" });
    }
  }, [range.from, range.to, module]);

  useEffect(() => {
    void load();
  }, [load]);

  const who: AgendaPerson =
    person === "all" ? { kind: "all" } : { kind: "person", id: person === "mine" ? meId : person };
  const entries = state.kind === "ready" ? agendaEntries(state.items, who, range.from, range.to) : [];
  const byDay = entriesByDay(entries);
  const everybody = person === "all";
  const emptyKey = everybody ? "agenda-range-empty-body-all" : "agenda-range-empty-body";
  const label =
    mode === "dia"
      ? longDay(day)
      : mode === "semana"
        ? t("agenda-week-range", { from: shortDay(range.from), to: shortDay(range.to) })
        : monthName(day);

  return (
    <Card component="section" aria-labelledby="agenda-calendar-title">
      <CardContent className="flex flex-col gap-4">
        <Box className="flex flex-wrap items-center gap-2">
          <Box className="flex items-center gap-1">
            <Button
              variant="outlined"
              color="grey"
              size="small"
              className="min-w-0 px-2"
              aria-label={t("agenda-previous")}
              onClick={() => onDay(stepOf(mode, day, -1), mode)}
            >
              <NiChevronLeftSmall size="small" />
            </Button>
            <Button variant="outlined" color="grey" size="small" onClick={() => onDay(todayDay(), mode)}>
              {t("agenda-today")}
            </Button>
            <Button
              variant="outlined"
              color="grey"
              size="small"
              className="min-w-0 px-2"
              aria-label={t("agenda-next")}
              onClick={() => onDay(stepOf(mode, day, 1), mode)}
            >
              <NiChevronRightSmall size="small" />
            </Button>
          </Box>
          <Typography
            id="agenda-calendar-title"
            variant="h6"
            component="h2"
            className="mb-0 min-w-0 flex-1 first-letter:uppercase"
          >
            {label}
          </Typography>
          <TextField
            select
            size="small"
            label={t("agenda-person-label")}
            value={person}
            onChange={(event) => setPerson(event.target.value)}
            className="w-full sm:w-56"
          >
            <MenuItem value="mine">{t("agenda-person-mine")}</MenuItem>
            <MenuItem value="all">{t("agenda-person-all")}</MenuItem>
            {colleagues
              .filter((colleague) => colleague.id !== meId)
              .map((colleague) => (
                <MenuItem key={colleague.id} value={colleague.id}>
                  {colleague.name}
                </MenuItem>
              ))}
          </TextField>
        </Box>

        {state.kind === "error" ? (
          <Alert
            severity="error"
            className="neutral bg-background-paper/60!"
            action={
              <Button color="inherit" size="small" onClick={() => void load()}>
                {t("approvals-retry")}
              </Button>
            }
          >
            {t("agenda-load-failed")}
          </Alert>
        ) : state.kind === "loading" ? (
          <Skeleton variant="rounded" height={mode === "mes" ? 420 : 240} />
        ) : mode === "mes" ? (
          <MonthGrid day={day} byDay={byDay} onOpen={(open) => onDay(open, "dia")} />
        ) : mode === "semana" ? (
          <WeekColumns days={weekDays(day)} byDay={byDay} onOpen={(open) => onDay(open, "dia")} />
        ) : (
          <DayList entries={byDay.get(day) ?? []} />
        )}

        {state.kind === "ready" && entries.length === 0 && mode !== "dia" ? (
          <EmptyState
            illustration={<IllustrationPlatforms />}
            title={t("agenda-range-empty-title")}
            description={t(emptyKey)}
            framed={false}
          />
        ) : null}
      </CardContent>
    </Card>
  );
}

function todayDay(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

/** The words of one entry, short (a grid's cell) or whole (a day's list). */
function EntryLine({ entry, whole }: { entry: AgendaEntry; whole: boolean }) {
  const t = useTranslations("product");
  const whatOf = useEntryWhat();
  const cancelled = entry.kind === "hearing" && hearingCancelled(entry.hearing);
  const { caseSeq: seq, caseId, isTest: test, cnj } = entryCase(entry);
  const what = whatOf(entry);
  const zone = entry.kind === "hearing" ? zoneWords(entry.hearing.timeZone) : null;
  const when =
    entry.kind === "hearing"
      ? zone
        ? `${entry.time} (${zone})`
        : entry.time
      : entry.kind === "oral" && entry.time
        ? t("agenda-entry-until", { time: entry.time })
        : entry.kind === "session"
          ? entry.time
          : null;
  const words = [when, what, seq !== null ? caseLabel(seq) : null].filter(Boolean).join(" · ");
  if (!whole) {
    return (
      <Box
        className={`truncate rounded border-l-4 px-1.5 py-0.5 text-xs ${ENTRY_LOOK[entry.kind]} ${cancelled ? "line-through opacity-70" : ""}`}
      >
        {words}
      </Box>
    );
  }
  return (
    <Box className={`flex flex-wrap items-center gap-2 rounded-lg border-l-4 px-3 py-2 ${ENTRY_LOOK[entry.kind]}`}>
      <Box className="flex min-w-0 flex-1 flex-col gap-0.5">
        <Typography variant="body2" className={`font-semibold ${cancelled ? "line-through" : ""}`}>
          {words}
        </Typography>
        {cnj ? (
          <Typography variant="caption" className="text-text-secondary">
            {cnj}
          </Typography>
        ) : null}
      </Box>
      {cancelled ? <StatusChip tone="neutral" label={t("agenda-entry-cancelled")} /> : null}
      {test ? <StatusChip tone="neutral" label={t("agenda-entry-test")} /> : null}
      {caseId ? (
        <Button size="small" variant="text" href={`/casos/${caseId}`} LinkComponent={Link}>
          {t("agenda-open-case")}
        </Button>
      ) : null}
    </Box>
  );
}

function DayList({ entries }: { entries: AgendaEntry[] }) {
  const t = useTranslations("product");
  if (entries.length === 0) {
    return (
      <Typography variant="body2" className="text-text-secondary">
        {t("agenda-day-empty")}
      </Typography>
    );
  }
  return (
    <Box component="ul" className="m-0 flex list-none flex-col gap-2 p-0">
      {entries.map((entry) => (
        <Box component="li" key={entryId(entry)}>
          <EntryLine entry={entry} whole />
        </Box>
      ))}
    </Box>
  );
}

/** A week: seven columns on a wide screen, a list of days on a phone. */
function WeekColumns({
  days,
  byDay,
  onOpen,
}: {
  days: string[];
  byDay: Map<string, AgendaEntry[]>;
  onOpen: (day: string) => void;
}) {
  const t = useTranslations("product");
  const today = todayDay();
  return (
    <Box className="grid grid-cols-1 gap-2 md:grid-cols-7">
      {days.map((day) => {
        const items = byDay.get(day) ?? [];
        return (
          <Box
            key={day}
            className={`flex min-w-0 flex-col gap-1 rounded-lg border p-2 ${day === today ? "border-primary" : "border-grey-100"}`}
          >
            <Button
              variant="text"
              color="grey"
              size="small"
              className="justify-start px-1"
              aria-label={t("agenda-day-label", { day: longDay(day), count: items.length })}
              onClick={() => onOpen(day)}
            >
              {`${weekdayShort(day)} ${dayNumber(day)}`}
            </Button>
            {items.length === 0 ? (
              <Typography variant="caption" className="text-text-secondary px-1 md:hidden">
                {t("agenda-day-empty")}
              </Typography>
            ) : (
              items.map((entry) => <EntryLine key={entryId(entry)} entry={entry} whole={false} />)
            )}
          </Box>
        );
      })}
    </Box>
  );
}

/**
 * A month in six weeks. Each day is a button: the arrows move a day or a week, Home and End to the week's ends, and
 * Enter opens the day. On a phone only the days with something are listed.
 */
function MonthGrid({
  day,
  byDay,
  onOpen,
}: {
  day: string;
  byDay: Map<string, AgendaEntry[]>;
  onOpen: (day: string) => void;
}) {
  const t = useTranslations("product");
  const grid = monthGrid(day);
  const month = day.slice(0, 7);
  const today = todayDay();
  const cells = useRef<(HTMLButtonElement | null)[]>([]);
  const [focus, setFocus] = useState(() => Math.max(grid.indexOf(day), 0));

  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    let next = index + (delta[event.key] ?? 0);
    if (event.key === "Home") next = index - (index % 7);
    if (event.key === "End") next = index - (index % 7) + 6;
    if (next === index || next < 0 || next >= grid.length) return;
    event.preventDefault();
    setFocus(next);
    cells.current[next]?.focus();
  };

  const busy = grid.filter((cell) => cell.slice(0, 7) === month && (byDay.get(cell)?.length ?? 0) > 0);
  return (
    <>
      <Box className="hidden md:block">
        <Box className="grid grid-cols-7 gap-1" role="row">
          {grid.slice(0, 7).map((weekday) => (
            <Typography
              key={weekday}
              variant="caption"
              className="text-text-secondary px-1 font-semibold capitalize"
              role="columnheader"
            >
              {weekdayShort(weekday)}
            </Typography>
          ))}
        </Box>
        <Box className="grid grid-cols-7 gap-1">
          {grid.map((cell, index) => {
            const items = byDay.get(cell) ?? [];
            const other = cell.slice(0, 7) !== month;
            return (
              <Box
                key={cell}
                component="button"
                type="button"
                ref={(node: HTMLButtonElement | null) => {
                  cells.current[index] = node;
                }}
                tabIndex={index === focus ? 0 : -1}
                onFocus={() => setFocus(index)}
                onKeyDown={(event: KeyboardEvent<HTMLButtonElement>) => move(event, index)}
                onClick={() => onOpen(cell)}
                aria-label={t("agenda-day-label", { day: longDay(cell), count: items.length })}
                className={`bg-background-paper focus-visible:outline-primary flex min-h-24 min-w-0 cursor-pointer flex-col gap-1 rounded-lg border p-1 text-left focus-visible:outline-2 ${
                  cell === today ? "border-primary" : "border-grey-100"
                } ${other ? "opacity-50" : ""}`}
              >
                <Typography variant="caption" className={`px-1 font-semibold ${cell === today ? "text-primary" : ""}`}>
                  {dayNumber(cell)}
                </Typography>
                {items.slice(0, 3).map((entry) => (
                  <EntryLine key={entryId(entry)} entry={entry} whole={false} />
                ))}
                {items.length > 3 ? (
                  <Typography variant="caption" className="text-text-secondary px-1">
                    {t("agenda-more", { count: items.length - 3 })}
                  </Typography>
                ) : null}
              </Box>
            );
          })}
        </Box>
      </Box>
      <Box className="flex flex-col gap-3 md:hidden">
        {busy.length === 0 ? (
          <Typography variant="body2" className="text-text-secondary">
            {t("agenda-day-empty")}
          </Typography>
        ) : (
          busy.map((cell) => (
            <Box key={cell} className="flex flex-col gap-1">
              <Button
                variant="text"
                color="grey"
                size="small"
                className="justify-start px-1"
                onClick={() => onOpen(cell)}
              >
                <span className="first-letter:uppercase">{longDay(cell)}</span>
              </Button>
              {(byDay.get(cell) ?? []).map((entry) => (
                <EntryLine key={entryId(entry)} entry={entry} whole />
              ))}
            </Box>
          ))
        )}
      </Box>
    </>
  );
}
