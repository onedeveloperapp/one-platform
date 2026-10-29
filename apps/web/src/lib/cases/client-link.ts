import "server-only";

import type { PersonData, RequiredDocument } from "@/lib/cases/cases";
import { createAnonClient } from "@/lib/public-content";

/**
 * What a client's link shows (`client_link_open`, migration 0022), read with
 * the anonymous client: the person holding the link has no account, and a
 * person of the firm who opens it to try it is, there, a client too (the
 * timeline and the audit trail say `client`).
 */

export type ClientPerson = PersonData & {
  roles: string[];
  is_holder: boolean;
  /** Every party the person takes in the case (a parent is a claimant and a guardian). */
  party_ids: string[];
  /** The fields ONE read from a document of theirs (migration 0063), as the database keeps them: `readFieldsOf`. */
  read_fields?: unknown;
};

export type ClientSegment = {
  id: string;
  position: number;
  flight_number: string | null;
  origin_iata: string | null;
  destination_iata: string | null;
  scheduled_departure_local: string | null;
  scheduled_arrival_local: string | null;
  actual_departure_local: string | null;
  actual_arrival_local: string | null;
  booking_reference: string | null;
  affected: boolean;
  source: string;
};

export type ClientDocument = {
  id: string;
  kind: string;
  party_id: string | null;
  status: "received" | "accepted" | "rejected";
  rejected_reason: string | null;
  name: string;
  created_at: string;
  /** Whether the backend is still reading it (migration 0024): `pending` or `working` while it is. */
  processing?: string;
};

export type ClientLinkView =
  | { state: "unavailable" }
  | { state: "missing" }
  | { state: "revoked"; firm: string }
  | { state: "expired"; firm: string }
  | {
      state: "open";
      firm: string;
      link: { person_id: string; expires_at: string; finished_at: string | null; uploads_left: number };
      case: {
        seq: number;
        incident: string;
        flight_date: string | null;
        airline: { iata: string; name: string } | null;
        editable: boolean;
      };
      people: ClientPerson[];
      segments: ClientSegment[];
      documents: ClientDocument[];
      required_documents: RequiredDocument[];
    };

/** A token is what a link carries: 43 characters of base64url. Anything else opens nothing. */
export const isTokenShape = (token: string): boolean => /^[A-Za-z0-9_-]{32,128}$/.test(token);

export async function openClientLink(token: string): Promise<ClientLinkView> {
  if (!isTokenShape(token)) return { state: "missing" };
  const supabase = createAnonClient();
  if (!supabase) return { state: "unavailable" };
  const { data, error } = await supabase.rpc("client_link_open", { target_token: token });
  if (error) return { state: "unavailable" };
  const answer = (data ?? {}) as Record<string, unknown>;
  if (!answer.found) return { state: "missing" };
  const firm = String(answer.firm ?? "");
  if (answer.status === "revoked") return { state: "revoked", firm };
  if (answer.status === "expired") return { state: "expired", firm };
  if (answer.status !== "open") return { state: "missing" };
  return { state: "open", firm, ...(answer as Omit<Extract<ClientLinkView, { state: "open" }>, "state" | "firm">) };
}

/** A document the client signs, as their link shows it (`client_link_signatures`, migration 0023). */
export type ClientSignature = {
  id: string;
  method: "zapsign" | "govbr" | "enotariado";
  status: "pending" | "received" | "signed";
  kind: string;
  name: string;
  /** Their own address to sign at ZapSign. */
  sign_url: string | null;
  signed_at: string | null;
  enotariado_url: string | null;
};

/** A text for clients in force, and whether this client accepted it (`client_link_terms`). */
export type ClientTerm = {
  id: string;
  slug: string;
  version: number;
  title: string;
  body_md: string;
  accepted_at: string | null;
};

/**
 * An account the client gave, as their link shows it (`client_link_statements`, migration 0026): never
 * its text back, and its chronology only once the firm approved one.
 */
export type ClientStatement = {
  id: string;
  spoken: boolean;
  sent_at: string;
  /** The audio was reserved and has not arrived. */
  uploading: boolean;
  chronology: string | null;
  chronology_status: "none" | "approved" | "confirmed" | "contested";
  client_note: string | null;
};

/**
 * A lawsuit of the client's, as their link shows it once the court has it (`client_link_course`, migration
 * 0038): its number and court, the next hearing with how to be there, and what the court registered last, in
 * the court's own words.
 */
export type ClientLawsuit = {
  id: string;
  kind: string;
  court: string | null;
  comarca: string | null;
  cnj: string;
  status: "filed" | "closed";
  filed_at: string | null;
  /** The zone of the court's seat: the day of a movement is said in it. */
  time_zone: string;
  next_hearing: {
    kind: string;
    starts_at: string;
    time_zone: string;
    mode: string;
    place: string | null;
    link: string | null;
  } | null;
  movements: { occurred_at: string; title: string }[];
};

/**
 * Whether the client is told on WhatsApp (`client_link_notices`, migration 0038): the number the firm has for
 * them, whether they agreed for it and how, whether they asked the firm to stop, and the words they agree to.
 */
export type ClientNotices = {
  /** The firm has a kind of notice on: it tells its clients something on WhatsApp. */
  active: boolean;
  phone: string | null;
  agreed: boolean;
  agreed_at: string | null;
  opted_out: boolean;
  wording: string | null;
};

/**
 * A claim of a lawsuit planned in the civil court that the link's person answers for (`client_link_civil_court`,
 * migration 0025): their own, or a minor's they answer for, with the words in force and the answer given so far.
 */
export type ClientCivilCourtItem = {
  party_id: string;
  name: string;
  minor: boolean;
  wording: string | null;
  accepted: boolean | null;
  recorded_at: string | null;
  source: "client" | "firm" | null;
};

export type ClientTasks = {
  signatures: ClientSignature[];
  terms: ClientTerm[];
  statements: ClientStatement[];
  course: ClientLawsuit[];
  /** None when it could not be read: the section is then left out. */
  notices: ClientNotices | null;
  /** What the link asks about the civil court; none when it could not be read, and the section is left out. */
  civilCourt: ClientCivilCourtItem[] | null;
  /**
   * The travel agency whose record the case came from (migration 0071), while the client has not said they finished:
   * the link asks them to confirm what came from it. Null for any other case.
   */
  agency: string | null;
};

/** What the link asks the client to sign, to accept and to confirm, and what it tells them. Read only: no visit is counted. */
export async function readClientTasks(token: string): Promise<ClientTasks> {
  const supabase = isTokenShape(token) ? createAnonClient() : null;
  if (!supabase) {
    return { signatures: [], terms: [], statements: [], course: [], notices: null, civilCourt: null, agency: null };
  }
  const [signatures, terms, statements, course, notices, civil, agency] = await Promise.all([
    supabase.rpc("client_link_signatures", { target_token: token }),
    supabase.rpc("client_link_terms", { target_token: token }),
    supabase.rpc("client_link_statements", { target_token: token }),
    supabase.rpc("client_link_course", { target_token: token }),
    supabase.rpc("client_link_notices", { target_token: token }),
    supabase.rpc("client_link_civil_court", { target_token: token }),
    supabase.rpc("client_link_agency", { target_token: token }),
  ]);
  const handed = agency.data as { ok?: boolean; agency?: unknown; finished?: unknown } | null;
  const asked = civil.data as { ok?: boolean; items?: unknown } | null;
  const told = notices.data as (ClientNotices & { ok?: boolean }) | null;
  return {
    signatures: ((signatures.data as { signatures?: ClientSignature[] } | null)?.signatures ?? []) as ClientSignature[],
    terms: ((terms.data as { terms?: ClientTerm[] } | null)?.terms ?? []) as ClientTerm[],
    statements: ((statements.data as { statements?: ClientStatement[] } | null)?.statements ?? []) as ClientStatement[],
    course: ((course.data as { lawsuits?: ClientLawsuit[] } | null)?.lawsuits ?? []) as ClientLawsuit[],
    notices:
      told?.ok === true
        ? {
            active: told.active === true,
            phone: told.phone ?? null,
            agreed: told.agreed === true,
            agreed_at: told.agreed_at ?? null,
            opted_out: told.opted_out === true,
            wording: told.wording ?? null,
          }
        : null,
    civilCourt:
      asked?.ok === true && Array.isArray(asked.items)
        ? (asked.items as ClientCivilCourtItem[]).filter(
            (item) => typeof item?.party_id === "string" && typeof item?.name === "string",
          )
        : null,
    agency: handed?.ok === true && typeof handed.agency === "string" && handed.finished !== true ? handed.agency : null,
  };
}
