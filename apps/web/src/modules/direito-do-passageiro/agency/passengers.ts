/**
 * The agency's area of the passenger module (migration 0070): the passengers a travel agency adds under its
 * partnership with a firm, their trips and documents, and the link on which each passenger agrees that ONE follows
 * their flights. Pure: the readers of the database's answers, the forms' values, and the `product` message key of
 * every state and refusal, spelled out so the catalog check sees each one.
 *
 * Nothing of this reaches the firm before the passenger says yes to talk to it about a problem: the agency reads
 * its own rows, the firm none of them.
 */

import type { PersonData } from "@/lib/cases/cases";
import type { PersonField } from "@/lib/cases/forms";

export const PAX_DOCUMENT_KINDS = ["identity", "address_proof", "ticket", "boarding_pass"] as const;
export type PaxDocumentKind = (typeof PAX_DOCUMENT_KINDS)[number];

/** A document of the person, and one of a trip they are on (which names the trip). */
export const PERSON_DOCUMENT_KINDS: readonly PaxDocumentKind[] = ["identity", "address_proof"];
export const TRIP_DOCUMENT_KINDS: readonly PaxDocumentKind[] = ["ticket", "boarding_pass"];
export const isTripDocument = (kind: PaxDocumentKind): boolean => TRIP_DOCUMENT_KINDS.includes(kind);

export const CONSENT_ANSWERS = ["agreed", "declined", "withdrawn"] as const;
export type ConsentAnswer = (typeof CONSENT_ANSWERS)[number];

export const TRIP_STATES = ["waiting_consent", "watching", "alerted", "case_opened", "declined", "stopped"] as const;
export type TripState = (typeof TRIP_STATES)[number];

export const READING_STATES = ["pending", "working", "done", "failed"] as const;
export type ReadingState = (typeof READING_STATES)[number];

/**
 * Where an agency's passenger stands in the funnel (migration 0194, `pax_stage`), the same funnel as the firm's seen by
 * the agency (the owner, 2026-11-11): a contact, a lead (their agreement to be followed is in force), or with the firm
 * (a trip of theirs became a case; the agency is never told whether they signed).
 */
export const PAX_STAGES = ["contact", "lead", "firm"] as const;
export type PaxStage = (typeof PAX_STAGES)[number];

export const PAX_FILTERS = [
  "all",
  "contact",
  "lead",
  "firm",
  "upcoming",
  "missing_identity",
  "waiting_consent",
] as const;
export type PaxFilter = (typeof PAX_FILTERS)[number];

/** How many passengers a page of the list holds. */
export const PAX_PAGE_SIZE = 25;

/** The fields of a passenger, as the database names them. */
export const PAX_FIELDS = [
  "full_name",
  "cpf",
  "birth_date",
  "phone",
  "email",
  "nationality",
  "postal_code",
  "street",
  "address_number",
  "complement",
  "district",
  "city",
  "uf",
] as const;
export type PaxField = (typeof PAX_FIELDS)[number];

/**
 * Why a passenger's agreement in force no longer covers their trips (migration 0086, `pax_reagree`): their WhatsApp
 * changed since the yes (an agreement covers the WhatsApp it was given at, 0074), or a trip of theirs ONE does not
 * follow (added or completed after the agreement). Null when it covers them, or there is no agreement to speak of.
 */
export const REAGREE_REASONS = ["phone_changed", "trip_waiting"] as const;
export type Reagree = (typeof REAGREE_REASONS)[number];

export type PaxOverview = {
  travelers: number;
  /** How many of them are at each stage of the funnel (0194). */
  contacts: number;
  leads: number;
  withFirm: number;
  adultsWaiting: number;
  missingIdentity: number;
  upcoming: number;
  watched: number;
  /** The version of the agency's clause in force, or null while it registered none. */
  consentTerm: number | null;
};

export type PaxRow = {
  id: string;
  fullName: string;
  cpf: string | null;
  birthDate: string | null;
  phone: string | null;
  guardianId: string | null;
  minor: boolean;
  /** The answer that counts for them: theirs, or for a child the adult's who answers for them. */
  consent: ConsentAnswer | null;
  /** Why that answer, a yes, no longer covers their trips; null when it does. */
  reagree: Reagree | null;
  nextDeparture: string | null;
  handedOver: boolean;
  /** Where they stand in the funnel (0194); a contact where the database did not say. */
  stage: PaxStage;
  kinds: PaxDocumentKind[];
  reading: boolean;
};

export type PaxPage = { rows: PaxRow[]; total: number };

export type PaxLeg = {
  position: number;
  flightNumber: string;
  originIata: string;
  destinationIata: string;
  /** Local times as a ticket prints them, `YYYY-MM-DDTHH:MM`. */
  departure: string;
  arrival: string;
};

export type PaxPerson = { id: string; fullName: string };

export type PaxTrip = {
  id: string;
  locator: string | null;
  holderId: string | null;
  state: TripState;
  travelers: PaxPerson[];
  legs: PaxLeg[];
};

export type PaxDocumentRead = {
  matches: boolean | null;
  legible: boolean | null;
  identified: string;
  note: string;
};

export type PaxDocument = {
  id: string;
  kind: PaxDocumentKind;
  tripId: string | null;
  source: "partner" | "passenger";
  reading: ReadingState;
  readingError: string | null;
  fileId: string | null;
  name: string;
  createdAt: string;
  read: PaxDocumentRead | null;
  /** Went to the firm with a case (0106): the file is the firm's now, and the agency no longer opens it. */
  handed: boolean;
};

export type PaxTraveler = {
  id: string;
  fullName: string;
  cpf: string | null;
  birthDate: string | null;
  phone: string | null;
  email: string | null;
  nationality: string | null;
  postalCode: string | null;
  street: string | null;
  addressNumber: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  uf: string | null;
  guardianId: string | null;
  minor: boolean;
  /** The fields written from what the AI read in a document, until a person writes them. */
  readFields: PaxField[];
  handedOver: boolean;
  /** Started from documents and never confirmed (0083): in no list until the agency confirms it. */
  draft: boolean;
  /** The registered passenger whose CPF the draft's identity carries (0083). */
  duplicateOf: string | null;
};

export type PaxConfirmLink = { createdAt: string; expiresAt: string; open: boolean };

export type PaxDetail = {
  traveler: PaxTraveler;
  guardian: PaxPerson | null;
  children: PaxPerson[];
  documents: PaxDocument[];
  trips: PaxTrip[];
  consent: ConsentAnswer | null;
  /** Why the answer in force, a yes, no longer covers the passenger's trips; null when it does. */
  reagree: Reagree | null;
  consents: { answer: ConsentAnswer; createdAt: string }[];
  confirmLink: PaxConfirmLink | null;
};

// ---------- Reading the database's answers ----------

type Raw = Record<string, unknown>;

const record = (value: unknown): Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Raw) : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);
const whole = (value: unknown): number => {
  const number = typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
  return Number.isFinite(number) ? Math.max(0, Math.trunc(number)) : 0;
};
const flag = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null);

const oneOf = <T extends string>(values: readonly T[], value: unknown): T | null =>
  (values as readonly unknown[]).includes(value) ? (value as T) : null;

export function paxOverviewOf(raw: unknown): PaxOverview {
  const row = record(raw);
  return {
    travelers: whole(row.travelers),
    contacts: whole(row.contacts),
    leads: whole(row.leads),
    withFirm: whole(row.with_firm),
    adultsWaiting: whole(row.adults_waiting),
    missingIdentity: whole(row.missing_identity),
    upcoming: whole(row.upcoming),
    watched: whole(row.watched),
    consentTerm: row.consent_term === null || row.consent_term === undefined ? null : whole(row.consent_term) || null,
  };
}

export function paxPageOf(raw: unknown): PaxPage {
  const answer = record(raw);
  const rows = list(answer.rows).flatMap((item): PaxRow[] => {
    const row = record(item);
    const id = text(row.id);
    const fullName = text(row.full_name);
    if (!id || !fullName) return [];
    return [
      {
        id,
        fullName,
        cpf: text(row.cpf),
        birthDate: text(row.birth_date),
        phone: text(row.phone),
        guardianId: text(row.guardian_id),
        minor: row.minor === true,
        consent: oneOf(CONSENT_ANSWERS, row.consent),
        reagree: oneOf(REAGREE_REASONS, row.reagree),
        nextDeparture: text(row.next_departure),
        handedOver: text(row.handed_over_at) !== null,
        stage: oneOf(PAX_STAGES, row.stage) ?? "contact",
        kinds: list(row.kinds).flatMap((kind) => oneOf(PAX_DOCUMENT_KINDS, kind) ?? []),
        reading: row.reading === true,
      },
    ];
  });
  return { rows, total: whole(answer.total) };
}

const personOf = (raw: unknown): PaxPerson | null => {
  const row = record(raw);
  const id = text(row.id);
  return id ? { id, fullName: text(row.full_name) ?? "" } : null;
};

/** A local time as the database writes it, cut to `YYYY-MM-DDTHH:MM`. */
const localTime = (value: unknown): string => (text(value) ?? "").replace(" ", "T").slice(0, 16);

export function paxLegsOf(raw: unknown): PaxLeg[] {
  return list(raw)
    .flatMap((item): PaxLeg[] => {
      const leg = record(item);
      const flightNumber = text(leg.flight_number);
      if (!flightNumber) return [];
      return [
        {
          position: whole(leg.position),
          flightNumber,
          originIata: text(leg.origin_iata) ?? "",
          destinationIata: text(leg.destination_iata) ?? "",
          departure: localTime(leg.departure),
          arrival: localTime(leg.arrival),
        },
      ];
    })
    .sort((a, b) => a.position - b.position);
}

export function paxTripOf(raw: unknown): PaxTrip | null {
  const trip = record(raw);
  const id = text(trip.id);
  if (!id) return null;
  return {
    id,
    locator: text(trip.locator),
    holderId: text(trip.holder_id),
    state: oneOf(TRIP_STATES, trip.state) ?? "waiting_consent",
    travelers: list(trip.travelers).flatMap((person) => personOf(person) ?? []),
    legs: paxLegsOf(trip.legs),
  };
}

function documentOf(raw: unknown): PaxDocument | null {
  const row = record(raw);
  const id = text(row.id);
  const kind = oneOf(PAX_DOCUMENT_KINDS, row.kind);
  if (!id || !kind) return null;
  const read = record(row.read);
  return {
    id,
    kind,
    tripId: text(row.trip_id),
    source: row.source === "passenger" ? "passenger" : "partner",
    reading: oneOf(READING_STATES, row.reading) ?? "pending",
    readingError: text(row.reading_error),
    fileId: text(row.file_id),
    name: text(row.name) ?? "",
    createdAt: text(row.created_at) ?? "",
    read:
      row.read && typeof row.read === "object"
        ? {
            matches: read.matches === "sim" ? true : read.matches === "nao" ? false : null,
            legible: flag(read.legible),
            identified: text(read.identified) ?? "",
            note: text(read.note) ?? "",
          }
        : null,
    handed: row.handed === true,
  };
}

export function paxDocumentsOf(raw: unknown): PaxDocument[] {
  return list(raw).flatMap((item) => documentOf(item) ?? []);
}

export function paxTravelerOf(raw: unknown): PaxTraveler | null {
  const row = record(raw);
  const id = text(row.id);
  if (!id) return null;
  const read = record(row.read_fields);
  return {
    id,
    fullName: text(row.full_name) ?? "",
    // A draft's CPF is kept apart until the agency confirms it (0083: `draft_cpf`).
    cpf: text(row.cpf) ?? text(row.draft_cpf),
    birthDate: text(row.birth_date),
    phone: text(row.phone),
    email: text(row.email),
    nationality: text(row.nationality),
    postalCode: text(row.postal_code),
    street: text(row.street),
    addressNumber: text(row.address_number),
    complement: text(row.complement),
    district: text(row.district),
    city: text(row.city),
    uf: text(row.uf),
    guardianId: text(row.guardian_id),
    minor: row.minor === true,
    readFields: Object.keys(read).flatMap((field) => oneOf(PAX_FIELDS, field) ?? []),
    handedOver: text(row.handed_over_at) !== null,
    draft: row.draft === true,
    duplicateOf: text(row.duplicate_of),
  };
}

export function paxDetailOf(raw: unknown): PaxDetail | null {
  const answer = record(raw);
  const traveler = paxTravelerOf(answer.traveler);
  if (!traveler) return null;
  const link = record(answer.confirm_link);
  return {
    traveler,
    guardian: personOf(answer.guardian),
    children: list(answer.children).flatMap((child) => personOf(child) ?? []),
    documents: paxDocumentsOf(answer.documents),
    trips: list(answer.trips).flatMap((trip) => paxTripOf(trip) ?? []),
    consent: oneOf(CONSENT_ANSWERS, answer.consent),
    reagree: oneOf(REAGREE_REASONS, answer.reagree),
    consents: list(answer.consents).flatMap((item) => {
      const row = record(item);
      const consent = oneOf(CONSENT_ANSWERS, row.answer);
      return consent ? [{ answer: consent, createdAt: text(row.created_at) ?? "" }] : [];
    }),
    confirmLink: text(link.expires_at)
      ? { createdAt: text(link.created_at) ?? "", expiresAt: text(link.expires_at) ?? "", open: link.open === true }
      : null,
  };
}

// ---------- The forms ----------

/**
 * What the agency is asked of a passenger, in the shared fields of a person (`components/cases/person-fields.tsx`,
 * `lib/cases/forms.ts`, which send only what changed, digits for the masked fields): an adult with their contacts
 * and address, a child by who they are.
 */
export const PAX_ADULT_FORM: readonly PersonField[] = PAX_FIELDS;
export const PAX_MINOR_FORM: readonly PersonField[] = ["full_name", "cpf", "birth_date", "nationality"];

/** A passenger as the shared person form reads one. */
export function paxPersonData(traveler: PaxTraveler | null): Partial<PersonData> {
  if (!traveler) return {};
  return {
    full_name: traveler.fullName,
    cpf: traveler.cpf,
    birth_date: traveler.birthDate,
    phone: traveler.phone,
    email: traveler.email,
    nationality: traveler.nationality,
    postal_code: traveler.postalCode,
    street: traveler.street,
    address_number: traveler.addressNumber,
    complement: traveler.complement,
    district: traveler.district,
    city: traveler.city,
    uf: traveler.uf,
  };
}

/** A leg as the trip form holds it. */
export type PaxLegForm = {
  flightNumber: string;
  originIata: string;
  destinationIata: string;
  departure: string;
  arrival: string;
};

export const emptyLeg = (): PaxLegForm => ({
  flightNumber: "",
  originIata: "",
  destinationIata: "",
  departure: "",
  arrival: "",
});

/**
 * The legs ONE read of a trip's document, as the trip's form holds them (0083: `pax_document_legs`), from the legs
 * the database cleaned, or, when a leg did not pass its checks, from what was read as it was read, for the agency
 * to correct.
 */
export function legFormsOf(raw: unknown): PaxLegForm[] {
  return list(raw).flatMap((item) => {
    const leg = record(item);
    const flightNumber = text(leg.flight_number) ?? "";
    const originIata = text(leg.origin_iata) ?? "";
    const destinationIata = text(leg.destination_iata) ?? "";
    // As the form's local time takes it (`YYYY-MM-DDTHH:MM`), whatever separator or seconds the reading wrote.
    const departure = (text(leg.departure) ?? "").replace(" ", "T").slice(0, 16);
    const arrival = (text(leg.arrival) ?? "").replace(" ", "T").slice(0, 16);
    return flightNumber || originIata || destinationIata || departure || arrival
      ? [{ flightNumber, originIata, destinationIata, departure, arrival }]
      : [];
  });
}

/** What a trip's document gave for the trip's form: its legs, its locator, or why there are none yet. */
export type DocumentLegs =
  | { state: "reading" }
  | { state: "read"; legs: PaxLegForm[]; locator: string; clean: boolean }
  | { state: "none"; note: string | null };

/** The answer of `pax_document_legs`, read. */
export function documentLegsOf(raw: unknown): DocumentLegs {
  const answer = record(raw);
  if (answer.code === "reading") return { state: "reading" };
  const clean = answer.ok === true;
  const legs = legFormsOf(clean ? answer.legs : answer.read);
  if (legs.length === 0) return { state: "none", note: text(answer.note) };
  return { state: "read", legs, locator: (text(answer.locator) ?? "").slice(0, 8), clean };
}

/** The legs of the form as the database takes them, in order. */
export const legsForSave = (legs: readonly PaxLegForm[]) =>
  legs.map((leg) => ({
    flight_number: leg.flightNumber.replace(/\s+/g, "").toUpperCase(),
    origin_iata: leg.originIata.trim().toUpperCase(),
    destination_iata: leg.destinationIata.trim().toUpperCase(),
    departure: leg.departure.slice(0, 16),
    arrival: leg.arrival.slice(0, 16),
  }));

// ---------- Words ----------

/** A local time of a ticket (`YYYY-MM-DDTHH:MM`) as a person reads it: "03/11/2026 14:30". */
export function localTimeLabel(value: string | null): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/.exec(value ?? "");
  if (!match) return "";
  const [, year, month, day, hour, minute] = match;
  return hour ? `${day}/${month}/${year} ${hour}:${minute}` : `${day}/${month}/${year}`;
}

/** A day (`YYYY-MM-DD`) as a person reads it. */
export const dayLabel = (value: string | null): string => localTimeLabel(value);

export const DOCUMENT_KIND_KEY: Record<PaxDocumentKind, string> = {
  identity: "pax-document-identity",
  address_proof: "pax-document-address-proof",
  ticket: "pax-document-ticket",
  boarding_pass: "pax-document-boarding-pass",
};

/** The button that sends a document of each kind. */
export const SEND_DOCUMENT_KEY: Record<PaxDocumentKind, string> = {
  identity: "pax-document-send-identity",
  address_proof: "pax-document-send-address",
  ticket: "pax-document-send-ticket",
  boarding_pass: "pax-document-send-boarding",
};

export const CONSENT_KEY: Record<ConsentAnswer | "none", string> = {
  agreed: "pax-consent-agreed",
  declined: "pax-consent-declined",
  withdrawn: "pax-consent-withdrawn",
  none: "pax-consent-none",
};

/** What the agency is told of a yes that no longer covers the passenger's trips, and why (`product` namespace). */
export const REAGREE_CHIP_KEY = "pax-reagree-chip";
export const REAGREE_KEY: Record<Reagree, string> = {
  phone_changed: "pax-reagree-phone-changed",
  trip_waiting: "pax-reagree-trip-waiting",
};

export const CONSENT_TONE: Record<ConsentAnswer | "none", "positive" | "attention" | "neutral"> = {
  agreed: "positive",
  declined: "neutral",
  withdrawn: "neutral",
  none: "attention",
};

export const TRIP_STATE_KEY: Record<TripState, string> = {
  waiting_consent: "pax-trip-waiting-consent",
  watching: "pax-trip-watching",
  alerted: "pax-trip-alerted",
  case_opened: "pax-trip-case-opened",
  declined: "pax-trip-declined",
  stopped: "pax-trip-stopped",
};

export const TRIP_STATE_TONE: Record<TripState, "positive" | "attention" | "info" | "neutral"> = {
  waiting_consent: "attention",
  watching: "positive",
  alerted: "info",
  case_opened: "info",
  declined: "neutral",
  stopped: "neutral",
};

export const READING_KEY: Record<ReadingState, string> = {
  pending: "pax-reading-pending",
  working: "pax-reading-working",
  done: "pax-reading-done",
  failed: "pax-reading-failed",
};

export const FILTER_KEY: Record<PaxFilter, string> = {
  all: "pax-filter-all",
  contact: "pax-filter-contact",
  lead: "pax-filter-lead",
  firm: "pax-filter-firm",
  waiting_consent: "pax-filter-waiting-consent",
  missing_identity: "pax-filter-missing-identity",
  upcoming: "pax-filter-upcoming",
};

/** The words and the tone of each stage of the funnel, as a row's chip says it (0194). */
export const STAGE_KEY: Record<PaxStage, string> = {
  contact: "pax-stage-contact",
  lead: "pax-stage-lead",
  firm: "pax-stage-firm",
};
export const STAGE_TONE: Record<PaxStage, "neutral" | "info" | "positive"> = {
  contact: "neutral",
  lead: "info",
  firm: "positive",
};

/** The words of a refusal of the agency's functions, of the passenger's link, or of an upload. */
export function paxErrorKey(code: string): string {
  switch (code) {
    case "second_factor_required":
      return "pax-error-second-factor";
    case "not_allowed_in_support_session":
      return "pax-error-support";
    case "not_authorized":
      return "pax-error-not-allowed";
    case "partnership_ended":
      return "pax-error-partnership-ended";
    case "invalid_name":
      return "pax-error-name";
    case "invalid_cpf":
      return "pax-error-cpf";
    case "cpf_in_use":
      return "pax-error-cpf-in-use";
    case "invalid_birth_date":
      return "pax-error-birth-date";
    case "invalid_phone":
    case "no_phone":
      return "pax-error-phone";
    case "invalid_email":
      return "pax-error-email";
    case "invalid_postal_code":
      return "pax-error-postal-code";
    case "invalid_uf":
      return "pax-error-uf";
    case "invalid_guardian":
      return "pax-error-guardian";
    case "traveler_not_found":
    case "trip_not_found":
    case "not_found":
      return "pax-error-not-found";
    case "handed_over":
      return "pax-error-handed-over";
    case "holder_is_minor":
      return "pax-error-holder-minor";
    case "invalid_locator":
      return "pax-error-locator";
    case "invalid_legs":
      return "pax-error-legs";
    case "invalid_flight":
      return "pax-error-flight";
    case "invalid_airport":
      return "pax-error-airport";
    case "invalid_time":
      return "pax-error-time";
    case "too_many_legs":
      return "pax-error-too-many-legs";
    case "too_many_travelers":
      return "pax-error-too-many-travelers";
    case "too_many_children":
      return "pax-error-too-many-children";
    case "trip_locked":
      return "pax-error-trip-locked";
    case "trip_with_firm":
      return "pax-error-trip-with-firm";
    case "invalid_kind":
    case "invalid_trip":
      return "pax-error-document-kind";
    case "type_not_allowed":
      return "pax-error-file-type";
    case "too_large":
    case "invalid_size":
      return "pax-error-file-size";
    case "upload_limit":
      return "pax-error-upload-limit";
    case "not_uploaded":
    case "storage_unavailable":
      return "pax-error-upload";
    case "rejected":
      return "pax-error-file-rejected";
    case "invalid_clause":
      return "pax-error-clause";
    case "no_consent_term":
      return "pax-error-no-clause";
    case "link_not_found":
      return "pax-error-link";
    case "wording_changed":
      return "pax-error-wording";
    case "too_many":
      return "pax-error-too-many";
    case "invalid_rows":
      return "pax-error-rows";
    case "draft":
      return "pax-error-draft";
    case "not_draft":
      return "pax-error-not-draft";
    default:
      return "pax-error-failed";
  }
}

/** Why a document could not be read, as words (`reading_error`). */
export function readingErrorKey(code: string | null): string {
  switch (code) {
    case "image_unreadable":
    case "unsupported_type":
      return "pax-reading-error-file";
    case "provider_not_configured":
    case "backend_not_configured":
    case "no_prompt_version":
      return "pax-reading-error-off";
    default:
      return "pax-reading-error-other";
  }
}
