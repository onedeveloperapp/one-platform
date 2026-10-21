import { eventIdOf } from "@flyee/calendar/event-id";
import type { CalendarEvent } from "@flyee/calendar/types";
import { formatCnj } from "@flyee/rules/cnj";

/**
 * The pure rules of the firm's hearings on the screens and in its calendar
 * (migration 0037): the kinds, the ways and the states of a hearing and the
 * words of each, the lists of `/agenda`, how a moment is said in the zone
 * of the hearing, and the event a hearing becomes in the firm's Google
 * calendar (`eventOf`). Nothing here decides a date.
 */

export const HEARING_KINDS = ["conciliacao", "instrucao", "una", "outra"] as const;
export type HearingKind = (typeof HEARING_KINDS)[number];
export const isHearingKind = (value: unknown): value is HearingKind =>
  (HEARING_KINDS as readonly unknown[]).includes(value);

export const HEARING_MODES = ["presencial", "videoconferencia", "hibrida"] as const;
export type HearingMode = (typeof HEARING_MODES)[number];
export const isHearingMode = (value: unknown): value is HearingMode =>
  (HEARING_MODES as readonly unknown[]).includes(value);

export const HEARING_STATUSES = ["scheduled", "held", "cancelled"] as const;
export type HearingStatus = (typeof HEARING_STATUSES)[number];
export const isHearingStatus = (value: unknown): value is HearingStatus =>
  (HEARING_STATUSES as readonly unknown[]).includes(value);

export const HEARING_OUTCOMES = ["acordo", "sem_acordo", "outro"] as const;
export type HearingOutcome = (typeof HEARING_OUTCOMES)[number];
export const isHearingOutcome = (value: unknown): value is HearingOutcome =>
  (HEARING_OUTCOMES as readonly unknown[]).includes(value);

/** The lists of `/agenda`, in the order the screen shows them (`firm_hearings`). */
export const HEARING_VIEWS = ["proximas", "sem_resultado", "realizadas", "canceladas"] as const;
export type HearingView = (typeof HEARING_VIEWS)[number];
export const isHearingView = (value: unknown): value is HearingView =>
  (HEARING_VIEWS as readonly unknown[]).includes(value);

/** How many hearings a page of a list shows. */
export const HEARINGS_SHOWN = 25;

/** The address of a list and its page: the first list and the first page say nothing. */
export function agendaAddress(view: HearingView, page: number): string {
  const query = new URLSearchParams();
  if (view !== "proximas") query.set("ver", view);
  if (page > 0) query.set("pagina", String(page + 1));
  const text = query.toString();
  return text ? `/agenda?${text}` : "/agenda";
}

/** The last page of a list of this many, from 0. */
export const lastAgendaPage = (total: number): number => Math.max(Math.ceil(total / HEARINGS_SHOWN) - 1, 0);

export const KIND_KEY: Record<HearingKind, string> = {
  conciliacao: "hearing-kind-conciliacao",
  instrucao: "hearing-kind-instrucao",
  una: "hearing-kind-una",
  outra: "hearing-kind-outra",
};

export const MODE_KEY: Record<HearingMode, string> = {
  presencial: "hearing-mode-presencial",
  videoconferencia: "hearing-mode-videoconferencia",
  hibrida: "hearing-mode-hibrida",
};

export const STATUS_KEY: Record<HearingStatus, string> = {
  scheduled: "hearing-status-scheduled",
  held: "hearing-status-held",
  cancelled: "hearing-status-cancelled",
};

/** The choice of what came of a hearing. */
export const OUTCOME_KEY: Record<HearingOutcome, string> = {
  acordo: "hearing-outcome-acordo",
  sem_acordo: "hearing-outcome-sem-acordo",
  outro: "hearing-outcome-outro",
};

/** What a held hearing's card says of it. */
export const OUTCOME_SAID_KEY: Record<HearingOutcome, string> = {
  acordo: "hearing-said-acordo",
  sem_acordo: "hearing-said-sem-acordo",
  outro: "hearing-said-outro",
};

export const VIEW_KEY: Record<HearingView, { label: string; hint: string; emptyTitle: string; emptyBody: string }> = {
  proximas: {
    label: "agenda-view-next",
    hint: "agenda-view-next-hint",
    emptyTitle: "agenda-empty-next-title",
    emptyBody: "agenda-empty-next-body",
  },
  sem_resultado: {
    label: "agenda-view-unresolved",
    hint: "agenda-view-unresolved-hint",
    emptyTitle: "agenda-empty-unresolved-title",
    emptyBody: "agenda-empty-unresolved-body",
  },
  realizadas: {
    label: "agenda-view-held",
    hint: "agenda-view-held-hint",
    emptyTitle: "agenda-empty-held-title",
    emptyBody: "agenda-empty-held-body",
  },
  canceladas: {
    label: "agenda-view-cancelled",
    hint: "agenda-view-cancelled-hint",
    emptyTitle: "agenda-empty-cancelled-title",
    emptyBody: "agenda-empty-cancelled-body",
  },
};

/**
 * The zones a hearing in Brazil may be said in (Decreto nº 2.784/1913 as Lei
 * nº 12.876/2013 wrote it), each with its words; Brasília's needs none.
 */
export const HEARING_ZONES = [
  "America/Sao_Paulo",
  "America/Manaus",
  "America/Boa_Vista",
  "America/Porto_Velho",
  "America/Cuiaba",
  "America/Campo_Grande",
  "America/Rio_Branco",
  "America/Eirunepe",
  "America/Noronha",
] as const;
export type HearingZone = (typeof HEARING_ZONES)[number];
export const isHearingZone = (value: unknown): value is HearingZone =>
  (HEARING_ZONES as readonly unknown[]).includes(value);

export const ZONE_KEY: Record<HearingZone, string> = {
  "America/Sao_Paulo": "hearing-zone-brasilia",
  "America/Manaus": "hearing-zone-manaus",
  "America/Boa_Vista": "hearing-zone-roraima",
  "America/Porto_Velho": "hearing-zone-rondonia",
  "America/Cuiaba": "hearing-zone-mato-grosso",
  "America/Campo_Grande": "hearing-zone-mato-grosso-do-sul",
  "America/Rio_Branco": "hearing-zone-acre",
  "America/Eirunepe": "hearing-zone-west-amazonas",
  "America/Noronha": "hearing-zone-noronha",
};

/** What a refusal of the database or of an action is called on the screen. */
const ERROR_KEY: Record<string, string> = {
  not_found: "hearing-error-not-found",
  not_allowed: "hearing-error-not-allowed",
  not_allowed_in_support_session: "hearing-error-support",
  not_filed: "hearing-error-not-filed",
  duplicate: "hearing-error-duplicate",
  closed: "hearing-error-closed",
  reason_required: "hearing-error-reason",
  zone_required: "hearing-error-zone",
  invalid_data: "hearing-error-invalid",
};

/**
 * The zones of a lawsuit's court (`courts.time_zone` and `other_zones`,
 * migration 0037): its seat's, and the ones some of its comarcas keep. A
 * court with more than one has no zone a hearing is taken to be in: the
 * person says which.
 */
export type CourtZones = { seat: string; others: string[] };

/** The zone a new hearing's form starts on: the seat's when it is the court's only one, none otherwise. */
export const startingZone = (zones: CourtZones | null | undefined): string =>
  zones && zones.others.length === 0 && isHearingZone(zones.seat) ? zones.seat : "";

export const hearingErrorKey = (code: string | null | undefined): string =>
  ERROR_KEY[code ?? ""] ?? "hearing-error-failed";

/** The fields the database names in a refusal, for the message beside each. */
export const HEARING_FIELDS = [
  "kind",
  "mode",
  "day",
  "time",
  "time_zone",
  "place",
  "link",
  "attendee_user_id",
  "attendee_name",
  "publication_id",
  "note",
  "outcome",
] as const;
export const isHearingField = (value: unknown): value is (typeof HEARING_FIELDS)[number] =>
  (HEARING_FIELDS as readonly unknown[]).includes(value);

/** A moment, said in a zone: its day as people write it, its weekday, its time, and the day as the form takes it. */
export function momentIn(
  at: string,
  zone: string,
): { day: string; weekday: string; time: string; isoDay: string; isoTime: string } {
  const date = new Date(at);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("pt-BR", {
      timeZone: zone,
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  ) as Record<string, string>;
  const weekday = new Intl.DateTimeFormat("pt-BR", { timeZone: zone, weekday: "long" }).format(date);
  return {
    day: `${parts.day}/${parts.month}/${parts.year}`,
    weekday,
    time: `${parts.hour}:${parts.minute}`,
    isoDay: `${parts.year}-${parts.month}-${parts.day}`,
    isoTime: `${parts.hour}:${parts.minute}`,
  };
}

/** What a hearing's event is written from (`hearing_to_sync`). */
export type HearingToSync = {
  id: string;
  org_id: string;
  claim: number;
  revision: number;
  status: string;
  kind: string;
  starts_at: string;
  time_zone: string;
  duration_minutes: number;
  mode: string;
  place: string | null;
  link: string | null;
  attendee: string | null;
  outcome: string | null;
  case_id: string;
  case_seq: number | null;
  cnj: string | null;
  court: string | null;
  comarca: string | null;
  unit: string | null;
  calendar_id: string;
  connection_id: string;
  synced_calendar: string | null;
};

/** The words of a hearing in the firm's calendar: plain Portuguese, read by the firm's people in Google. */
const EVENT_KIND: Record<string, string> = {
  conciliacao: "Audiência de conciliação",
  instrucao: "Audiência de instrução e julgamento",
  una: "Audiência una",
  outra: "Audiência",
};
const EVENT_MODE: Record<string, string> = {
  presencial: "Presencial",
  videoconferencia: "Por videoconferência",
  hibrida: "Híbrida, presencial ou por videoconferência",
};
const EVENT_OUTCOME: Record<string, string> = {
  acordo: "com acordo",
  sem_acordo: "sem acordo",
  outro: "com outro resultado",
};

/**
 * The event of a hearing in the firm's calendar: what it is and of which
 * case, when (in the hearing's zone), how and where, who of the firm
 * attends, and the case's address in ONE. Nobody of the case is named: the
 * calendar is shared and shows on phones, and a name written there would
 * outlive a correction or an erasure in ONE. A hearing held says so in its
 * title.
 */
export function eventOf(read: HearingToSync, siteUrl: string): CalendarEvent {
  const kind = EVENT_KIND[read.kind] ?? "Audiência";
  const title = [
    read.status === "held"
      ? `Realizada${read.outcome && EVENT_OUTCOME[read.outcome] ? ` ${EVENT_OUTCOME[read.outcome]}` : ""}: ${kind}`
      : kind,
    read.case_seq !== null ? `Caso ${read.case_seq}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const lawsuit = [read.cnj ? `Processo ${formatCnj(read.cnj) ?? read.cnj}` : null, read.court, read.comarca, read.unit]
    .filter(Boolean)
    .join(" · ");
  const caseUrl = `${siteUrl.replace(/\/+$/, "")}/casos/${read.case_id}`;
  const description = [
    lawsuit,
    EVENT_MODE[read.mode] ?? null,
    read.place ? `Local: ${read.place}` : null,
    read.link ? `Link: ${read.link}` : null,
    read.attendee ? `Quem vai: ${read.attendee}` : null,
    `No ONE: ${caseUrl}`,
    "Agenda escrita pelo ONE. Uma mudança feita aqui some quando a audiência mudar no ONE.",
  ]
    .filter(Boolean)
    .join("\n");
  const start = new Date(read.starts_at);
  const end = new Date(start.getTime() + Math.max(read.duration_minutes, 1) * 60_000);
  return {
    id: eventIdOf(read.id),
    summary: title,
    description,
    location: read.place ?? read.link ?? null,
    start: start.toISOString(),
    end: end.toISOString(),
    timeZone: read.time_zone,
    sourceUrl: caseUrl,
  };
}
