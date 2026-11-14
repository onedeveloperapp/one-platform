import "server-only";

import { momentLabel } from "@/lib/ai/approvals";
import {
  type CourtZones,
  HEARING_VIEWS,
  type HearingKind,
  type HearingMode,
  type HearingOutcome,
  HEARINGS_SHOWN,
  type HearingStatus,
  type HearingView,
  isHearingKind,
  isHearingMode,
  isHearingOutcome,
  isHearingStatus,
  isHearingZone,
} from "@/lib/hearings/hearings";
import { readingsOf, type ShownReading, shownReading } from "@/lib/publications/reading-words";
import { formatCnj } from "@flyee/rules/cnj";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What the screens read of the firm's hearings (migration 0037), under the
 * person's own session: the lists of `/agenda` (`firm_hearings`, which
 * counts each of them), a case's own, and the firm's calendar. Colleagues
 * are named by `firm_team`.
 */

export type HearingRow = {
  id: string;
  kind: HearingKind;
  startsAt: string;
  timeZone: string;
  mode: HearingMode;
  place: string | null;
  link: string | null;
  attendeeUserId: string | null;
  /** The attendee from outside of the firm's list it was chosen for (0251), when one was. */
  attendeeContactId: string | null;
  /** Who attends: the colleague's name, or the name written for somebody from outside the firm. */
  attendee: string | null;
  notes: string | null;
  source: "person" | "publication";
  publicationId: string | null;
  status: HearingStatus;
  outcome: HearingOutcome | null;
  outcomeNote: string | null;
  revision: number;
  caseId: string;
  caseSeq: number | null;
  clientName: string | null;
  proceedingId: string;
  cnj: string | null;
  court: string | null;
  comarca: string | null;
  proceedingKind: string | null;
  /**
   * How its event stands in the firm's calendar; null when the firm has no calendar in use, or when nothing of
   * the hearing is or will be there (cancelled and taken out, or of the past and never written).
   */
  calendarState: "synced" | "pending" | "failed" | null;
  /**
   * The firm reminds its clients of hearings and somebody of this lawsuit will not be reminded of this one (no
   * WhatsApp, no agreement, asked to stop, or the reminder cannot go at all): migration 0038.
   */
  clientUnwarned: boolean;
  createdBy: string | null;
  createdLabel: string | null;
  /** Registered by ONE from the publication it read, where the firm lets it (0040, `publication_hearing`). */
  createdAuto: boolean;
  /**
   * The court took back the publication it came from, and nobody said they saw that yet (the publication's own
   * `cancel_pending`): the hearing may no longer be.
   */
  publicationCancelPending: boolean;
};

export type FirmCalendar = { name: string; status: "active" | "lost"; problem: string | null } | null;

export type HearingsData = {
  /** The moment the hearings were read: what a hearing's time is measured from. */
  now: string;
  /** How long a hearing is taken to last (the setting's): after it, the hearing has passed. */
  durationMinutes: number;
  counts: Record<HearingView, number>;
  /** Of the ones to come, the ones in the next days (the setting's): what the home counts. */
  soonCount: number;
  soonDays: number;
  total: number;
  rows: HearingRow[];
  page: number;
  more: boolean;
  calendar: FirmCalendar;
  /** The hearings of the firm the calendar in use refused for good, in any list and page. */
  calendarFailed: number;
};

type RawRow = {
  id: string;
  kind: string;
  starts_at: string;
  time_zone: string;
  mode: string;
  place: string | null;
  link: string | null;
  attendee_user_id: string | null;
  attendee_name: string | null;
  attendee_contact_id?: string | null;
  notes: string | null;
  source: string;
  publication_id: string | null;
  status: string;
  outcome: string | null;
  outcome_note: string | null;
  revision: number;
  case_id: string;
  case_seq: number | null;
  client_name: string | null;
  proceeding_id: string;
  cnj: string | null;
  court: string | null;
  comarca: string | null;
  proceeding_kind: string | null;
  calendar_state: string | null;
  created_by: string | null;
  created_at: string | null;
  created_auto?: boolean | null;
  publication_cancel_pending?: boolean | null;
};

type Answer = {
  soon_days?: unknown;
  duration_minutes?: unknown;
  calendar_failed?: unknown;
  counts?: Record<string, unknown>;
  total?: unknown;
  calendar?: { name?: unknown; status?: unknown; problem?: unknown } | null;
  rows?: RawRow[];
};
type TeamRow = { user_id: string; display_name: string | null; email: string | null };

const nameOf = (person: TeamRow): string => person.display_name?.trim() || person.email?.split("@")[0] || "";

/** The names of the firm's people, by id. */
export async function teamNames(supabase: SupabaseClient, firmId: string): Promise<Map<string, string>> {
  const { data, error } = await supabase.rpc("firm_team", { target_org: firmId });
  if (error) throw new Error("the team could not be read");
  return new Map(((data ?? []) as TeamRow[]).map((person) => [person.user_id, nameOf(person)]));
}

const countOf = (value: unknown): number =>
  typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : 0;

function toRow(raw: RawRow, names: Map<string, string>, timeZone: string | null | undefined): HearingRow | null {
  if (!isHearingKind(raw.kind) || !isHearingMode(raw.mode) || !isHearingStatus(raw.status)) return null;
  const state = raw.calendar_state;
  return {
    id: raw.id,
    kind: raw.kind,
    startsAt: raw.starts_at,
    timeZone: raw.time_zone,
    mode: raw.mode,
    place: raw.place,
    link: raw.link,
    attendeeUserId: raw.attendee_user_id,
    attendeeContactId: raw.attendee_contact_id ?? null,
    attendee: raw.attendee_name ?? (raw.attendee_user_id ? names.get(raw.attendee_user_id) || null : null),
    notes: raw.notes,
    source: raw.source === "publication" ? "publication" : "person",
    publicationId: raw.publication_id,
    status: raw.status,
    outcome: isHearingOutcome(raw.outcome) ? raw.outcome : null,
    outcomeNote: raw.outcome_note,
    revision: raw.revision,
    caseId: raw.case_id,
    caseSeq: raw.case_seq,
    clientName: raw.client_name,
    proceedingId: raw.proceeding_id,
    cnj: raw.cnj ? (formatCnj(raw.cnj) ?? raw.cnj) : null,
    court: raw.court,
    comarca: raw.comarca,
    proceedingKind: raw.proceeding_kind,
    calendarState: state === "synced" || state === "pending" || state === "failed" ? state : null,
    clientUnwarned: false,
    createdBy: raw.created_by ? names.get(raw.created_by) || null : null,
    createdLabel: raw.created_at ? momentLabel(raw.created_at, timeZone) : null,
    createdAuto: raw.created_auto === true,
    publicationCancelPending: raw.publication_cancel_pending === true,
  };
}

/**
 * Of some hearings, the ones to come whose client will not be told of them (`firm_hearings_unwarned`, migration
 * 0038), marked on their rows.
 */
async function markUnwarned(supabase: SupabaseClient, firmId: string, rows: HearingRow[]): Promise<HearingRow[]> {
  const ids = rows.filter((row) => row.status === "scheduled").map((row) => row.id);
  if (ids.length === 0) return rows;
  const { data, error } = await supabase.rpc("firm_hearings_unwarned", { target_org: firmId, target_hearings: ids });
  if (error || !Array.isArray(data)) throw new Error("the hearings' notices could not be read");
  const unwarned = new Set(data.filter((id): id is string => typeof id === "string"));
  return rows.map((row) => (unwarned.has(row.id) ? { ...row, clientUnwarned: true } : row));
}

/** How long a hearing is taken to last, as the database said it; an hour when it said nothing. */
const durationOf = (answer: Answer): number => countOf(answer.duration_minutes) || 60;

function calendarOf(value: Answer["calendar"]): FirmCalendar {
  if (!value || typeof value.name !== "string") return null;
  return {
    name: value.name,
    status: value.status === "lost" ? "lost" : "active",
    problem: typeof value.problem === "string" ? value.problem : null,
  };
}

async function firmHearings(
  supabase: SupabaseClient,
  firmId: string,
  view: HearingView,
  limit: number,
  offset: number,
  caseId: string | null,
  module: string | null = null,
): Promise<Answer> {
  const { data, error } = await supabase.rpc("firm_hearings", {
    target_org: firmId,
    target_view: view,
    target_limit: limit,
    target_offset: offset,
    target_case: caseId,
    target_module: module,
  });
  if (error || typeof data !== "object" || data === null) throw new Error("the hearings could not be read");
  return data as Answer;
}

/** A page of one of the lists of `/agenda`, with the count of each. */
export async function loadHearings(
  supabase: SupabaseClient,
  firmId: string,
  view: HearingView,
  page: number,
  timeZone: string | null | undefined,
  module: string | null = null,
): Promise<HearingsData> {
  const [answer, names] = await Promise.all([
    firmHearings(supabase, firmId, view, HEARINGS_SHOWN, page * HEARINGS_SHOWN, null, module),
    teamNames(supabase, firmId),
  ]);
  const counts = Object.fromEntries(HEARING_VIEWS.map((name) => [name, countOf(answer.counts?.[name])])) as Record<
    HearingView,
    number
  >;
  const total = countOf(answer.total);
  return {
    now: new Date().toISOString(),
    durationMinutes: durationOf(answer),
    counts,
    soonCount: countOf(answer.counts?.em_breve),
    soonDays: countOf(answer.soon_days) || 7,
    total,
    rows: await markUnwarned(
      supabase,
      firmId,
      (answer.rows ?? []).flatMap((raw) => toRow(raw, names, timeZone) ?? []),
    ),
    page,
    more: (page + 1) * HEARINGS_SHOWN < total,
    calendar: calendarOf(answer.calendar),
    calendarFailed: countOf(answer.calendar_failed),
  };
}

export type CaseHearings = {
  now: string;
  durationMinutes: number;
  upcoming: HearingRow[];
  past: HearingRow[];
  calendar: FirmCalendar;
};

/** A case's own hearings: the ones to come and the ones with no word on them first, then the latest held or cancelled. */
export async function caseHearings(
  supabase: SupabaseClient,
  firmId: string,
  caseId: string,
  timeZone: string | null | undefined,
): Promise<CaseHearings> {
  const [next, silent, held, cancelled, names] = await Promise.all([
    firmHearings(supabase, firmId, "proximas", 50, 0, caseId),
    firmHearings(supabase, firmId, "sem_resultado", 50, 0, caseId),
    firmHearings(supabase, firmId, "realizadas", 10, 0, caseId),
    firmHearings(supabase, firmId, "canceladas", 10, 0, caseId),
    teamNames(supabase, firmId),
  ]);
  const rows = (answer: Answer) => (answer.rows ?? []).flatMap((raw) => toRow(raw, names, timeZone) ?? []);
  return {
    now: new Date().toISOString(),
    durationMinutes: durationOf(next),
    upcoming: [...rows(silent), ...(await markUnwarned(supabase, firmId, rows(next)))],
    past: [...rows(held), ...rows(cancelled)].sort((a, b) => b.startsAt.localeCompare(a.startsAt)),
    calendar: calendarOf(next.calendar),
  };
}

/** The zones of every court (27 rows of reference data, read by anybody signed in), by the court's acronym. */
export async function courtZones(supabase: SupabaseClient): Promise<Record<string, CourtZones>> {
  const { data, error } = await supabase.from("courts").select("acronym, time_zone, other_zones");
  if (error) throw new Error("the courts could not be read");
  const zones: Record<string, CourtZones> = {};
  for (const row of (data ?? []) as { acronym: string; time_zone: string; other_zones: string[] | null }[]) {
    zones[row.acronym] = {
      seat: row.time_zone,
      others: (row.other_zones ?? []).filter((zone) => isHearingZone(zone)),
    };
  }
  return zones;
}

/** A colleague who may be named as the one who attends: everybody of the firm. */
export type Colleague = { id: string; name: string };

/** The firm's people, by name. */
export async function colleagues(supabase: SupabaseClient, firmId: string): Promise<Colleague[]> {
  const names = await teamNames(supabase, firmId);
  return [...names.entries()]
    .map(([id, name]) => ({ id, name }))
    .filter((person) => person.name)
    .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

/**
 * A hearing written from a publication, as the publication's card says it; `auto` when ONE wrote it (0040); and who
 * goes, which the firm says where it takes notice of it (0251).
 */
export type PublicationHearing = {
  id: string;
  startsAt: string;
  timeZone: string;
  status: HearingStatus;
  auto: boolean;
  attendeeUserId?: string | null;
  attendeeContactId?: string | null;
  attendeeName?: string | null;
};

/** The hearings written from some publications, by publication. */
export async function publicationHearings(
  supabase: SupabaseClient,
  firmId: string,
  publicationIds: readonly string[],
): Promise<Map<string, PublicationHearing[]>> {
  const found = new Map<string, PublicationHearing[]>();
  if (publicationIds.length === 0) return found;
  const { data, error } = await supabase
    .from("hearings")
    .select(
      "id, publication_id, starts_at, time_zone, status, created_auto, attendee_user_id, attendee_contact_id, attendee_name",
    )
    .eq("org_id", firmId)
    .in("publication_id", [...publicationIds])
    .order("starts_at", { ascending: true })
    .limit(500);
  if (error) throw new Error("the hearings of the publications could not be read");
  for (const row of (data ?? []) as {
    id: string;
    publication_id: string;
    starts_at: string;
    time_zone: string;
    status: string;
    created_auto: boolean | null;
    attendee_user_id: string | null;
    attendee_contact_id: string | null;
    attendee_name: string | null;
  }[]) {
    if (!isHearingStatus(row.status)) continue;
    const list = found.get(row.publication_id) ?? [];
    list.push({
      id: row.id,
      startsAt: row.starts_at,
      timeZone: row.time_zone,
      status: row.status,
      auto: row.created_auto === true,
      attendeeUserId: row.attendee_user_id,
      attendeeContactId: row.attendee_contact_id,
      attendeeName: row.attendee_name,
    });
    found.set(row.publication_id, list);
  }
  return found;
}

/** A publication triaged as a hearing that still owes it, as `/agenda` shows it (migration 0037). */
export type PublicationWithoutHearing = {
  id: string;
  cnj: string;
  court: string;
  availableOn: string;
  kind: string;
  /** The start of its text, never the whole of it. */
  head: string;
  caseId: string | null;
  caseSeq: number | null;
  /** Its lawsuit in ONE, when the firm has it; a hearing is written only in one the court has (`filed`). */
  proceedingId: string | null;
  lawsuitFiled: boolean;
  triagedBy: string | null;
  triagedLabel: string | null;
  /** What ONE read of it, when the firm lets ONE read hearings (0040): left to a person with why, or not read in time. */
  reading: ShownReading | null;
};

export type PublicationsWithoutHearing = {
  /** For how many days after it was triaged such a publication is shown. */
  watchDays: number;
  total: number;
  rows: PublicationWithoutHearing[];
};

/**
 * The publications of the firm triaged as a hearing, in the days a triaged
 * publication is watched, that still owe their hearing (none came from them
 * and nobody said they need nothing more): what ONE left to a person, what a
 * person triaged and did not write, and what is of a lawsuit not in ONE yet.
 * With what ONE read of each.
 */
export async function publicationsWithoutHearing(
  supabase: SupabaseClient,
  firmId: string,
  timeZone: string | null | undefined,
): Promise<PublicationsWithoutHearing> {
  const [{ data, error }, names] = await Promise.all([
    supabase.rpc("firm_publications_without_hearing", { target_org: firmId, target_limit: 20 }),
    teamNames(supabase, firmId),
  ]);
  if (error || typeof data !== "object" || data === null)
    throw new Error("the publications without a hearing could not be read");
  const answer = data as { watch_days?: unknown; total?: unknown; rows?: Record<string, unknown>[] };
  const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
  const rows = (Array.isArray(answer.rows) ? answer.rows : []).flatMap((row): PublicationWithoutHearing[] => {
    const id = text(row.id);
    const cnj = text(row.cnj);
    const availableOn = text(row.available_on);
    const proceedingId = text(row.proceeding_id);
    if (!id || !cnj || !availableOn) return [];
    const triagedBy = text(row.triaged_by);
    const triagedAt = text(row.triaged_at);
    return [
      {
        id,
        cnj: formatCnj(cnj) ?? cnj,
        court: text(row.court) ?? "",
        availableOn,
        kind: text(row.kind) ?? "",
        head: text(row.head) ?? "",
        caseId: text(row.case_id),
        caseSeq: typeof row.case_seq === "number" ? row.case_seq : null,
        proceedingId,
        lawsuitFiled: Boolean(proceedingId) && row.proceeding_status === "filed",
        triagedBy: triagedBy ? names.get(triagedBy) || null : null,
        triagedLabel: triagedAt ? momentLabel(triagedAt, timeZone) : null,
        reading: null,
      },
    ];
  });
  if (rows.length > 0) {
    const { data: readings, error: readError } = await supabase
      .from("publication_readings")
      .select("publication_id, kind, status, reason")
      .eq("org_id", firmId)
      .eq("kind", "hearing")
      .in(
        "publication_id",
        rows.map((row) => row.id),
      );
    // Without what ONE read, the reasons go unsaid: the watch itself still shows.
    const read = readingsOf(readError ? [] : readings);
    for (const row of rows) row.reading = shownReading("audiencia", read.get(row.id) ?? [], null);
  }
  return { watchDays: countOf(answer.watch_days), total: countOf(answer.total), rows };
}
