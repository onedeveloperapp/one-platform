import "server-only";

import { momentLabel } from "@/lib/ai/approvals";
import { type PublicationDeadline, publicationDeadlines } from "@/lib/deadlines/facts";
import { type PublicationHearing, publicationHearings } from "@/lib/hearings/facts";
import {
  type CaptureHealth,
  captureHealth,
  cnjLabel,
  isPublicationCategory,
  LATE_HOURS,
  PUBLICATION_LIST_COLUMNS,
  type PublicationCategory,
  PUBLICATIONS_SHOWN,
  type PublicationView,
} from "@/lib/publications/publications";
import { type PublicationReading, readingsOf } from "@/lib/publications/reading-words";
import { djenCertificateUrl } from "@flyee/courts/providers/djen";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What the screen of publications reads (migration 0028), under the
 * person's own session: row-level security shows the publications and the
 * readings of their firm only, and what the AI said of each is not among
 * the columns a member may read. A list reads the start and the end of each
 * text, never the texts whole. A read that fails throws: a screen shows an
 * error, never a firm with nothing published.
 */

/** A publication, as a row of the screen. */
export type PublicationRow = {
  id: string;
  court: string;
  cnj: string;
  /** The day it was made available, as YYYY-MM-DD. */
  availableOn: string;
  kind: string;
  documentType: string | null;
  unit: string | null;
  className: string | null;
  /** The start of the text, as plain text, and its end when the text is long. */
  head: string;
  tail: string | null;
  /** The text kept is not the whole of what the court published. */
  truncated: boolean;
  /** The case in the court's own system, when the DJEN gave its address. */
  link: string | null;
  /** The certificate of the communication, as the DJEN itself issues it. */
  certificateUrl: string;
  active: boolean;
  cancelReason: string | null;
  cancelledLabel: string | null;
  /** The court cancelled it after somebody had triaged it, and nobody said they saw that yet. */
  cancelUnseen: boolean;
  /** The lawyers of the firm it was addressed to. */
  lawyers: string[];
  /** The case of the firm it belongs to, when its number is of a lawsuit of the firm. */
  caseId: string | null;
  caseSeq: number | null;
  /** The firm's lawsuit it is of, and its kind (`juizado`, `comum`), when it is of one. */
  proceedingId: string | null;
  proceedingKind: string | null;
  /** The hearings written from it. */
  hearings: PublicationHearing[];
  /** Its deadlines still open: what was counted from it, and their days. */
  deadlines: PublicationDeadline[];
  /** What ONE read of it, triaged as a deadline or a hearing (0040). */
  readings: PublicationReading[];
  /** A deadline came from it, whatever became of it since (done, dismissed): what ONE left to a person was done. */
  anyDeadline: boolean;
  /** Who writes hearings said its hearing needs nothing more in the agenda (0037). */
  hearingSettled: boolean;
  category: PublicationCategory | null;
  note: string | null;
  triagedBy: string | null;
  triagedLabel: string | null;
  /** Its word is the AI's (a category out of the shadow, 0035) and no person said one since. */
  byAi: boolean;
  /** The AI's word waits for a person's check. */
  reviewDue: boolean;
  /** Who checked the AI's word, and when. */
  reviewedBy: string | null;
  reviewedLabel: string | null;
  /**
   * Of a decision, whether it is the lawsuit's judgment (0096): what the app read of its words (`rule`) or what a
   * person said (`person`); null while nobody could tell, when the person is asked.
   */
  judgment: { value: boolean; source: "rule" | "person" } | null;
};

/**
 * What changed of a publication since a screen read it: what ONE read of it, its deadlines and hearings, and
 * whether a person did by hand what ONE left them. `readAt` is when the screen asked, by the person's own clock:
 * what was read after a triage the person made is newer than that triage.
 */
export type PublicationProgress = {
  readings: PublicationReading[];
  deadlines: PublicationDeadline[];
  hearings: PublicationHearing[];
  anyDeadline: boolean;
  hearingSettled: boolean;
  readAt: number;
};

/** The publications, of some, that any deadline came from. A read that fails says none: the screens ask again. */
async function publicationsWithDeadline(
  supabase: SupabaseClient,
  firmId: string,
  publicationIds: readonly string[],
): Promise<Set<string>> {
  if (publicationIds.length === 0) return new Set();
  const { data, error } = await supabase
    .from("deadlines")
    .select("publication_id")
    .eq("org_id", firmId)
    .in("publication_id", [...publicationIds]);
  if (error) return new Set();
  return new Set(((data ?? []) as { publication_id: string | null }[]).flatMap((row) => row.publication_id ?? []));
}

/**
 * What ONE read of some publications, and the deadlines and hearings that
 * came from them, read again while ONE reads them (a screen holds its list
 * and asks for this instead of reading the list again).
 */
export async function publicationProgress(
  supabase: SupabaseClient,
  firmId: string,
  publicationIds: readonly string[],
  readAt: number,
): Promise<Record<string, PublicationProgress>> {
  const ids = [...publicationIds];
  if (ids.length === 0) return {};
  const [deadlines, hearings, readings, withDeadline, settled] = await Promise.all([
    publicationDeadlines(supabase, firmId, ids),
    publicationHearings(supabase, firmId, ids),
    supabase
      .from("publication_readings")
      .select("publication_id, kind, status, reason")
      .eq("org_id", firmId)
      .in("publication_id", ids),
    publicationsWithDeadline(supabase, firmId, ids),
    supabase.from("publications").select("id, hearing_settled_at").eq("org_id", firmId).in("id", ids),
  ]);
  if (readings.error || settled.error) throw new Error("what ONE read of the publications could not be read");
  const read = readingsOf(readings.data);
  const settledIds = new Set(
    ((settled.data ?? []) as { id: string; hearing_settled_at: string | null }[]).flatMap((row) =>
      row.hearing_settled_at ? [row.id] : [],
    ),
  );
  return Object.fromEntries(
    ids.map((id) => [
      id,
      {
        readings: read.get(id) ?? [],
        deadlines: deadlines.get(id) ?? [],
        hearings: hearings.get(id) ?? [],
        anyDeadline: withDeadline.has(id),
        hearingSettled: settledIds.has(id),
        readAt,
      },
    ]),
  );
}

/** A communication a reading could not keep, by what tells it apart. */
export type LeftOutItem = {
  court: string | null;
  /** The day it was made available, as YYYY-MM-DD, when it said one. */
  day: string | null;
  /** Its certificate at the DJEN, when it came with the hash the DJEN names it by. */
  certificateUrl: string | null;
};

/** How the reading of one registration is doing. */
export type CaptureRow = {
  id: string;
  lawyer: string;
  uf: string;
  number: string;
  health: CaptureHealth;
  /** The last day read, as YYYY-MM-DD. */
  capturedThrough: string | null;
  capturedLabel: string | null;
  error: string | null;
  /** The day a reading in course stopped at, as YYYY-MM-DD: the days from it on are still to read. */
  stoppedAt: string | null;
  /** Communications addressed to the registration that a recent reading could not keep, and when. */
  leftOut: number;
  leftOutLabel: string | null;
  /** The ones of them that can be told apart, a few at most. */
  leftOutItems: LeftOutItem[];
};

/** A reading that stopped: nobody of the firm holds the registration anymore. */
export type StoppedRow = {
  id: string;
  lawyer: string;
  uf: string;
  number: string;
  /** When it stopped. */
  stoppedLabel: string | null;
  /** The last day it read, as YYYY-MM-DD. */
  readThrough: string | null;
};

export type PublicationCounts = { untriaged: number; review: number; triaged: number; cancelled: number };

/** What the AI's word is, for the firm (0035): the categories it is the triage of, with the share checked, and whether the firm lets it be. */
export type AiTriage = {
  firmAllows: boolean;
  sampled: { category: PublicationCategory; samplePercent: number }[];
};

export type PublicationsData = {
  rows: PublicationRow[];
  /** The page shown, from 0, and whether there is one after it. */
  page: number;
  more: boolean;
  counts: PublicationCounts;
  aiTriage: AiTriage;
  /** The readings made, and the registrations of the team no reading has seen yet. */
  captures: CaptureRow[];
  /** The readings that stopped, the latest first. */
  stopped: StoppedRow[];
  /** Somebody of the firm has a registration at the bar on record. */
  hasRegistrations: boolean;
  /** When this was read: what tells a reading of the page from the one before it. */
  readAt: string;
};

type Row = {
  id: string;
  hash: string;
  court: string;
  cnj: string;
  available_on: string;
  kind: string;
  document_type: string | null;
  head: string;
  tail: string | null;
  truncated: boolean;
  link: string | null;
  unit: string | null;
  class_name: string | null;
  active: boolean;
  cancel_reason: string | null;
  cancelled_at: string | null;
  cancel_seen_at: string | null;
  cancel_pending: boolean;
  lawyer_ids: string[] | null;
  case_id: string | null;
  proceeding_id: string | null;
  category: string | null;
  note: string | null;
  triaged_by: string | null;
  triaged_at: string | null;
  ai_applied: boolean | null;
  review_due: boolean | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  hearing_settled_at: string | null;
};

type CaptureRecord = {
  id: string;
  user_id: string | null;
  uf: string;
  number: string;
  active: boolean;
  deactivated_at: string | null;
  captured_through: string | null;
  captured_at: string | null;
  created_at: string;
  resume_from: string | null;
  requested_at: string | null;
  claimed_at: string | null;
  error: string | null;
  last_skipped: number;
  skipped_at: string | null;
  skipped_items: unknown;
};

type RegistrationRecord = { id: string; user_id: string; uf: string; number: string; created_at: string };

type TeamRow = { user_id: string; display_name: string | null; email: string | null; joined_at?: string | null };

const COLUMNS = PUBLICATION_LIST_COLUMNS.join(", ");

/** What a reading left out stays said this long after the reading that left it, when the setting does not say. */
const LEFT_OUT_DAYS = 7;
/** How many readings that stopped the screen names. */
const STOPPED_SHOWN = 20;

const nameOf = (person: TeamRow): string => person.display_name?.trim() || person.email?.split("@")[0] || "";

async function teamOf(supabase: SupabaseClient, firmId: string) {
  const { data, error } = await supabase.rpc("firm_team", { target_org: firmId });
  if (error) throw new Error("the team could not be read");
  const people = (data ?? []) as TeamRow[];
  return {
    names: new Map(people.map((person) => [person.user_id, nameOf(person)])),
    joined: new Map(people.map((person) => [person.user_id, person.joined_at ?? null])),
  };
}

async function toRows(
  supabase: SupabaseClient,
  firmId: string,
  raw: Row[],
  names: Map<string, string>,
  timeZone: string | null | undefined,
): Promise<PublicationRow[]> {
  const caseIds = [...new Set(raw.flatMap((row) => (row.case_id ? [row.case_id] : [])))];
  const lawsuitIds = [...new Set(raw.flatMap((row) => (row.proceeding_id ? [row.proceeding_id] : [])))];
  const ids = raw.map((row) => row.id);
  const [cases, lawsuits, deadlines, hearings, readings, withDeadline] = await Promise.all([
    caseIds.length > 0
      ? supabase.from("cases").select("id, seq").eq("org_id", firmId).in("id", caseIds)
      : Promise.resolve({ data: [], error: null }),
    lawsuitIds.length > 0
      ? supabase.from("proceedings").select("id, kind").eq("org_id", firmId).in("id", lawsuitIds)
      : Promise.resolve({ data: [], error: null }),
    publicationDeadlines(
      supabase,
      firmId,
      raw.map((row) => row.id),
    ),
    publicationHearings(
      supabase,
      firmId,
      raw.map((row) => row.id),
    ),
    ids.length > 0
      ? supabase
          .from("publication_readings")
          .select("publication_id, kind, status, reason")
          .eq("org_id", firmId)
          .in("publication_id", ids)
      : Promise.resolve({ data: [], error: null }),
    publicationsWithDeadline(supabase, firmId, ids),
  ]);
  if (cases.error || lawsuits.error) throw new Error("the cases of the publications could not be read");
  // The word on the judgment of the decisions, read apart: a database without it (before 0096) leaves it unsaid.
  const decisions = raw.filter((row) => row.category === "decisao").map((row) => row.id);
  const judged = new Map<string, { value: boolean; source: "rule" | "person" }>();
  if (decisions.length > 0) {
    const { data, error } = await supabase
      .from("publications")
      .select("id, judgment, judgment_source")
      .eq("org_id", firmId)
      .in("id", decisions);
    if (!error) {
      for (const found of (data ?? []) as { id: string; judgment: boolean | null; judgment_source: string | null }[]) {
        if (
          typeof found.judgment === "boolean" &&
          (found.judgment_source === "rule" || found.judgment_source === "person")
        ) {
          judged.set(found.id, { value: found.judgment, source: found.judgment_source });
        }
      }
    }
  }
  if (readings.error) throw new Error("what ONE read of the publications could not be read");
  const read = readingsOf(readings.data);
  const seqs = new Map(((cases.data ?? []) as { id: string; seq: number }[]).map((found) => [found.id, found.seq]));
  const kinds = new Map(
    ((lawsuits.data ?? []) as { id: string; kind: string }[]).map((found) => [found.id, found.kind]),
  );
  return raw.map((row) => ({
    id: row.id,
    court: row.court,
    cnj: cnjLabel(row.cnj),
    availableOn: row.available_on,
    kind: row.kind,
    documentType: row.document_type,
    unit: row.unit,
    className: row.class_name,
    head: row.head,
    tail: row.tail,
    truncated: Boolean(row.truncated),
    link: row.link,
    certificateUrl: djenCertificateUrl(row.hash),
    active: row.active,
    cancelReason: row.cancel_reason,
    cancelledLabel: row.cancelled_at ? momentLabel(row.cancelled_at, timeZone) : null,
    cancelUnseen: Boolean(row.cancel_pending),
    lawyers: (row.lawyer_ids ?? []).flatMap((id) => names.get(id) || []),
    caseId: row.case_id,
    caseSeq: row.case_id ? (seqs.get(row.case_id) ?? null) : null,
    proceedingId: row.proceeding_id,
    proceedingKind: row.proceeding_id ? (kinds.get(row.proceeding_id) ?? null) : null,
    deadlines: deadlines.get(row.id) ?? [],
    hearings: hearings.get(row.id) ?? [],
    readings: read.get(row.id) ?? [],
    anyDeadline: withDeadline.has(row.id),
    hearingSettled: Boolean(row.hearing_settled_at),
    category: isPublicationCategory(row.category) ? row.category : null,
    note: row.note,
    triagedBy: row.triaged_by ? names.get(row.triaged_by) || null : null,
    triagedLabel: row.triaged_at ? momentLabel(row.triaged_at, timeZone) : null,
    byAi: Boolean(row.ai_applied) && row.triaged_by === null && row.category !== null,
    reviewDue: Boolean(row.review_due),
    reviewedBy: row.reviewed_by ? names.get(row.reviewed_by) || null : null,
    reviewedLabel: row.reviewed_at ? momentLabel(row.reviewed_at, timeZone) : null,
    judgment: judged.get(row.id) ?? null,
  }));
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const HASH = /^[A-Za-z0-9_-]{8,80}$/;
const COURT = /^[A-Z0-9-]{2,12}$/;

/** What a reading kept of the communications it left out, read as nothing more than it may be. */
function leftOutItems(kept: unknown): LeftOutItem[] {
  if (!Array.isArray(kept)) return [];
  return kept.slice(0, 20).flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const { hash, court, day } = item as Record<string, unknown>;
    return [
      {
        court: typeof court === "string" && COURT.test(court) ? court : null,
        day: typeof day === "string" && DAY.test(day) ? day : null,
        certificateUrl: typeof hash === "string" && HASH.test(hash) ? djenCertificateUrl(hash) : null,
      },
    ];
  });
}

/**
 * A page of one of the three lists, with the counts of each and how the firm's reading is doing. Under a module
 * (0078), the lists and their counts are of the publications of that module's cases: one of a lawsuit the firm has
 * no case of is read with every module only.
 */
export async function loadPublications(
  supabase: SupabaseClient,
  firmId: string,
  view: PublicationView,
  page: number,
  timeZone: string | null | undefined,
  module: string | null = null,
): Promise<PublicationsData> {
  const from = Math.max(Math.floor(page), 0) * PUBLICATIONS_SHOWN;
  const list = module
    ? supabase
        .from("publications")
        .select(`${COLUMNS}, cases!inner(module)`)
        .eq("org_id", firmId)
        .eq("cases.module", module)
    : supabase.from("publications").select(COLUMNS).eq("org_id", firmId);
  const shown =
    view === "por-triar"
      ? // The oldest first: its time has been running the longest.
        list.is("category", null).eq("active", true).order("available_on", { ascending: true })
      : view === "conferir"
        ? // The AI's word chosen for a check: the oldest first, its time has been running the longest.
          list.eq("review_due", true).eq("active", true).order("available_on", { ascending: true })
        : view === "triadas"
          ? list.not("category", "is", null).eq("active", true).order("triaged_at", { ascending: false })
          : // What a court took back: the ones somebody had triaged and nobody saw yet first, then the latest.
            list
              .eq("active", false)
              .order("cancel_pending", { ascending: false })
              .order("cancelled_at", { ascending: false });
  const count = () =>
    module
      ? supabase
          .from("publications")
          .select("id, cases!inner(module)", { count: "exact", head: true })
          .eq("org_id", firmId)
          .eq("cases.module", module)
      : supabase.from("publications").select("id", { count: "exact", head: true }).eq("org_id", firmId);

  const [rows, untriaged, review, triaged, cancelled, captures, registrations, team, settings, policies, firm] =
    await Promise.all([
      shown.order("id", { ascending: true }).range(from, from + PUBLICATIONS_SHOWN),
      count().is("category", null).eq("active", true),
      count().eq("review_due", true).eq("active", true),
      count().not("category", "is", null).eq("active", true),
      count().eq("active", false),
      supabase
        .from("djen_captures")
        .select(
          "id, user_id, uf, number, active, deactivated_at, captured_through, captured_at, created_at, resume_from, requested_at, claimed_at, error, last_skipped, skipped_at, skipped_items",
        )
        .eq("org_id", firmId)
        .order("uf")
        .order("number"),
      // The registrations the person may read are their own and their colleagues': the team's.
      supabase.from("oab_registrations").select("id, user_id, uf, number, created_at"),
      teamOf(supabase, firmId),
      supabase.from("platform_settings").select("value").eq("key", "publications").maybeSingle(),
      // Which categories the AI's word is the triage of (0035), and whether the firm lets it be.
      supabase.from("publication_triage_policies").select("category, mode, sample_percent").eq("mode", "sampled"),
      supabase.from("organizations").select("publication_ai_triage").eq("id", firmId).maybeSingle(),
    ]);
  if (
    rows.error ||
    untriaged.error ||
    review.error ||
    triaged.error ||
    cancelled.error ||
    captures.error ||
    registrations.error ||
    policies.error ||
    firm.error
  ) {
    throw new Error("publications could not be read");
  }
  // The setting says after how long a reading is late and how long what it left out stays said.
  const setting = (settings.data?.value as Record<string, unknown> | null | undefined) ?? {};
  const positive = (value: unknown, fallback: number) =>
    Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : fallback;
  const lateHours = positive(setting.late_hours, LATE_HOURS);
  const leftOutDays = positive(setting.left_out_days, LEFT_OUT_DAYS);

  const raw = (rows.data ?? []) as unknown as Row[];
  const now = new Date();
  const all = (captures.data ?? []) as CaptureRecord[];
  const read = all.filter((capture) => capture.active);
  const held = ((registrations.data ?? []) as RegistrationRecord[]).filter((registration) =>
    team.names.has(registration.user_id),
  );

  const reading: CaptureRow[] = read.map((capture) => {
    const recent =
      capture.skipped_at !== null &&
      now.getTime() - new Date(capture.skipped_at).getTime() < leftOutDays * 86_400_000 &&
      Number(capture.last_skipped) > 0;
    const leftOut = recent ? Number(capture.last_skipped) : 0;
    return {
      id: capture.id,
      lawyer: capture.user_id ? (team.names.get(capture.user_id) ?? "") : "",
      uf: capture.uf,
      number: capture.number,
      health: captureHealth(
        {
          capturedAt: capture.captured_at,
          createdAt: capture.created_at,
          claimedAt: capture.claimed_at,
          resumeFrom: capture.resume_from,
          requestedAt: capture.requested_at,
          error: capture.error,
          leftOut,
        },
        now,
        lateHours,
      ),
      capturedThrough: capture.captured_through,
      capturedLabel: capture.captured_at ? momentLabel(capture.captured_at, timeZone) : null,
      error: capture.error,
      stoppedAt: capture.resume_from,
      leftOut,
      leftOutLabel: recent && capture.skipped_at ? momentLabel(capture.skipped_at, timeZone) : null,
      leftOutItems: recent ? leftOutItems(capture.skipped_items) : [],
    };
  });
  // A registration of the team no reading has seen yet. It waits for the next pass of the reading; one
  // that has waited for longer than a reading may be late means the reading itself is not running, and
  // it is said as late: nothing else would say it.
  const seen = new Set(read.map((capture) => `${capture.uf}:${capture.number}`));
  const unseen: CaptureRow[] = held
    .filter((registration) => !seen.has(`${registration.uf}:${registration.number}`))
    .map((registration) => {
      const joined = team.joined.get(registration.user_id);
      const since = joined && joined > registration.created_at ? joined : registration.created_at;
      return {
        id: `registration:${registration.id}`,
        lawyer: team.names.get(registration.user_id) ?? "",
        uf: registration.uf,
        number: registration.number,
        health: captureHealth(
          { capturedAt: null, createdAt: since, claimedAt: null, resumeFrom: null, requestedAt: null, error: null },
          now,
          lateHours,
        ),
        capturedThrough: null,
        capturedLabel: null,
        error: null,
        stoppedAt: null,
        leftOut: 0,
        leftOutLabel: null,
        leftOutItems: [],
      };
    });

  return {
    rows: await toRows(supabase, firmId, raw.slice(0, PUBLICATIONS_SHOWN), team.names, timeZone),
    page: Math.max(Math.floor(page), 0),
    more: raw.length > PUBLICATIONS_SHOWN,
    counts: {
      untriaged: untriaged.count ?? 0,
      review: review.count ?? 0,
      triaged: triaged.count ?? 0,
      cancelled: cancelled.count ?? 0,
    },
    aiTriage: {
      // Off until a partner turns it on: only a firm that said yes lets the AI's answer be its triage.
      firmAllows: firm.data?.publication_ai_triage === true,
      sampled: ((policies.data ?? []) as { category: string; sample_percent: number }[]).flatMap((policy) =>
        isPublicationCategory(policy.category)
          ? [{ category: policy.category, samplePercent: policy.sample_percent }]
          : [],
      ),
    },
    captures: [...reading, ...unseen].sort((a, b) => a.uf.localeCompare(b.uf) || a.number.localeCompare(b.number)),
    stopped: all
      .filter((capture) => !capture.active)
      .sort((a, b) => String(b.deactivated_at ?? "").localeCompare(String(a.deactivated_at ?? "")))
      .slice(0, STOPPED_SHOWN)
      .map((capture) => ({
        id: capture.id,
        lawyer: capture.user_id ? (team.names.get(capture.user_id) ?? "") : "",
        uf: capture.uf,
        number: capture.number,
        stoppedLabel: capture.deactivated_at ? momentLabel(capture.deactivated_at, timeZone) : null,
        readThrough: capture.captured_through,
      })),
    hasRegistrations: held.length > 0,
    readAt: now.toISOString(),
  };
}

/**
 * The publications of a case number, wherever they are (to triage, triaged
 * or cancelled), the newest first: how a person finds one again. The number
 * is its 20 digits, or the first of them.
 */
export async function findPublications(
  supabase: SupabaseClient,
  firmId: string,
  cnjDigits: string,
  timeZone: string | null | undefined,
): Promise<{ rows: PublicationRow[]; more: boolean }> {
  const base = supabase.from("publications").select(COLUMNS).eq("org_id", firmId);
  const matching = cnjDigits.length === 20 ? base.eq("cnj", cnjDigits) : base.like("cnj", `${cnjDigits}%`);
  const [rows, team] = await Promise.all([
    matching
      .order("available_on", { ascending: false })
      .order("id", { ascending: true })
      .limit(PUBLICATIONS_SHOWN + 1),
    teamOf(supabase, firmId),
  ]);
  if (rows.error) throw new Error("publications could not be searched");
  const raw = (rows.data ?? []) as unknown as Row[];
  return {
    rows: await toRows(supabase, firmId, raw.slice(0, PUBLICATIONS_SHOWN), team.names, timeZone),
    more: raw.length > PUBLICATIONS_SHOWN,
  };
}
