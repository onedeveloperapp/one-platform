import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What the operator's console of the forensic calendar reads (migration
 * 0034): the courts, which years of each were checked against the court's
 * act, the days of one court and year, and the acts of the list; and what
 * the platform read of how each court decides a family split (0025,
 * `court_notes`). Global reference data: nothing of a firm.
 */

export type CalendarCourt = { acronym: string; name: string };

export type CalendarYearRecord = {
  court: string;
  year: number;
  sourceUrl: string;
  sourceTitle: string | null;
  allComarcas: boolean;
  comarcas: string[];
  checkedOn: string;
  note: string | null;
};

export type CalendarDayRecord = {
  id: string;
  day: string;
  kind: "closed" | "partial" | "suspended";
  label: string;
  proceedingKinds: string[];
  systems: string[];
  comarcas: string[];
  sourceUrl: string | null;
};

export type DeadlineActRecord = {
  slug: string;
  name: string;
  days: number;
  counting: "business" | "calendar";
  proceedingKinds: string[];
  basis: string;
  position: number;
  active: boolean;
};

/** What the platform read of how a court decides a family split between the small-claims and the civil court. */
export type CourtNoteRecord = {
  court: string;
  topic: string;
  stance: "against" | "divided";
  summary: string;
  sources: { label: string; url: string }[];
  readOn: string;
};

export type CalendarConsole = {
  courts: CalendarCourt[];
  years: CalendarYearRecord[];
  court: string;
  year: number;
  days: CalendarDayRecord[];
  acts: DeadlineActRecord[];
  notes: CourtNoteRecord[];
};

const KINDS = ["closed", "partial", "suspended"] as const;

/** The console for one court and one year: the court and year asked, or the first court and this year. */
export async function loadCalendarConsole(
  supabase: SupabaseClient,
  asked: { court: string | null; year: number | null },
  thisYear: number,
): Promise<CalendarConsole> {
  const [courts, years, acts, notes] = await Promise.all([
    supabase.from("courts").select("acronym, name").order("acronym"),
    supabase
      .from("court_calendar_years")
      .select("court, year, source_url, source_title, all_comarcas, comarcas, checked_on, note")
      .order("court")
      .order("year"),
    supabase
      .from("deadline_acts")
      .select("slug, name, days, counting, proceeding_kinds, basis, position, active")
      .order("position")
      .order("name"),
    supabase.from("court_notes").select("court, topic, stance, summary, sources, read_on").order("court"),
  ]);
  if (courts.error || years.error || acts.error || notes.error) throw new Error("the calendar could not be read");
  const courtList = (courts.data ?? []) as CalendarCourt[];
  const court = courtList.some((item) => item.acronym === asked.court)
    ? (asked.court as string)
    : (courtList.find((item) => item.acronym === "TJGO")?.acronym ?? courtList[0]?.acronym ?? "TJGO");
  const year = asked.year !== null && asked.year >= 2019 && asked.year <= 2100 ? asked.year : thisYear;
  const days = await supabase
    .from("court_calendar_days")
    .select("id, day, kind, label, proceeding_kinds, systems, comarcas, source_url")
    .eq("court", court)
    .gte("day", `${year}-01-01`)
    .lte("day", `${year}-12-31`)
    .order("day")
    .order("label");
  if (days.error) throw new Error("the calendar could not be read");
  return {
    courts: courtList,
    years: (
      (years.data ?? []) as {
        court: string;
        year: number;
        source_url: string;
        source_title: string | null;
        all_comarcas: boolean;
        comarcas: string[] | null;
        checked_on: string;
        note: string | null;
      }[]
    ).map((row) => ({
      court: row.court,
      year: row.year,
      sourceUrl: row.source_url,
      sourceTitle: row.source_title,
      allComarcas: row.all_comarcas,
      comarcas: row.comarcas ?? [],
      checkedOn: row.checked_on,
      note: row.note,
    })),
    court,
    year,
    days: (
      (days.data ?? []) as {
        id: string;
        day: string;
        kind: string;
        label: string;
        proceeding_kinds: string[] | null;
        systems: string[] | null;
        comarcas: string[] | null;
        source_url: string | null;
      }[]
    ).flatMap((row) =>
      (KINDS as readonly string[]).includes(row.kind)
        ? [
            {
              id: row.id,
              day: row.day,
              kind: row.kind as CalendarDayRecord["kind"],
              label: row.label,
              proceedingKinds: row.proceeding_kinds ?? [],
              systems: row.systems ?? [],
              comarcas: row.comarcas ?? [],
              sourceUrl: row.source_url,
            },
          ]
        : [],
    ),
    acts: (
      (acts.data ?? []) as {
        slug: string;
        name: string;
        days: number;
        counting: string;
        proceeding_kinds: string[] | null;
        basis: string;
        position: number;
        active: boolean;
      }[]
    ).map((row) => ({
      slug: row.slug,
      name: row.name,
      days: row.days,
      counting: row.counting === "calendar" ? "calendar" : "business",
      proceedingKinds: row.proceeding_kinds ?? [],
      basis: row.basis,
      position: row.position,
      active: row.active,
    })),
    notes: (
      (notes.data ?? []) as {
        court: string;
        topic: string;
        stance: string;
        summary: string;
        sources: { label?: unknown; url?: unknown }[] | null;
        read_on: string;
      }[]
    ).map((row) => ({
      court: row.court,
      topic: row.topic,
      stance: row.stance === "divided" ? "divided" : "against",
      summary: row.summary,
      sources: (row.sources ?? []).flatMap((source) =>
        typeof source?.label === "string" && typeof source?.url === "string"
          ? [{ label: source.label, url: source.url }]
          : [],
      ),
      readOn: row.read_on,
    })),
  };
}

/**
 * The sources of a court's note typed one per line, as "label | address": the address is what starts at the
 * line's "https://", so a label may hold a "|" of its own. A line with no address is not dropped in silence:
 * it comes back as unreadable, and nothing is saved.
 */
export function sourcesOf(typed: string): { sources: { label: string; url: string }[]; unreadable: string[] } {
  const sources: { label: string; url: string }[] = [];
  const unreadable: string[] = [];
  for (const line of typed
    .split(/\n+/)
    .map((item) => item.trim())
    .filter(Boolean)) {
    const at = line.indexOf("https://");
    const label =
      at > 0
        ? line
            .slice(0, at)
            .replace(/[|\s]+$/, "")
            .trim()
        : "";
    const url = at > 0 ? line.slice(at).trim() : "";
    if (label.length >= 3 && url && !/\s/.test(url)) sources.push({ label, url });
    else unreadable.push(line);
  }
  return { sources, unreadable };
}

/** Names typed one per line or separated by commas, as the calendar keeps them. */
export function namesOf(typed: string): string[] {
  return [
    ...new Set(
      typed
        .split(/[\n,;]+/)
        .map((name) => name.trim())
        .filter((name) => name.length >= 2),
    ),
  ];
}
