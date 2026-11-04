import { isMinorOn } from "@flyee/rules/person";

/**
 * The cases of a firm as the screens read them (migrations 0021 and 0022):
 * the types, the words each stored value is shown with, and the pure rules
 * the screens share with the client's link (what a case is still missing).
 * The reads are in the pages; every write is a function of the database,
 * reached through `lib/cases/actions.ts` and `lib/cases/client-link.ts`.
 */

// The kinds of problem of a case are its module's (`lib/modules/registry.ts`): the passenger's are in
// `modules/direito-do-passageiro/incidents.ts`.

export const CASE_STATUSES = [
  "intake",
  "documents",
  "signature",
  "drafting",
  "ready",
  "filed",
  "closed",
  "declined",
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const ORIGINS = ["agency", "referral", "ads", "organic", "returning_client", "other"] as const;
export type Origin = (typeof ORIGINS)[number];

export const CAUSES = ["undetermined", "internal", "external"] as const;
export type Cause = (typeof CAUSES)[number];

export const MARITAL_STATUSES = ["solteiro", "casado", "uniao_estavel", "divorciado", "separado", "viuvo"] as const;
export type MaritalStatus = (typeof MARITAL_STATUSES)[number];

export const DOCUMENT_KINDS = [
  "identity",
  "address_proof",
  "ticket",
  "boarding_pass",
  "receipt",
  "evidence",
  "power_of_attorney",
  "contract",
  "petition",
  "other",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** What a client may send through their link: never the firm's own papers. */
export const CLIENT_DOCUMENT_KINDS: readonly DocumentKind[] = [
  "identity",
  "address_proof",
  "ticket",
  "boarding_pass",
  "receipt",
  "evidence",
  "other",
];

export const DOCUMENT_STATUSES = ["received", "accepted", "rejected"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

export const UFS = [
  "AC",
  "AL",
  "AM",
  "AP",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MG",
  "MS",
  "MT",
  "PA",
  "PB",
  "PE",
  "PI",
  "PR",
  "RJ",
  "RN",
  "RO",
  "RR",
  "RS",
  "SC",
  "SE",
  "SP",
  "TO",
] as const;

// The `product` message key of each stored value, spelled out so the catalog check sees each one.

export const STATUS_KEY: Record<CaseStatus, string> = {
  intake: "case-status-intake",
  documents: "case-status-documents",
  signature: "case-status-signature",
  drafting: "case-status-drafting",
  ready: "case-status-ready",
  filed: "case-status-filed",
  closed: "case-status-closed",
  declined: "case-status-declined",
};

export const ORIGIN_KEY: Record<Origin, string> = {
  agency: "case-origin-agency",
  referral: "case-origin-referral",
  ads: "case-origin-ads",
  organic: "case-origin-organic",
  returning_client: "case-origin-returning-client",
  other: "case-origin-other",
};

export const CAUSE_KEY: Record<Cause, string> = {
  undetermined: "case-cause-undetermined",
  internal: "case-cause-internal",
  external: "case-cause-external",
};

export const MARITAL_KEY: Record<MaritalStatus, string> = {
  solteiro: "case-marital-solteiro",
  casado: "case-marital-casado",
  uniao_estavel: "case-marital-uniao-estavel",
  divorciado: "case-marital-divorciado",
  separado: "case-marital-separado",
  viuvo: "case-marital-viuvo",
};

export const DOCUMENT_KIND_KEY: Record<DocumentKind, string> = {
  identity: "case-document-identity",
  address_proof: "case-document-address-proof",
  ticket: "case-document-ticket",
  boarding_pass: "case-document-boarding-pass",
  receipt: "case-document-receipt",
  evidence: "case-document-evidence",
  power_of_attorney: "case-document-power-of-attorney",
  contract: "case-document-contract",
  petition: "case-document-petition",
  other: "case-document-other",
};

export const DOCUMENT_STATUS_KEY: Record<DocumentStatus, string> = {
  received: "case-document-status-received",
  accepted: "case-document-status-accepted",
  rejected: "case-document-status-rejected",
};

/** The words of each event of a case's timeline (`case_events.kind`, migration 0022). */
export const EVENT_KEY: Record<string, string> = {
  created: "case-event-created",
  updated: "case-event-updated",
  status_changed: "case-event-status-changed",
  person_saved: "case-event-person-saved",
  party_removed: "case-event-party-removed",
  segment_saved: "case-event-segment-saved",
  segment_removed: "case-event-segment-removed",
  proceeding_saved: "case-event-proceeding-saved",
  proceeding_removed: "case-event-proceeding-removed",
  client_link_created: "case-event-link-created",
  client_link_revoked: "case-event-link-revoked",
  document_added: "case-event-document-added",
  document_accepted: "case-event-document-accepted",
  document_rejected: "case-event-document-rejected",
  client_person_saved: "case-event-client-person-saved",
  client_dependent_added: "case-event-client-dependent-added",
  client_segment_saved: "case-event-client-segment-saved",
  client_segment_removed: "case-event-client-segment-removed",
  client_document_sent: "case-event-client-document-sent",
  client_finished: "case-event-client-finished",
  agency_handoff: "case-event-agency-handoff",
  signature_requested: "case-event-signature-requested",
  paper_issued: "case-event-paper-issued",
  signature_opened: "case-event-signature-opened",
  signature_failed: "case-event-signature-failed",
  signature_uncertain: "case-event-signature-uncertain",
  signature_cancelled: "case-event-signature-cancelled",
  signature_received: "case-event-signature-received",
  signature_signed: "case-event-signature-signed",
  signature_refused: "case-event-signature-refused",
  signature_expired: "case-event-signature-expired",
  client_term_accepted: "case-event-client-term-accepted",
  signature_signed_after_cancel: "case-event-signature-signed-after-cancel",
  segments_read: "case-event-segments-read",
  person_read: "case-event-person-read",
  person_read_confirmed: "case-event-person-read-confirmed",
  notices_stopped: "case-event-notices-stopped",
  notices_resumed: "case-event-notices-resumed",
  notices_agreed: "case-event-notices-agreed",
  notices_withdrawn: "case-event-notices-withdrawn",
  court_system_approved: "case-event-court-system-approved",
  court_system_refused: "case-event-court-system-refused",
  court_system_changed: "case-event-court-system-changed",
  claim_set: "case-event-claim-set",
  claim_defaulted: "case-event-claim-defaulted",
  suspension_saved: "case-event-suspension-saved",
  family_choice_saved: "case-event-family-choice-saved",
  civil_court_answered: "case-event-civil-court-answered",
  civil_court_recorded: "case-event-civil-court-recorded",
  weather_read: "case-event-weather-read",
  statement_added: "case-event-statement-added",
  statement_transcribed: "case-event-statement-transcribed",
  statement_written: "case-event-statement-written",
  statement_removed: "case-event-statement-removed",
  transcription_requested: "case-event-transcription-requested",
  chronology_requested: "case-event-chronology-requested",
  chronology_approved: "case-event-chronology-approved",
  chronology_dismissed: "case-event-chronology-dismissed",
  chronology_returned: "case-event-chronology-returned",
  client_statement_sent: "case-event-client-statement-sent",
  client_chronology_confirmed: "case-event-client-chronology-confirmed",
  client_chronology_contested: "case-event-client-chronology-contested",
  client_statement_completed: "case-event-client-statement-completed",
  account_asked: "case-event-account-asked",
  account_gaps_closed: "case-event-account-gaps-closed",
  interview_started: "case-event-interview-started",
  interview_done: "case-event-interview-done",
  interview_answered: "case-event-interview-answered",
  interview_closed: "case-event-interview-closed",
  complaint_saved: "case-event-complaint-saved",
  complaint_removed: "case-event-complaint-removed",
  filing_package_requested: "case-event-filing-requested",
  filing_package_cancelled: "case-event-filing-cancelled",
  filing_package_ready: "case-event-filing-ready",
  filing_package_failed: "case-event-filing-failed",
  filing_receipt_attached: "case-event-filing-receipt",
  filing_package_signed: "case-event-filing-signed",
  filing_package_signature_failed: "case-event-filing-signature-failed",
  publication_captured: "case-event-publication-captured",
  publication_triaged: "case-event-publication-triaged",
  publication_cancelled: "case-event-publication-cancelled",
  draft_requested: "case-event-draft-requested",
  signers_named: "case-event-signers-named",
  signer_occasional: "case-event-signer-occasional",
  draft_proposed: "case-event-draft-proposed",
  draft_edited: "case-event-draft-edited",
  draft_approved: "case-event-draft-approved",
  draft_rejected: "case-event-draft-rejected",
  draft_returned: "case-event-draft-returned",
  draft_revised: "case-event-draft-revised",
  draft_revision_rejected: "case-event-draft-revision-rejected",
  draft_revision_withdrawn: "case-event-draft-revision-withdrawn",
  draft_revision_failed: "case-event-draft-revision-failed",
  draft_cancelled: "case-event-draft-cancelled",
  draft_failed: "case-event-draft-failed",
  draft_issued: "case-event-draft-issued",
  draft_resumed: "case-event-draft-resumed",
  draft_reopened: "case-event-draft-reopened",
  dossier_requested: "case-event-dossier-requested",
  flight_checked: "case-event-flight-checked",
  flight_looked_up: "case-event-flight-looked-up",
  court_moved: "case-event-court-moved",
  imported: "case-event-imported",
  dossier_issued: "case-event-dossier-issued",
  deadline_proposed: "case-event-deadline-proposed",
  deadline_updated: "case-event-deadline-updated",
  deadline_confirmed: "case-event-deadline-confirmed",
  deadline_done: "case-event-deadline-done",
  deadline_dismissed: "case-event-deadline-dismissed",
  deadline_reopened: "case-event-deadline-reopened",
  hearing_scheduled: "case-event-hearing-scheduled",
  hearing_updated: "case-event-hearing-updated",
  hearing_held: "case-event-hearing-held",
  hearing_cancelled: "case-event-hearing-cancelled",
  hearing_reopened: "case-event-hearing-reopened",
};

/** The words for a refusal the backend made by measuring a file (migration 0018), not a person. */
export const FILE_REFUSAL_KEY: Record<string, string> = {
  empty: "case-file-refused-empty",
  type_not_allowed: "case-file-refused-type",
  too_large: "case-file-refused-size",
  rejected: "case-file-refused-other",
};

export const isCaseStatus = (value: unknown): value is CaseStatus =>
  (CASE_STATUSES as readonly unknown[]).includes(value);
export const isDocumentKind = (value: unknown): value is DocumentKind =>
  (DOCUMENT_KINDS as readonly unknown[]).includes(value);

/** The stages a case still waits on the client in: their link takes what they send. */
export const CLIENT_STAGES: readonly CaseStatus[] = ["intake", "documents", "signature"];

/**
 * Why somebody of a case being gathered still has no link (migration 0046,
 * `case_links_owed`): ONE is sending it, should have by now, or cannot, and
 * why. Each said on the case with what to do.
 */
export const LINK_OWED_REASONS = [
  "sending",
  "late",
  "by_person",
  "no_phone",
  "no_number",
  "no_conversation",
  "opted_out",
  "window_closed",
] as const;
export type LinkOwedReason = (typeof LINK_OWED_REASONS)[number];
export type LinkOwed = { personId: string; reason: LinkOwedReason };

export const LINK_OWED_KEY: Record<LinkOwedReason, string> = {
  sending: "case-link-owed-sending",
  late: "case-link-owed-late",
  by_person: "case-link-owed-by-person",
  no_phone: "case-link-owed-no-phone",
  no_number: "case-link-owed-no-number",
  no_conversation: "case-link-owed-no-conversation",
  opted_out: "case-link-owed-opted-out",
  window_closed: "case-link-owed-window-closed",
};

/** The database's answer, read; null when it is not one. A reason this code does not know is left out. */
export function linksOwedOf(raw: unknown): LinkOwed[] | null {
  if (!Array.isArray(raw)) return null;
  return raw.flatMap((item): LinkOwed[] => {
    const row = (item ?? {}) as { person_id?: unknown; reason?: unknown };
    return typeof row.person_id === "string" && (LINK_OWED_REASONS as readonly unknown[]).includes(row.reason)
      ? [{ personId: row.person_id, reason: row.reason as LinkOwedReason }]
      : [];
  });
}

/** The groups the list of cases filters by. */
export const STATUS_GROUPS = {
  open: ["intake", "documents", "signature"],
  preparing: ["drafting", "ready"],
  filed: ["filed"],
  ended: ["closed", "declined"],
} as const satisfies Record<string, readonly CaseStatus[]>;
export type StatusGroup = keyof typeof STATUS_GROUPS;

export const groupOf = (status: CaseStatus): StatusGroup =>
  (Object.keys(STATUS_GROUPS) as StatusGroup[]).find((group) =>
    (STATUS_GROUPS[group] as readonly CaseStatus[]).includes(status),
  ) ?? "open";

/** A case as people call it: `#12`. */
export const caseLabel = (seq: number): string => `#${seq}`;

/**
 * The ids WhatsApp may know a phone by: as stored (digits with the country
 * code) and, for a Brazilian mobile with the ninth digit, also without it,
 * because accounts older than the ninth digit kept their id.
 */
export function waIdCandidates(phone: string): string[] {
  const digits = phone.replace(/\D/g, "");
  if (!digits) return [];
  const mobile = /^55(\d{2})9(\d{8})$/.exec(digits);
  return mobile ? [digits, `55${mobile[1]}${mobile[2]}`] : [digits];
}

/**
 * A stored phone (digits with the country code) as the phone field types it:
 * a Brazilian number without its `55`, any other as stored.
 */
export function phoneForField(stored: string | null | undefined): string {
  const digits = String(stored ?? "").replace(/\D/g, "");
  return /^55\d{10,11}$/.test(digits) ? digits.slice(2) : digits;
}

/** A stored local time (`2026-10-01T14:30:00`) as a `datetime-local` input holds it. */
export const localTimeForField = (stored: string | null | undefined): string =>
  stored ? String(stored).replace(" ", "T").slice(0, 16) : "";

/** A local time as the ticket prints it, `01/10/2026 14:30`, or an empty string. */
export function formatLocalTime(stored: string | null | undefined): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(String(stored ?? ""));
  return match ? `${match[3]}/${match[2]}/${match[1]} ${match[4]}:${match[5]}` : "";
}

/**
 * The phones a person may be stored under for a WhatsApp id: the id itself
 * and, for a Brazilian mobile WhatsApp knows without the ninth digit, the
 * number with it (how the firm and the client type it).
 */
export function phonesOfWaId(waId: string): string[] {
  const digits = waId.replace(/\D/g, "");
  if (!digits) return [];
  const old = /^55(\d{2})([6-9]\d{7})$/.exec(digits);
  return old ? [digits, `55${old[1]}9${old[2]}`] : [digits];
}

/** The first name a message greets a person by. */
export const firstNameOf = (fullName: string | null | undefined): string =>
  String(fullName ?? "")
    .trim()
    .split(/\s+/)[0] ?? "";

// ---------- What a case is still missing ----------

export type PersonData = {
  person_id: string;
  party_id: string | null;
  full_name: string;
  cpf: string | null;
  birth_date: string | null;
  nationality: string | null;
  marital_status: string | null;
  profession: string | null;
  email: string | null;
  phone: string | null;
  postal_code: string | null;
  street: string | null;
  address_number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  uf: string | null;
};

/** The fields a power of attorney names the client by (an adult; a minor's guardian answers for them). */
export const ADULT_FIELDS = [
  "full_name",
  "nationality",
  "marital_status",
  "profession",
  "cpf",
  "birth_date",
  "postal_code",
  "street",
  "address_number",
  "district",
  "city",
  "uf",
] as const satisfies readonly (keyof PersonData)[];

/** What is asked of a minor who flew: who they are. */
export const MINOR_FIELDS = ["full_name", "cpf", "birth_date"] as const satisfies readonly (keyof PersonData)[];

export type RequiredDocument = { kind: DocumentKind; per: "claimant" | "holder" | "case"; or?: DocumentKind[] };

export type CaseDocumentState = { kind: string; party_id: string | null; status: string };

export type Missing =
  | { type: "fields"; personId: string; name: string; fields: string[] }
  | { type: "document"; kind: DocumentKind; personId: string | null; name: string | null }
  | { type: "flight" };

/** The fields of a person still empty. */
export const missingFields = (person: PersonData, fields: readonly (keyof PersonData)[]): string[] =>
  fields.filter((field) => {
    const value = person[field];
    return value === null || value === undefined || String(value).trim() === "";
  });

/** One document the setting asks of a case: whose it is, and the kinds that answer it. */
export type DocumentNeed = {
  key: string;
  kind: DocumentKind;
  /** The kind asked and the ones accepted in its place (`or`). */
  kinds: string[];
  /** The parties a document must be of, `null` among them meaning the whole case; `null` alone: any. */
  partyIds: (string | null)[] | null;
  personId: string | null;
  name: string | null;
};

/**
 * The documents the setting names (`cases.required_documents`, migration
 * 0022), one need per claimant when it is per claimant. The holder's need is
 * answered by a document of any of the holder's parties in the case (a parent
 * is both a claimant and a guardian), never by one of nobody in particular: a
 * person taken out of the case leaves their papers with no party.
 */
export function documentNeeds(input: {
  holder: PersonData;
  /** Every party of the holder in the case; the holder's own `party_id` when not given. */
  holderPartyIds?: (string | null)[];
  claimants: PersonData[];
  required: RequiredDocument[];
}): DocumentNeed[] {
  const needs: DocumentNeed[] = [];
  for (const rule of input.required) {
    const kinds = [rule.kind, ...(rule.or ?? [])];
    if (rule.per === "case") {
      needs.push({ key: `${rule.kind}-case`, kind: rule.kind, kinds, partyIds: null, personId: null, name: null });
    } else if (rule.per === "holder") {
      needs.push({
        key: `${rule.kind}-holder`,
        kind: rule.kind,
        kinds,
        partyIds: input.holderPartyIds ?? [input.holder.party_id],
        personId: input.holder.person_id,
        name: input.holder.full_name,
      });
    } else {
      for (const person of input.claimants) {
        needs.push({
          key: `${rule.kind}-${person.party_id}`,
          kind: rule.kind,
          kinds,
          partyIds: [person.party_id],
          personId: person.person_id,
          name: person.full_name,
        });
      }
    }
  }
  return needs;
}

/** The documents sent for a need, whatever the firm said of them. */
export const documentsFor = <D extends CaseDocumentState>(need: DocumentNeed, documents: D[]): D[] =>
  documents.filter(
    (document) =>
      need.kinds.includes(document.kind) && (need.partyIds === null || need.partyIds.includes(document.party_id)),
  );

/** A need is met by a document the firm did not refuse (one waiting for the firm counts as sent). */
export const isNeedMet = (need: DocumentNeed, documents: CaseDocumentState[]): boolean =>
  documentsFor(need, documents).some((document) => document.status !== "rejected");

/**
 * What a case still needs before the firm can prepare it, in the order a
 * person fills it: the documents the setting names first (ONE reads a
 * person's data in them, migration 0063), then each person's data, and at
 * least one leg of the trip. `today` decides who is a minor.
 */
export function missingItems(input: {
  holder: PersonData;
  holderPartyIds?: (string | null)[];
  claimants: PersonData[];
  documents: CaseDocumentState[];
  segments: number;
  required: RequiredDocument[];
  today: string;
}): Missing[] {
  const missing: Missing[] = [];
  const isMinor = (person: PersonData) => isMinorOn(person.birth_date, input.today) === true;

  for (const need of documentNeeds(input)) {
    if (!isNeedMet(need, input.documents)) {
      missing.push({ type: "document", kind: need.kind, personId: need.personId, name: need.name });
    }
  }

  const people = [input.holder, ...input.claimants.filter((person) => person.person_id !== input.holder.person_id)];
  for (const person of people) {
    const fields = missingFields(person, isMinor(person) ? MINOR_FIELDS : ADULT_FIELDS);
    if (fields.length > 0) missing.push({ type: "fields", personId: person.person_id, name: person.full_name, fields });
  }

  if (input.segments === 0) missing.push({ type: "flight" });
  return missing;
}

/** A party of a case as what the case lacks reads it. */
export type MissingParty = {
  partyId: string;
  role: "claimant" | "guardian";
  guardianPartyId: string | null;
  person: PersonData;
};

/** Who answers for a case: the first adult claimant, or else a guardian of the minors, never a minor. */
export function caseHolder<P extends MissingParty>(parties: P[], today: string): P | undefined {
  const adult = (party: P) => isMinorOn(party.person.birth_date, today) !== true;
  return (
    parties.find((party) => party.role === "claimant" && !party.guardianPartyId && adult(party)) ??
    parties.find((party) => party.role === "guardian") ??
    parties.find(adult) ??
    parties[0]
  );
}

/**
 * What a case still needs (`missingItems`), read from its parties as the
 * case screen holds them: what the screen lists, and what ONE waits for
 * before it creates the lawsuits by itself (0039).
 */
export function caseMissing(input: {
  parties: MissingParty[];
  documents: CaseDocumentState[];
  segments: number;
  required: RequiredDocument[];
  today: string;
}): Missing[] {
  const holder = caseHolder(input.parties, input.today);
  if (!holder) return [];
  return missingItems({
    holder: holder.person,
    holderPartyIds: input.parties
      .filter((party) => party.person.person_id === holder.person.person_id)
      .map((party) => party.partyId),
    claimants: input.parties.filter((party) => party.role === "claimant").map((party) => party.person),
    documents: input.documents,
    segments: input.segments,
    required: input.required,
    today: input.today,
  });
}

/** The words of each field of a person (`product` namespace). */
export const PERSON_FIELD_KEY: Record<keyof Omit<PersonData, "person_id" | "party_id">, string> = {
  full_name: "case-field-full-name",
  cpf: "case-field-cpf",
  birth_date: "case-field-birth-date",
  nationality: "case-field-nationality",
  marital_status: "case-field-marital-status",
  profession: "case-field-profession",
  email: "case-field-email",
  phone: "case-field-phone",
  postal_code: "case-field-postal-code",
  street: "case-field-street",
  address_number: "case-field-address-number",
  complement: "case-field-complement",
  district: "case-field-district",
  city: "case-field-city",
  uf: "case-field-uf",
};

/** The message key of each answer the case functions give (`product` namespace). */
const ERROR_KEYS: Record<string, string> = {
  forum_incomplete: "case-error-forum-incomplete",
  petition_not_found: "case-error-petition",
  too_many_documents: "case-error-too-many-documents",
  package_closed: "case-error-package-closed",
  package_not_ready: "case-error-package-not-ready",
  not_a_signer: "case-error-not-signer",
  not_ready: "case-error-package-not-ready",
  not_built: "case-error-not-built",
  no_signature: "case-error-no-signature",
  not_the_signer: "case-error-not-the-signer",
  system_signs: "case-error-system-signs",
  package_outdated: "case-error-package-outdated",
  statement_length: "case-error-statement-length",
  statement_limit: "case-error-statement-limit",
  not_transcribed: "case-error-not-transcribed",
  nothing_to_transcribe: "case-error-nothing-to-transcribe",
  transcription_in_progress: "case-error-transcription-in-progress",
  statement_confirmed: "case-error-statement-confirmed",
  nothing_owed: "case-error-nothing-owed",
  work_in_progress: "case-error-work-in-progress",
  chronology_in_progress: "case-error-chronology-in-progress",
  chronology_not_ready: "case-error-chronology-not-ready",
  note_required: "case-error-note-required",
  invalid_date: "case-error-complaint-date",
  document_already_decided: "case-error-document-decided",
  forum_not_linked_to_flight: "case-error-forum-link",
  forum_not_domicile: "case-error-forum-domicile",
  weather_cooldown: "case-error-weather-cooldown",
  minor_in_small_claims: "case-error-minor-juizado",
  family_split_unchosen: "case-error-family-split",
  answer_changed: "case-error-answer-changed",
  family_changed: "case-error-family-changed",
  family_reason_required: "case-error-family-reason",
  proceedings_planned: "case-error-proceedings-planned",
  civil_court_unanswered: "case-error-civil-unanswered",
  power_of_attorney_unsigned: "case-error-power-of-attorney-unsigned",
  // The court system ONE named for a lawsuit and the firm's word on it (0066).
  system_unapproved: "case-error-system-unapproved",
  system_refused: "case-error-system-refused",
  system_unknown: "case-error-system-unknown",
  proceeding_not_planned: "case-error-proceeding-not-planned",
  not_allowed: "case-error-system-not-allowed",
  how_required: "case-error-civil-how",
  no_guardian: "case-error-no-guardian",
  wording_unavailable: "case-error-civil-wording",
  // What the client's link answers about the civil court.
  not_asked: "client-civil-error-not-asked",
  wording_changed: "client-civil-error-changed",
  too_many: "client-civil-error-too-many",
  invalid_amount: "case-error-amount",
  weather_not_configured: "case-error-weather-off",
  weather_key_refused: "case-error-weather-key",
  weather_unavailable: "case-error-weather-unavailable",
  no_airports: "case-error-no-airports",
  ceiling_unknown: "case-error-ceiling",
  domicile_unknown: "case-error-domicile",
  proceedings_exist: "case-error-proceedings-exist",
  no_claimants: "case-error-no-claimants",
  not_allowed_in_support_session: "case-error-support-session",
  not_authorized: "case-error-not-authorized",
  case_not_found: "case-error-not-found",
  not_found: "case-error-not-found",
  person_not_found: "case-error-not-found",
  segment_not_found: "case-error-not-found",
  proceeding_not_found: "case-error-not-found",
  invalid_name: "case-error-name",
  invalid_cpf: "case-error-cpf",
  cpf_in_use: "case-error-cpf-in-use",
  invalid_birth_date: "case-error-birth-date",
  invalid_email: "case-error-email",
  invalid_phone: "case-error-phone",
  invalid_postal_code: "case-error-postal-code",
  invalid_uf: "case-error-uf",
  invalid_marital_status: "case-error-generic-field",
  invalid_nationality: "case-error-generic-field",
  invalid_profession: "case-error-generic-field",
  invalid_street: "case-error-generic-field",
  invalid_address_number: "case-error-generic-field",
  invalid_complement: "case-error-generic-field",
  invalid_district: "case-error-generic-field",
  invalid_city: "case-error-generic-field",
  invalid_data: "case-error-generic-field",
  invalid_value: "case-error-generic-field",
  unknown_field: "case-error-generic-field",
  invalid_position: "case-error-generic-field",
  invalid_kind: "case-error-generic-field",
  invalid_source: "case-error-failed",
  invalid_decision: "case-error-failed",
  already_attached: "case-error-already-attached",
  not_uploaded: "case-error-not-uploaded",
  empty: "case-file-refused-empty",
  rejected: "case-file-refused-other",
  invalid_size: "case-error-file-size",
  purpose_not_allowed: "case-error-file-type",
  storage_unavailable: "case-error-unavailable",
  unavailable: "case-error-unavailable",
  opted_out: "case-error-opted-out",
  unconfirmed: "case-error-unconfirmed",
  not_sent: "case-error-not-sent",
  invalid_status: "case-error-failed",
  second_factor_required: "case-error-second-factor",
  invalid_cause: "case-error-generic-field",
  invalid_origin: "case-error-generic-field",
  invalid_summary: "case-error-generic-field",
  invalid_filed_at: "case-error-generic-field",
  invalid_forum_basis: "case-error-generic-field",
  invalid_system: "case-error-generic-field",
  invalid_role: "case-error-generic-field",
  invalid_result: "case-error-failed",
  invalid_token: "case-error-failed",
  unknown_court: "case-error-court",
  guardian_not_found: "case-error-guardian",
  already_revoked: "case-error-link-closed",
  data_changed: "case-error-cpf-changed",
  too_many_attempts: "case-error-too-many-attempts",
  invalid_method: "case-error-generic-field",
  document_not_found: "case-error-not-found",
  not_for_signature: "case-error-not-for-signature",
  document_rejected: "case-error-document-rejected",
  not_pdf: "case-error-not-pdf",
  signers_required: "case-error-signers",
  invalid_signers: "case-error-signers",
  signer_not_found: "case-error-signers",
  minor_cannot_sign: "case-error-minor-sign",
  already_open: "case-error-signature-open",
  no_signature_account: "case-error-no-signature-account",
  invalid_url: "case-error-url",
  already_ended: "case-error-signature-ended",
  signed_by_provider: "case-error-signed-by-provider",
  not_pending: "case-error-signature-ended",
  terms_required: "case-error-failed",
  term_not_in_force: "case-error-term",
  provider_unavailable: "case-error-unavailable",
  busy: "case-error-signature-busy",
  single_signer: "case-error-single-signer",
  already_signed_at_provider: "case-error-signed-at-provider",
  account_unavailable: "case-error-signature-account",
  unknown_at_provider: "case-error-unknown-at-provider",
  invalid_incident: "case-error-incident",
  unknown_airline: "case-error-airline",
  invalid_flight_date: "case-error-flight-date",
  invalid_flight_number: "case-error-flight-number",
  unknown_airport: "case-error-airport",
  same_airport: "case-error-same-airport",
  invalid_time: "case-error-time",
  invalid_booking_reference: "case-error-booking",
  too_many_segments: "case-error-too-many-segments",
  too_many_people: "case-error-too-many-people",
  reason_required: "case-error-reason",
  last_claimant: "case-error-last-claimant",
  invalid_cnj: "case-error-cnj",
  cnj_of_another_court: "case-error-cnj-court",
  cnj_in_use: "case-error-cnj-in-use",
  cnj_required: "case-error-cnj-required",
  forum_reason_required: "case-error-forum-reason",
  not_a_lawyer: "case-error-not-lawyer",
  party_not_found: "case-error-not-found",
  already_filed: "case-error-already-filed",
  minor_cannot_receive: "case-error-minor-link",
  case_closed: "case-error-case-closed",
  not_a_member: "case-error-not-member",
  file_not_found: "case-error-file",
  type_not_allowed: "case-error-file-type",
  too_large: "case-error-file-size",
  upload_limit: "case-error-upload-limit",
  link_not_open: "case-error-link-closed",
  case_not_editable: "case-error-case-moved",
  cpf_missing: "case-error-cpf-missing",
  birth_date_missing: "case-error-birth-date-missing",
  minor: "case-error-cpf-minor",
  daily_limit: "case-error-cpf-limit",
  lookup_unavailable: "case-error-cpf-unavailable",
  lookup_not_configured: "case-error-cpf-not-configured",
  backend_not_configured: "case-error-backend",
  window_closed: "case-error-window-closed",
  no_conversation: "case-error-no-conversation",
};

export const caseErrorKey = (code: string): string => ERROR_KEYS[code] ?? "case-error-failed";
