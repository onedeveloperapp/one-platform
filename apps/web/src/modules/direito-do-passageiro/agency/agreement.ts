import {
  CONSENT_ANSWERS,
  type ConsentAnswer,
  type PaxDocumentKind,
  type PaxLeg,
  paxLegsOf,
  READING_STATES,
  type ReadingState,
  TRIP_STATES,
  type TripState,
} from "@/modules/direito-do-passageiro/agency/passengers";

/**
 * The page a passenger of a travel agency opens from the agency's link (migration 0070, `pax_link_open`): who
 * the agency and the firm are, the words to agree to (ONE's, then the clause of the agency's contract), who the
 * link answers for, their trips and their documents. Pure: the reader of the database's answer.
 *
 * The passenger has no account: the token in the address is their way in, for the adult it was issued to and
 * the children they answer for, until the agency issues another or it expires.
 */

export type AgreementDocument = {
  id: string;
  kind: PaxDocumentKind;
  tripId: string | null;
  reading: ReadingState;
  name: string;
  legible: boolean | null;
  matches: boolean | null;
};

export type AgreementPerson = {
  id: string;
  fullName: string;
  isHolder: boolean;
  minor: boolean;
  hasPhone: boolean;
  documents: AgreementDocument[];
};

export type AgreementTrip = { id: string; locator: string | null; state: TripState; legs: PaxLeg[] };

export type AgreementView =
  | { state: "missing" }
  | { state: "ended"; agency: string }
  | { state: "expired"; agency: string }
  | { state: "partnership_ended"; agency: string }
  | {
      state: "open" | "handed_over";
      agency: string;
      firm: string;
      expiresAt: string;
      uploadsLeft: number;
      /** Null while the agency has no clause: nothing can be agreed to then. */
      wording: string | null;
      consent: ConsentAnswer | null;
      people: AgreementPerson[];
      trips: AgreementTrip[];
    };

type Raw = Record<string, unknown>;
const record = (value: unknown): Raw =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Raw) : {};
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown): string | null => (typeof value === "string" && value.length > 0 ? value : null);
const oneOf = <T extends string>(values: readonly T[], value: unknown): T | null =>
  (values as readonly unknown[]).includes(value) ? (value as T) : null;

const KINDS: readonly PaxDocumentKind[] = ["identity", "address_proof", "ticket", "boarding_pass"];

export function agreementViewOf(raw: unknown): AgreementView {
  const answer = record(raw);
  if (answer.found !== true) return { state: "missing" };
  const agency = text(answer.agency) ?? "";
  if (answer.state === "ended") return { state: "ended", agency };
  if (answer.state === "expired") return { state: "expired", agency };
  if (answer.state === "partnership_ended") return { state: "partnership_ended", agency };
  if (answer.state !== "open" && answer.state !== "handed_over") return { state: "missing" };
  return {
    state: answer.state,
    agency,
    firm: text(answer.firm) ?? "",
    expiresAt: text(answer.expires_at) ?? "",
    uploadsLeft: Math.max(0, Math.trunc(Number(answer.uploads_left ?? 0)) || 0),
    wording: text(answer.wording),
    consent: oneOf(CONSENT_ANSWERS, answer.consent),
    people: list(answer.people).flatMap((item): AgreementPerson[] => {
      const person = record(item);
      const id = text(person.id);
      if (!id) return [];
      return [
        {
          id,
          fullName: text(person.full_name) ?? "",
          isHolder: person.is_holder === true,
          minor: person.minor === true,
          hasPhone: person.has_phone === true,
          documents: list(person.documents).flatMap((entry): AgreementDocument[] => {
            const document = record(entry);
            const documentId = text(document.id);
            const kind = oneOf(KINDS, document.kind);
            if (!documentId || !kind) return [];
            return [
              {
                id: documentId,
                kind,
                tripId: text(document.trip_id),
                reading: oneOf(READING_STATES, document.reading) ?? "pending",
                name: text(document.name) ?? "",
                legible: typeof document.legible === "boolean" ? document.legible : null,
                matches: document.matches === "sim" ? true : document.matches === "nao" ? false : null,
              },
            ];
          }),
        },
      ];
    }),
    trips: list(answer.trips).flatMap((item): AgreementTrip[] => {
      const trip = record(item);
      const id = text(trip.id);
      if (!id) return [];
      return [
        {
          id,
          locator: text(trip.locator),
          state: oneOf(TRIP_STATES, trip.state) ?? "waiting_consent",
          legs: paxLegsOf(trip.legs),
        },
      ];
    }),
  };
}

/** A token is what a link carries: 43 characters of base64url. Anything else opens nothing. */
export const isAgreementToken = (token: string): boolean => /^[A-Za-z0-9_-]{32,128}$/.test(token);

/** What ONE does of a trip now, in words for the passenger themself (`product` namespace). */
export const LINK_TRIP_STATE_KEY: Record<TripState, string> = {
  waiting_consent: "pax-link-trip-waiting",
  watching: "pax-link-trip-watching",
  alerted: "pax-link-trip-alerted",
  case_opened: "pax-link-trip-case",
  declined: "pax-link-trip-declined",
  stopped: "pax-link-trip-stopped",
};

/** What a document of the passenger is now, in words for them (`product` namespace). */
export function agreementDocumentKey(document: AgreementDocument): string {
  if (document.reading === "pending" || document.reading === "working") return "pax-link-document-reading";
  if (document.reading === "failed") return "pax-link-document-received";
  if (document.matches === false) return "pax-link-document-other";
  if (document.legible === false) return "pax-link-document-illegible";
  return "pax-link-document-ok";
}
