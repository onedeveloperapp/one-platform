import "server-only";

import { type AccountState, accountStateOf } from "@/lib/cases/account";
import type { PersonData, RequiredDocument } from "@/lib/cases/cases";
import { type ClientFreeJustice, clientFreeJusticeOf } from "@/lib/cases/free-justice";
import { type InterviewView, interviewViewOf } from "@/lib/cases/interview";
import { type ClientJudgment, clientJudgmentsOf } from "@/lib/cases/judgment-paths";
import { type ClientPieceFacts, clientPieceFactsOf } from "@/lib/cases/piece-facts";
import { type PriorComplaint, priorComplaintOf } from "@/lib/cases/prior-complaint";
import { createAnonClient } from "@/lib/public-content";
import { type ClientPublicationNews, clientPublicationNewsOf } from "@/lib/publications/actions-read";

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
      /** The dispensable documents of the case's kind of problem, and where each stands (0177). */
      dispensables?: ClientDispensable[];
    };

/** A dispensable document of a case (0177): asked once, and the case goes on with "não tenho" or after some days. */
export type ClientDispensable = { kind: string; label: string; state: "sent" | "not_have" | "expired" | "asked" };

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
  /**
   * Who signs the same document beside this person (migration 0224): each minor of 16 or 17 they assist, with their
   * own address at ZapSign and whether they signed.
   */
  assisted?: { name: string; sign_url: string | null; signed_at: string | null }[];
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
  /** The firm is ordering it again with what the client said or answered (0090). */
  reordering: boolean;
  /** What the order of the facts says is missing, asked of the client while they may still answer (0090). */
  questions: string[];
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
 * Whether the client is told on WhatsApp (`client_link_notices`, migration 0088): nobody is asked to agree, so the
 * link says where the notices go and lets the client stop them; whether they asked to stop (on this link or to the
 * firm), and whether their number wrote SAIR to the firm.
 */
export type ClientNotices = {
  /** The firm has a kind of notice on: it tells its clients something on WhatsApp. */
  active: boolean;
  /** The firm's name, as the notices are signed. */
  firm: string | null;
  phone: string | null;
  stopped: boolean;
  stopped_at: string | null;
  opted_out: boolean;
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

/**
 * A bill of the link's person in somebody else's name the firm accepted (`client_link_residence`, migration 0123): whose
 * it is, the city on it, what they answered so far, and whether the declaration was issued already.
 */
export type ClientResidenceItem = {
  id: string;
  holder: string;
  city: string | null;
  relation: string | null;
  note: string | null;
  answered_at: string | null;
  issued: boolean;
};

export type ClientTasks = {
  /** Where the case's account of what happened stands (0090); null when it could not be read. */
  account: AccountState | null;
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
  /** The interview of the case (0095), one question per screen; null with none, or when it could not be read. */
  interview: InterviewView | null;
  /** The complaint before the lawsuit the case's unit asks (0180); null when none is asked or it could not be read. */
  priorComplaint: PriorComplaint | null;
  /** The facts of the case's pieces the client is asked to confirm (0182). */
  pieceFacts: ClientPieceFacts[];
  /** The judgments of the client's lawsuits and their word on an appeal's costs (0185). */
  judgments: ClientJudgment[];
  /** What the publications of the case mean for the client, and what the firm asks of them (0186). */
  publicationNews: ClientPublicationNews[];
  /** What the link asks about a bill in somebody else's name (0123); none when it could not be read. */
  residence: ClientResidenceItem[];
  /** What the link asks about free justice in the civil court (0125); null when it could not be read. */
  freeJustice: ClientFreeJustice | null;
};

/** What the link asks the client to sign, to accept and to confirm, and what it tells them. Read only: no visit is counted. */
export async function readClientTasks(token: string): Promise<ClientTasks> {
  const supabase = isTokenShape(token) ? createAnonClient() : null;
  if (!supabase) {
    return {
      account: null,
      signatures: [],
      terms: [],
      statements: [],
      course: [],
      notices: null,
      civilCourt: null,
      agency: null,
      interview: null,
      residence: [],
      freeJustice: null,
      priorComplaint: null,
      pieceFacts: [],
      judgments: [],
      publicationNews: [],
    };
  }
  const [
    signatures,
    terms,
    statements,
    course,
    notices,
    civil,
    agency,
    interview,
    residence,
    justice,
    complaint,
    facts,
    judged,
    news,
  ] = await Promise.all([
    supabase.rpc("client_link_signatures", { target_token: token }),
    supabase.rpc("client_link_terms", { target_token: token }),
    supabase.rpc("client_link_statements", { target_token: token }),
    supabase.rpc("client_link_course", { target_token: token }),
    supabase.rpc("client_link_notices", { target_token: token }),
    supabase.rpc("client_link_civil_court", { target_token: token }),
    supabase.rpc("client_link_agency", { target_token: token }),
    supabase.rpc("client_link_interview", { target_token: token }),
    supabase.rpc("client_link_residence", { target_token: token }),
    supabase.rpc("client_link_free_justice", { target_token: token }),
    supabase.rpc("client_link_prior_complaint", { target_token: token }),
    supabase.rpc("client_link_piece_facts", { target_token: token }),
    supabase.rpc("client_link_judgment_paths", { target_token: token }),
    supabase.rpc("client_link_publication_news", { target_token: token }),
  ]);
  const owned = residence.error ? null : (residence.data as { ok?: boolean; items?: unknown } | null);
  const handed = agency.data as { ok?: boolean; agency?: unknown; finished?: unknown } | null;
  const asked = civil.data as { ok?: boolean; items?: unknown } | null;
  const told = notices.data as (ClientNotices & { ok?: boolean }) | null;
  const interviewed = interview.error ? null : (interview.data as { ok?: boolean; interview?: unknown } | null);
  return {
    interview: interviewed?.ok ? interviewViewOf(interviewed.interview) : null,
    signatures: ((signatures.data as { signatures?: ClientSignature[] } | null)?.signatures ?? []) as ClientSignature[],
    terms: ((terms.data as { terms?: ClientTerm[] } | null)?.terms ?? []) as ClientTerm[],
    account: accountStateOf((statements.data as { account?: unknown } | null)?.account),
    statements: ((statements.data as { statements?: ClientStatement[] } | null)?.statements ?? []).map((statement) => ({
      ...statement,
      reordering: statement.reordering === true,
      questions: Array.isArray(statement.questions)
        ? statement.questions.filter((question): question is string => typeof question === "string")
        : [],
    })),
    course: ((course.data as { lawsuits?: ClientLawsuit[] } | null)?.lawsuits ?? []) as ClientLawsuit[],
    notices:
      told?.ok === true
        ? {
            active: told.active === true,
            firm: typeof told.firm === "string" && told.firm ? told.firm : null,
            phone: told.phone ?? null,
            stopped: told.stopped === true,
            stopped_at: told.stopped_at ?? null,
            opted_out: told.opted_out === true,
          }
        : null,
    civilCourt:
      asked?.ok === true && Array.isArray(asked.items)
        ? (asked.items as ClientCivilCourtItem[]).filter(
            (item) => typeof item?.party_id === "string" && typeof item?.name === "string",
          )
        : null,
    agency: handed?.ok === true && typeof handed.agency === "string" && handed.finished !== true ? handed.agency : null,
    residence:
      owned?.ok === true && Array.isArray(owned.items)
        ? (owned.items as ClientResidenceItem[]).filter(
            (item) => typeof item?.id === "string" && typeof item?.holder === "string",
          )
        : [],
    freeJustice: justice.error ? null : clientFreeJusticeOf(justice.data),
    pieceFacts: facts.error ? [] : clientPieceFactsOf(facts.data),
    judgments: judged.error ? [] : clientJudgmentsOf(judged.data),
    publicationNews: news.error ? [] : clientPublicationNewsOf(news.data),
    priorComplaint: (() => {
      const read = complaint.error ? null : priorComplaintOf(complaint.data);
      return read && read.state !== "not_required" ? read : null;
    })(),
  };
}
