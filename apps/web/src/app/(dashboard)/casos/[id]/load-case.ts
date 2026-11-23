import "server-only";

import type { AirlineOption } from "../cases-types";
import {
  type CaseArea,
  type CaseDocument,
  type CaseEnvelope,
  type CaseParty,
  type CaseProceeding,
  type CaseSegment,
  type CaseState,
  type CourtOption,
  type CourtSystem,
  EVENTS_SHOWN,
  type SignatureAhead,
  type TeamMember,
  type UnnamedSigner,
} from "./case-types";
import { cookies } from "next/headers";

import { momentLabel, type SecondFactorState } from "@/lib/ai/approvals";
import { pendingApprovalsOf, type PendingRow } from "@/lib/ai/pending-approvals";
import { scriptOf } from "@/lib/areas/script";
import { caseAdvanceOf } from "@/lib/cases/advance";
import {
  CAUSES,
  isCaseStatus,
  linksOwedOf,
  ORIGINS,
  type RequiredDocument,
  requiredFor,
  versionDocumentsOf,
  withVersionDocuments,
} from "@/lib/cases/cases";
import { dispensablesOf } from "@/lib/cases/client-documents";
import { readCheckAnswer } from "@/lib/cases/document-check";
import { readQuality } from "@/lib/cases/document-quality";
import { loadCasePieces } from "@/lib/cases/draft-facts";
import { caseCostsOf, caseFeesOf } from "@/lib/cases/fees";
import { cloudSigningOffered, loadCaseFilings } from "@/lib/cases/filing-facts";
import { freeJusticeOf } from "@/lib/cases/free-justice";
import { cpfLookup } from "@/lib/cases/identity";
import { courtPublicationsOf, stageMomentsOf } from "@/lib/cases/journey";
import { judgmentPathsOf } from "@/lib/cases/judgment-paths";
import { dataInChatOf } from "@/lib/cases/now";
import { lawsuitFactsOf } from "@/lib/cases/outcomes";
import { casePieceFactsOf } from "@/lib/cases/piece-facts";
import { priorComplaintOf } from "@/lib/cases/prior-complaint";
import { casePulseOf } from "@/lib/cases/pulse";
import { readCaseQualification } from "@/lib/cases/qualification";
import { readFieldsOf } from "@/lib/cases/read-fields";
import { residenceViewsOf } from "@/lib/cases/residence";
import { loadCivilCourt, loadRuleFacts } from "@/lib/cases/rule-facts";
import { assessWeather, caseDomicile, smallClaimsCeiling, tripPlaces } from "@/lib/cases/rules";
import { loadStatementFacts } from "@/lib/cases/statement-facts";
import { CHRONOLOGY_TASK, TRANSCRIPTION_TASK } from "@/lib/cases/statements";
import { lawsuitAmountsOf } from "@/lib/courts/amount";
import { loadCourseFacts } from "@/lib/courts/course-facts";
import { sessionsOf } from "@/lib/courts/sessions";
import { caseDeadlines, deadlineActs } from "@/lib/deadlines/facts";
import { type AutonomyDecision, type AutonomyMode, firmAutonomyOf } from "@/lib/firm/autonomy";
import { isFirmFunction, isManager } from "@/lib/firm/roles";
import { caseHearings, colleagues, courtZones } from "@/lib/hearings/facts";
import { getMemberContext } from "@/lib/member/context";
import { isCaseKindOf } from "@/lib/modules/registry";
import { caseNotices } from "@/lib/notices/facts";
import { publicationActionsOf } from "@/lib/publications/actions-read";
import { loadCasePublications } from "@/lib/publications/facts";
import { signatureAccountOf } from "@/lib/signatures/methods";
import { loadFlightChecks } from "@/modules/direito-do-passageiro/flights/facts";
import { weatherProvider } from "@/modules/direito-do-passageiro/flights/weather";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";
import type { SupabaseClient } from "@supabase/supabase-js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type PersonRow = Record<string, unknown> & { id: string; full_name: string };
type PartyRow = {
  id: string;
  person_id: string;
  role: string;
  guardian_id: string | null;
  people: PersonRow | PersonRow[] | null;
};
type TeamRow = { user_id: string; display_name: string | null; email: string | null; firm_function: string };

type RegistryResult = NonNullable<CaseParty["person"]["registry"]>["result"];
const REGISTRY_RESULTS: readonly RegistryResult[] = ["found", "not_found", "birth_date_mismatch", "minor"];

const one = <T>(value: T | T[] | null): T | null => (Array.isArray(value) ? (value[0] ?? null) : value);

type Embedded<T> = T | T[] | null;

/** The AI's check of a document, from its run: what it suggested, and whether that waits for a person. */
function checkOf(run: Embedded<{ output: unknown; approvals: Embedded<{ status: string }> }>): CaseDocument["check"] {
  const found = one(run);
  const answer = found ? readCheckAnswer(found.output) : null;
  if (!found || !answer) return null;
  return { answer, waiting: one(found.approvals)?.status === "pending" };
}
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/** The lawyers of the planned lawsuits the client's power of attorney does not name (`case_power_signers_missing`). */
function unnamedSignersOf(value: unknown): UnnamedSigner[] {
  return (Array.isArray(value) ? value : []).flatMap((item) => {
    const row = (item ?? {}) as { proceeding_id?: unknown; user_id?: unknown; lawyer?: unknown };
    const proceedingId = text(row.proceeding_id);
    const userId = text(row.user_id);
    return proceedingId && userId ? [{ proceedingId, userId, lawyer: text(row.lawyer) }] : [];
  });
}

/** The planned lawsuits whose cloud signature no lawyer of them covers yet (`case_signature_ahead`). */
function signatureAheadOf(value: unknown): SignatureAhead[] {
  return (Array.isArray(value) ? value : []).flatMap((item) => {
    const row = (item ?? {}) as { proceeding_id?: unknown; viewer_signs?: unknown; viewer_cpf?: unknown };
    const proceedingId = text(row.proceeding_id);
    return proceedingId
      ? [{ proceedingId, viewerSigns: row.viewer_signs === true, viewerCpf: row.viewer_cpf === true }]
      : [];
  });
}

/** The day in Brazil's official time. */
const todayInBrazil = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

type PublicationRow = {
  id: string;
  category: string | null;
  available_on: string;
  judgment: boolean | null;
  readings: { kind: string; status: string }[];
};

/**
 * The publications in force of a case: what its steps in court and its top read. With the word on the judgment and
 * what ONE reads of each (0096, 0040); a database without them is read as it was, every decision unasked.
 */
async function readCasePublications(
  supabase: NonNullable<Awaited<ReturnType<typeof getMemberContext>>>["supabase"],
  firm: string,
  caseId: string,
): Promise<PublicationRow[]> {
  const full = await supabase
    .from("publications")
    .select("id, category, available_on, judgment, publication_readings(kind, status)")
    .eq("case_id", caseId)
    .eq("org_id", firm)
    .eq("active", true);
  if (!full.error) {
    return ((full.data ?? []) as Record<string, unknown>[]).map((row) => ({
      id: String(row.id),
      category: typeof row.category === "string" ? row.category : null,
      available_on: String(row.available_on ?? ""),
      judgment: typeof row.judgment === "boolean" ? row.judgment : null,
      readings: (Array.isArray(row.publication_readings) ? row.publication_readings : []).flatMap((reading) => {
        const value = (reading ?? {}) as { kind?: unknown; status?: unknown };
        return typeof value.kind === "string" && typeof value.status === "string"
          ? [{ kind: value.kind, status: value.status }]
          : [];
      }),
    }));
  }
  const plain = await supabase
    .from("publications")
    .select("id, category, available_on")
    .eq("case_id", caseId)
    .eq("org_id", firm)
    .eq("active", true)
    .in("category", ["decisao", "pagamento"]);
  if (plain.error) return [];
  // Before 0096 every decision judged the case, as the screen read it then.
  return ((plain.data ?? []) as { id: string; category: string; available_on: string }[]).map((row) => ({
    id: row.id,
    category: row.category,
    available_on: row.available_on,
    judgment: row.category === "decisao" ? true : null,
    readings: [],
  }));
}

/**
 * /casos/[id]: one case and everything in it, read under the person's own
 * session (a case of another firm is not found). Every change is a function
 * of the database reached through lib/cases/actions.ts.
 */
export async function loadCase(id: string): Promise<CaseState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };
  if (!UUID.test(id)) return { kind: "not-found" };
  const { supabase } = context;
  const firm = context.firm.id;

  const { data: row, error } = await supabase
    .from("cases")
    .select(
      "id, seq, module, incident, airline_iata, flight_date, cause, status, origin, partnership_id, summary, responsible_id, close_reason, created_at, closed_by_one, close_acked_at, is_test, qualification, qualification_released_by, qualification_released_at, qualification_release_reason, area_id, case_type, area_script_id",
    )
    .eq("id", id)
    .eq("org_id", firm)
    .maybeSingle();
  if (error) return { kind: "error" };
  if (!row || !isCaseStatus(row.status)) return { kind: "not-found" };
  if (row.incident !== null && !isCaseKindOf(row.module, row.incident)) return { kind: "not-found" };
  // The agency a case came from (0071), by the firm's own list of its partnerships.
  let agency: string | null = null;
  if (row.partnership_id) {
    const { data: partners } = await supabase.rpc("firm_partners", { target_org: firm });
    agency =
      ((partners ?? []) as { link_id: string; partner: string }[]).find((link) => link.link_id === row.partnership_id)
        ?.partner ?? null;
  }

  const [
    parties,
    segments,
    documents,
    proceedings,
    links,
    events,
    team,
    airlines,
    courts,
    systems,
    setting,
    envelopes,
    consents,
    signatureAccount,
    cookieStore,
    facts,
    told,
    filings,
    residence,
    freeJustice,
    sessions,
    outcomes,
    costs,
    fees,
    financeAccess,
    documentNeeds,
    priorComplaint,
    pieceFacts,
    amounts,
    judgmentPaths,
    publicationActions,
    hearingBriefs,
  ] = await Promise.all([
    supabase
      .from("case_parties")
      .select(
        "id, person_id, role, guardian_id, people(id, full_name, cpf, birth_date, nationality, marital_status, profession, email, phone, postal_code, street, address_number, complement, district, city, uf, cpf_registry_result, cpf_checked_at, cpf_registry_name, cpf_registry_situation, cpf_registry_regular, cpf_name_matches, updated_via, read_fields)",
      )
      .eq("case_id", id)
      .eq("org_id", firm)
      // The order they joined the case, the same one ONE reads (two who joined at once, by their id).
      .order("created_at")
      .order("id"),
    supabase
      .from("flight_segments")
      .select(
        "id, position, flight_number, origin_iata, destination_iata, scheduled_departure_local, scheduled_arrival_local, actual_departure_local, actual_arrival_local, booking_reference, affected, affected_by, source",
      )
      .eq("case_id", id)
      .eq("org_id", firm)
      .order("position"),
    supabase
      .from("case_documents")
      .select(
        "id, kind, party_id, status, rejected_reason, source, file_id, created_at, envelope_id, processing, processing_error, normalized_file_id, quality, need, files!case_documents_file_id_org_id_fkey(name, detected_mime), ai_runs(output, approvals(status))",
      )
      .eq("case_id", id)
      .eq("org_id", firm)
      .neq("status", "uploading")
      .order("created_at"),
    supabase
      .from("proceedings")
      .select(
        "id, kind, court, comarca, unit, system, cnj, forum_basis, forum_reason, forum_city, comarca_checked, status, filed_at, system_by_one, system_approved_by, system_approved_at, system_refused_by, system_refused_at, system_refused_reason, created_by_one, unit_by_one, court_units(confirmed, scope, prior_complaint), proceeding_parties(party_id), proceeding_lawyers(user_id)",
      )
      .eq("case_id", id)
      .eq("org_id", firm)
      .order("created_at"),
    supabase
      .from("client_links")
      .select(
        "id, person_id, created_at, expires_at, revoked_at, opened_count, last_opened_at, upload_count, finished_at",
      )
      .eq("case_id", id)
      .eq("org_id", firm)
      .order("created_at", { ascending: false })
      .limit(10),
    supabase
      .from("case_events")
      .select("id, at, kind, actor_type, actor_id, data")
      .eq("case_id", id)
      .eq("org_id", firm)
      .order("at", { ascending: false })
      .limit(EVENTS_SHOWN),
    supabase.rpc("firm_team", { target_org: firm }),
    supabase.from("airlines").select("iata, name").eq("active", true).order("name"),
    supabase.from("courts").select("acronym, name, uf").order("uf"),
    supabase.from("court_systems").select("court, proceeding_kind, system, confirmed, notes, file_types, source, host"),
    // The cases' setting, and the documents by problem of the version of the module the case was opened under (0212),
    // which the case reads in its place. A version that could not be read leaves the setting's.
    Promise.all([
      supabase.from("platform_settings").select("value").eq("key", "cases").maybeSingle(),
      supabase.rpc("case_module_version", { target_org: firm, target_case: id }),
    ]).then(([read, version]) => ({ ...read, documents: versionDocumentsOf(version.error ? null : version.data) })),
    supabase
      .from("signature_envelopes")
      .select(
        "id, document_id, method, status, signers, enotariado_url, signed_document_id, last_error, ended_reason, created_at",
      )
      .eq("case_id", id)
      .eq("org_id", firm)
      .order("created_at", { ascending: false }),
    supabase
      .from("client_consents")
      .select("person_id, accepted_at, term_title, term_version")
      .eq("case_id", id)
      .eq("org_id", firm)
      .is("revoked_at", null)
      .order("accepted_at"),
    // The account itself is shown to who manages the firm only; which provider it is (0253), to anybody of it.
    supabase.rpc("firm_signature_account", { target_org: firm }),
    cookies(),
    // What the rules decide on. A read that failed is an error of the page, never a case with no rules.
    loadRuleFacts(supabase, firm, id, Number(todayInBrazil().slice(0, 4))).catch(() => undefined),
    // The accounts and the complaints. A read that failed is an error of the page too.
    loadStatementFacts(supabase, firm, id, context.profile.timezone).catch(() => undefined),
    loadCaseFilings(supabase, firm, id, context.profile.timezone, context.userId).catch(() => undefined),
    // The declarations of residence a bill in somebody else's name owes (0123), with where each stands.
    supabase.rpc("case_residence", { target_case: id }),
    // Each claimant's word on free justice in the civil court (0125), with the declaration of who asks.
    supabase.rpc("case_free_justice", { target_case: id }),
    // The sessions of judgment of the case's appeals, with the limit to register for oral argument (0219).
    supabase.rpc("case_judgment_sessions", { target_case: id }),
    // What each lawsuit came to (0130), in the order it happened.
    supabase
      .from("lawsuit_facts")
      .select(
        "id, proceeding_id, kind, result, appeal_by, release_kind, cents, per_claimant, happened_on, words, by_one, confirmed, ack_owed, acked_at, received_cents, received_on, received_by_one, corrected_at, corrected_reason, claims",
      )
      .eq("case_id", id)
      .order("happened_on", { ascending: true })
      .order("created_at", { ascending: true }),
    // The case's costs and fees (0131): the costs to anybody of the firm, the fees only to who reads the books.
    supabase
      .from("case_costs")
      .select("id, description, cents, spent_on, paid_by, owed_by, absorbed_at, bill_id")
      .eq("case_id", id)
      .order("spent_on", { ascending: true }),
    supabase
      .from("case_fees")
      .select(
        "case_id, entry_cents, installments, installment_cents, success_percent, success_min_cents, settlement_percent, source, bills_at, monthly_cents, monthly_months, hearing_cents, appeal_cents, late_fine_percent, late_interest_percent",
      )
      .eq("case_id", id),
    supabase.rpc("firm_finance_access", { target_org: firm }),
    // The dispensable documents of the case and where each stands (0177).
    supabase.rpc("case_document_needs", { target_case: id }),
    // The complaint before the lawsuit its unit asks, and where it stands (0180).
    supabase.rpc("case_prior_complaint_view", { target_case: id }),
    // The client's check of the facts of each piece (0182).
    supabase.rpc("case_piece_facts", { target_case: id }),
    // What each condemnation is worth today and the next step (0184).
    supabase
      .from("lawsuit_amounts")
      .select(
        "proceeding_id, as_of, corrected_cents, interest_cents, total_cents, missing, needs_terms, deposited_cents, next_step, short_cents, fine_cents, lawsuit_kind, pay_until",
      )
      .eq("case_id", id),
    // What may follow each judgment (0185).
    supabase
      .from("judgment_paths")
      .select("id, proceeding_id, fact_id, stage, client_agrees, client_via, decision, decision_reason, decided_at")
      .eq("case_id", id),
    // What each publication of the case asks, as ONE read it (0186).
    supabase
      .from("publication_actions")
      .select("publication_id, status, action, firm_summary, client_summary, reason, pending")
      .eq("case_id", id),
    // The brief of each hearing for who goes to it (0187).
    supabase.from("hearing_briefs").select("hearing_id, body, made_at, emailed_at").eq("case_id", id),
  ]);
  if (
    parties.error ||
    segments.error ||
    documents.error ||
    proceedings.error ||
    links.error ||
    events.error ||
    team.error ||
    airlines.error ||
    courts.error ||
    systems.error ||
    setting.error ||
    envelopes.error ||
    consents.error ||
    !facts ||
    !told ||
    !filings
  ) {
    return { kind: "error" };
  }

  const teamRows = (team.data ?? []) as TeamRow[];
  const names = new Map(
    teamRows.map((member) => [member.user_id, member.display_name?.trim() || member.email?.split("@")[0] || ""]),
  );
  // The pieces and the dossiers name who asked and who approved. A read that failed is an error of the page.
  const pieces = await loadCasePieces(supabase, firm, id, names, context.profile.timezone).catch(() => undefined);
  if (!pieces) return { kind: "error" };
  // The order of the facts (and a transcription) ONE proposed that waits for a person, decided on the card of what
  // happened, never in a list elsewhere (the owner, 2026-11-05); and whether this session may decide it now. One that
  // could not be read leaves the card saying what it waits for, as before, never the page.
  const statementIds = told.statements.map((statement) => statement.id);
  const [statementApprovals, assurance] = await Promise.all([
    statementIds.length === 0
      ? Promise.resolve([])
      : supabase
          .from("approvals")
          .select(
            "id, run_id, task, approver_functions, created_at, ai_runs!inner(output, subject_type, subject_id), ai_tasks(name, description, revisable)",
          )
          .eq("org_id", firm)
          .eq("status", "pending")
          .in("task", [CHRONOLOGY_TASK, TRANSCRIPTION_TASK])
          .in("ai_runs.subject_id", statementIds)
          .order("created_at")
          .then(async ({ data, error }) =>
            error
              ? []
              : ((await pendingApprovalsOf({
                  supabase,
                  firmId: firm,
                  timeZone: context.profile.timezone,
                  names,
                  rows: (data ?? []) as PendingRow[],
                }).catch(() => null)) ?? []),
          ),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  // `nextLevel` is aal2 exactly when the account has a verified factor; `currentLevel` when this session confirmed it.
  const secondFactor: SecondFactorState =
    assurance.data?.currentLevel === "aal2" ? "ok" : assurance.data?.nextLevel === "aal2" ? "challenge" : "missing";
  // What the official record and FlightAware said of each leg. A read that failed is an error of the page too.
  const flights = await loadFlightChecks(
    supabase,
    firm,
    id,
    (segments.data ?? []) as CaseSegment[],
    context.profile.timezone,
  ).catch(() => undefined);
  if (!flights) return { kind: "error" };
  // The course of each lawsuit as the court shows it. A read that failed is an error of the page too.
  const course = await loadCourseFacts(supabase, firm, id, context.profile.timezone).catch(() => undefined);
  if (!course) return { kind: "error" };
  // The case's deadlines, and the acts of the list for a new one. A read that failed is an error of the page too.
  const [
    deadlines,
    acts,
    hearings,
    people,
    zones,
    notices,
    civilCourt,
    advanced,
    linksOwed,
    stages,
    published,
    unnamedSigners,
    signatureAhead,
    pulse,
    dataInChat,
    autonomy,
    publicationRows,
  ] = await Promise.all([
    caseDeadlines(supabase, firm, id, context.profile.timezone).catch(() => undefined),
    deadlineActs(supabase).catch(() => undefined),
    caseHearings(supabase, firm, id, context.profile.timezone).catch(() => undefined),
    colleagues(supabase, firm).catch(() => undefined),
    courtZones(supabase).catch(() => undefined),
    caseNotices(supabase, id, context.profile.timezone).catch(() => undefined),
    loadCivilCourt(supabase, id).catch(() => undefined),
    // What ONE waits for to carry the case on (0039). A read that failed is an error of the page too.
    supabase
      .from("case_advances")
      .select("waiting, checked_at")
      .eq("case_id", id)
      .eq("org_id", firm)
      .maybeSingle()
      .then(({ data, error }) => (error ? undefined : { advance: caseAdvanceOf(data) })),
    // Who of the case is owed a link and why ONE has not sent it (0046). A read that failed is an error of the page.
    supabase
      .rpc("case_links_owed", { target_case: id })
      .then(({ data, error }) => (error ? undefined : (linksOwedOf(data) ?? undefined))),
    // When the case entered each stage, for its progress: every change, however old (the timeline reads the latest
    // events only). A read that failed is an error of the page too.
    supabase
      .from("case_events")
      .select("at, data")
      .eq("case_id", id)
      .eq("org_id", firm)
      .eq("kind", "status_changed")
      .order("at")
      .then(({ data, error }) => (error ? undefined : stageMomentsOf(data ?? []))),
    // The publications of the case's lawsuits in force: the judgment and the first payment for its steps in court
    // (a decision is the judgment only when it was said to be, 0096), what nobody triaged yet, and what ONE reads of
    // each. One that could not be read leaves those steps unknown (the hearings still say theirs), never the page;
    // a database without the word on the judgment is read as before.
    readCasePublications(supabase, firm, id),
    // The lawyers of the planned lawsuits the client's power of attorney does not name (0093). One that could not be
    // read says nothing of them, never the page.
    supabase
      .rpc("case_power_signers_missing", { target_case: id })
      .then(({ data, error }) => unnamedSignersOf(error ? [] : data)),
    // The planned lawsuits whose files ONE will sign in the cloud and that no lawyer of them covers yet (0102), where
    // a provider of the cloud signature can be used here. One that could not be read says nothing, never the page.
    Promise.all([
      supabase.rpc("case_signature_ahead", { target_case: id }),
      cloudSigningOffered(supabase).catch(() => false),
    ]).then(([{ data, error }, offered]) => (error || !offered ? [] : signatureAheadOf(data))),
    // The mark of the case and whether ONE is at it (0096), for the screen to follow it while it is open. One that
    // could not be read leaves the screen as it was before (read again by the person), never the page.
    supabase.rpc("case_pulse", { target_case: id }).then(({ data, error }) => (error ? null : casePulseOf(data))),
    // Where the data ONE asks the passenger in the chat stands (0280), for the top of the case to say whose it is.
    // One that could not be read says it as before (the client completes it on the link), never the page.
    supabase
      .rpc("case_data_in_chat", { target_case: id })
      .then(({ data, error }) => (error ? null : dataInChatOf(data))),
    // What the firm lets ONE decide alone, for the words of what ONE does next. Unreadable, ONE's default is said.
    supabase
      .rpc("firm_autonomy", { target_org: firm })
      .then(({ data, error }) => (error ? null : firmAutonomyOf(data))),
    // Every publication of the case's lawsuits, as its card shows them, ONE's triage and the awareness owed (0104).
    // One that could not be read leaves the card saying so, never the page.
    loadCasePublications(supabase, firm, id, context.profile.timezone).catch(() => null),
  ]);
  if (
    !deadlines ||
    !acts ||
    !hearings ||
    !people ||
    !zones ||
    !notices ||
    !civilCourt ||
    !advanced ||
    !linksOwed ||
    !stages
  ) {
    return { kind: "error" };
  }

  const partyList: CaseParty[] = ((parties.data ?? []) as PartyRow[]).flatMap((party) => {
    const person = one(party.people);
    if (!person || (party.role !== "claimant" && party.role !== "guardian")) return [];
    return [
      {
        partyId: party.id,
        role: party.role,
        guardianPartyId: party.guardian_id,
        person: {
          person_id: person.id,
          party_id: party.id,
          full_name: person.full_name,
          cpf: text(person.cpf),
          birth_date: text(person.birth_date),
          nationality: text(person.nationality),
          marital_status: text(person.marital_status),
          profession: text(person.profession),
          email: text(person.email),
          phone: text(person.phone),
          postal_code: text(person.postal_code),
          street: text(person.street),
          address_number: text(person.address_number),
          complement: text(person.complement),
          district: text(person.district),
          city: text(person.city),
          uf: text(person.uf),
          registry: REGISTRY_RESULTS.includes(person.cpf_registry_result as RegistryResult)
            ? {
                result: person.cpf_registry_result as RegistryResult,
                checkedAt: String(person.cpf_checked_at ?? ""),
                name: text(person.cpf_registry_name),
                situation: text(person.cpf_registry_situation),
                regular: typeof person.cpf_registry_regular === "boolean" ? person.cpf_registry_regular : null,
                nameMatches: typeof person.cpf_name_matches === "boolean" ? person.cpf_name_matches : null,
              }
            : null,
          updatedVia: person.updated_via === "client" ? "client" : "firm",
          readFields: readFieldsOf(person.read_fields),
        },
      },
    ];
  });

  // A case of an area of the firm (0274): its area, its kind of case and what its script says of it.
  const area = row.area_script_id ? await loadCaseArea(supabase, firm, row) : null;

  // 0177: the essentials of this case's kind of problem; of a case of an area, of its kind of case (0274).
  const required = row.area_script_id
    ? (((documentNeeds.data as { essential?: RequiredDocument[] } | null)?.essential ?? []) as RequiredDocument[])
    : (requiredFor(
        withVersionDocuments(setting.data?.value, setting.documents) as Parameters<typeof requiredFor>[0],
        typeof row.incident === "string" ? row.incident : null,
      ) as RequiredDocument[]);

  return {
    kind: "ready",
    residence: residence.error ? null : residenceViewsOf(residence.data),
    dispensables: documentNeeds.error ? null : dispensablesOf(documentNeeds.data),
    priorComplaint: priorComplaint.error ? null : priorComplaintOf(priorComplaint.data),
    pieceFacts: pieceFacts.error ? null : casePieceFactsOf(pieceFacts.data),
    amounts: amounts.error ? [] : lawsuitAmountsOf(amounts.data),
    judgmentPaths: judgmentPaths.error ? [] : judgmentPathsOf(judgmentPaths.data),
    publicationActions: publicationActions.error ? [] : publicationActionsOf(publicationActions.data),
    hearingBriefs: hearingBriefs.error
      ? []
      : (
          (hearingBriefs.data ?? []) as {
            hearing_id: string;
            body: string;
            made_at: string;
            emailed_at: string | null;
          }[]
        ).map((row) => ({
          hearingId: row.hearing_id,
          body: row.body,
          madeAt: row.made_at,
          emailed: row.emailed_at !== null,
        })),
    freeJustice: freeJustice.error ? null : freeJusticeOf(freeJustice.data),
    sessions: sessions.error ? [] : (sessionsOf(sessions.data) ?? []),
    outcomes: outcomes.error ? null : lawsuitFactsOf(outcomes.data),
    costs: costs.error ? null : caseCostsOf(costs.data),
    fees: fees.error ? null : caseFeesOf(fees.data),
    financeLevel: financeAccess.error ? null : (((financeAccess.data ?? {}) as { level?: string }).level ?? null),
    closedByOne: {
      closed: row.closed_by_one === true,
      acked: row.close_acked_at !== null && row.close_acked_at !== undefined,
    },
    case: {
      id: row.id,
      seq: row.seq,
      isTest: row.is_test === true,
      qualification: readCaseQualification(row.qualification, {
        by: row.qualification_released_by ?? null,
        at: row.qualification_released_at ?? null,
        reason: row.qualification_release_reason ?? null,
      }),
      module: row.module ?? "",
      incident: row.incident,
      airlineIata: row.airline_iata,
      flightDate: row.flight_date,
      cause: (CAUSES as readonly string[]).includes(row.cause) ? row.cause : "undetermined",
      status: row.status,
      origin: (ORIGINS as readonly string[]).includes(row.origin ?? "") ? row.origin : null,
      agency,
      summary: row.summary,
      responsibleId: row.responsible_id,
      closeReason: row.close_reason,
      createdAt: row.created_at,
      area,
    },
    parties: partyList,
    segments: (segments.data ?? []) as CaseSegment[],
    documents: (
      (documents.data ?? []) as {
        id: string;
        kind: string;
        party_id: string | null;
        status: CaseDocument["status"];
        rejected_reason: string | null;
        source: CaseDocument["source"];
        file_id: string;
        created_at: string;
        envelope_id: string | null;
        processing: CaseDocument["processing"];
        processing_error: string | null;
        normalized_file_id: string | null;
        quality: unknown;
        need: string | null;
        files: { name: string; detected_mime: string | null } | { name: string; detected_mime: string | null }[] | null;
        ai_runs: Embedded<{ output: unknown; approvals: Embedded<{ status: string }> }>;
      }[]
    ).map((document) => ({
      id: document.id,
      kind: document.kind,
      partyId: document.party_id,
      status: document.status,
      rejectedReason: document.rejected_reason,
      need: document.need,
      source: document.source,
      fileId: document.file_id,
      name: one(document.files)?.name ?? "",
      createdAt: document.created_at,
      envelopeId: document.envelope_id,
      pdf: one(document.files)?.detected_mime === "application/pdf",
      processing: document.processing,
      processingError: document.processing_error,
      normalizedFileId: document.normalized_file_id,
      quality: readQuality(document.quality),
      check: checkOf(document.ai_runs),
    })),
    proceedings: (
      (proceedings.data ?? []) as unknown as {
        id: string;
        kind: CaseProceeding["kind"];
        court: string | null;
        comarca: string | null;
        unit: string | null;
        system: string | null;
        cnj: string | null;
        forum_basis: string | null;
        forum_reason: string | null;
        forum_city: string | null;
        comarca_checked: boolean | null;
        status: CaseProceeding["status"];
        filed_at: string | null;
        system_by_one: boolean | null;
        system_approved_by: string | null;
        system_approved_at: string | null;
        system_refused_by: string | null;
        system_refused_at: string | null;
        system_refused_reason: string | null;
        created_by_one: boolean | null;
        unit_by_one: boolean | null;
        court_units:
          | { confirmed: boolean; scope: string; prior_complaint: string | null }
          | { confirmed: boolean; scope: string; prior_complaint: string | null }[]
          | null;
        proceeding_parties: { party_id: string }[];
        proceeding_lawyers: { user_id: string }[];
      }[]
    ).map((proceeding) => ({
      id: proceeding.id,
      kind: proceeding.kind,
      court: proceeding.court,
      comarca: proceeding.comarca,
      unit: proceeding.unit,
      unitByOne: proceeding.unit_by_one === true,
      unitTable: ((unitRow) =>
        unitRow
          ? {
              confirmed: unitRow.confirmed === true,
              wholeComarca: unitRow.scope === "comarca",
              priorComplaint: unitRow.prior_complaint === "required",
            }
          : null)(one(proceeding.court_units)),
      system: proceeding.system,
      cnj: proceeding.cnj,
      forumBasis: proceeding.forum_basis,
      forumReason: proceeding.forum_reason,
      forumCity: proceeding.forum_city,
      comarcaChecked: proceeding.comarca_checked === true,
      status: proceeding.status,
      filedAt: proceeding.filed_at,
      systemByOne: proceeding.system_by_one === true,
      systemApproval: proceeding.system_approved_at
        ? { by: proceeding.system_approved_by, at: proceeding.system_approved_at }
        : null,
      systemRefusal:
        proceeding.system_refused_at && proceeding.system_refused_reason
          ? {
              by: proceeding.system_refused_by,
              at: proceeding.system_refused_at,
              reason: proceeding.system_refused_reason,
            }
          : null,
      createdByOne: proceeding.created_by_one === true,
      parties: proceeding.proceeding_parties.map((party) => party.party_id),
      lawyers: proceeding.proceeding_lawyers.map((lawyer) => lawyer.user_id),
    })),
    links: (
      (links.data ?? []) as {
        id: string;
        person_id: string;
        created_at: string;
        expires_at: string;
        revoked_at: string | null;
        opened_count: number;
        last_opened_at: string | null;
        upload_count: number;
        finished_at: string | null;
      }[]
    ).map((link) => ({
      id: link.id,
      personId: link.person_id,
      createdAt: link.created_at,
      expiresAt: link.expires_at,
      revokedAt: link.revoked_at,
      visits: link.opened_count,
      lastOpenedAt: link.last_opened_at,
      uploads: link.upload_count,
      finishedAt: link.finished_at,
    })),
    linksOwed,
    stageMoments: stages,
    courtPublications: courtPublicationsOf(published),
    publications: published.map((row) => {
      // What ONE did of it and the awareness it owes, from the card's own rows (0104).
      const card = publicationRows?.rows.find((found) => found.id === row.id);
      return {
        id: row.id,
        category: row.category,
        availableOn: row.available_on,
        judgment: row.judgment,
        readings: row.readings,
        ackOwed: card?.ackOwed ?? false,
        triageState: card?.triageState ?? null,
        lawyers: card?.lawyers ?? [],
      };
    }),
    publicationRows,
    events: (
      (events.data ?? []) as {
        id: string;
        at: string;
        kind: string;
        actor_type: string;
        actor_id: string | null;
        data: Record<string, unknown> | null;
      }[]
    ).map((event) => ({
      id: event.id,
      at: event.at,
      kind: event.kind,
      actorType: event.actor_type,
      actorName: event.actor_id ? (names.get(event.actor_id) ?? null) : null,
      data: event.data ?? {},
    })),
    team: teamRows.flatMap((member): TeamMember[] =>
      isFirmFunction(member.firm_function)
        ? [{ userId: member.user_id, name: names.get(member.user_id) ?? "", firmFunction: member.firm_function }]
        : [],
    ),
    airlines: (airlines.data ?? []) as AirlineOption[],
    courts: (courts.data ?? []) as CourtOption[],
    envelopes: (
      (envelopes.data ?? []) as {
        id: string;
        document_id: string;
        method: CaseEnvelope["method"];
        status: string;
        signers: {
          position: number;
          person_id: string;
          name: string;
          sign_url: string | null;
          signed_at: string | null;
        }[];
        enotariado_url: string | null;
        signed_document_id: string | null;
        last_error: string | null;
        ended_reason: string | null;
        created_at: string;
      }[]
    ).map((envelope) => ({
      id: envelope.id,
      documentId: envelope.document_id,
      method: envelope.method,
      status: envelope.status,
      signers: (envelope.signers ?? []).map((signer) => ({
        position: signer.position,
        personId: signer.person_id,
        name: signer.name,
        signUrl: signer.sign_url ?? null,
        signedAt: signer.signed_at ?? null,
      })),
      enotariadoUrl: envelope.enotariado_url,
      signedDocumentId: envelope.signed_document_id,
      lastError: envelope.last_error,
      endedReason: envelope.ended_reason,
      createdAt: envelope.created_at,
    })),
    // The title and version were kept with the acceptance: a newer version of the text does not hide it.
    consents: (
      (consents.data ?? []) as { person_id: string; accepted_at: string; term_title: string; term_version: number }[]
    ).map((consent) => ({
      personId: consent.person_id,
      title: consent.term_title,
      version: consent.term_version,
      acceptedAt: consent.accepted_at,
    })),
    signatureAccount: signatureAccountOf(signatureAccount.data),
    courtSystems: (
      (systems.data ?? []) as {
        court: string;
        proceeding_kind: CourtSystem["kind"];
        system: string;
        confirmed: boolean;
        notes: string | null;
        file_types: Record<string, unknown> | null;
        source: string;
        host: string | null;
      }[]
    ).map((row) => ({
      court: row.court,
      kind: row.proceeding_kind,
      system: row.system,
      confirmed: row.confirmed,
      notes: row.notes,
      source: row.source,
      host: row.host,
      fileTypes: Object.fromEntries(
        Object.entries(row.file_types ?? {}).flatMap(([kind, name]) =>
          typeof name === "string" ? [[kind, name]] : [],
        ),
      ),
    })),
    required,
    rules: {
      ceiling: smallClaimsCeiling(facts.wages, facts.ceilingTimes, todayInBrazil()),
      claims: Object.fromEntries(
        facts.parties.filter((party) => party.role === "claimant").map((party) => [party.partyId, party.claimCents]),
      ),
      claimDefault: facts.claimDefault,
      domicile: caseDomicile(facts.parties, todayInBrazil()),
      tripPlaces: tripPlaces(facts.segments, facts.airports),
      statedCause: facts.statedCause,
      decision: facts.decision,
      decisionAuto: facts.decisionAuto,
      savedTriage: facts.triage,
      weather: assessWeather({
        read: facts.weatherRead,
        segments: facts.segments,
        airports: facts.airports,
        reports: facts.reports,
        hoursBefore: facts.weather.hoursBefore,
        hoursAfter: facts.weather.hoursAfter,
      }),
      weatherConfigured: weatherProvider() !== null,
      causes: facts.causes,
      registrations: facts.registrations,
      year: Number(todayInBrazil().slice(0, 4)),
      family: facts.family,
      courtNotes: facts.courtNotes,
    },
    civilCourt,
    unnamedSigners,
    signatureAhead,
    statements: told.statements,
    account: told.account,
    accountMaxRounds: told.accountMaxRounds,
    interview: told.interview,
    audios: told.audios,
    complaints: told.complaints,
    complaintAnswerDays: told.complaintAnswerDays,
    filings,
    pieces,
    flights,
    course,
    deadlines,
    deadlineActs: acts,
    hearings,
    colleagues: people,
    courtZones: zones,
    notices,
    advance: advanced.advance
      ? {
          waiting: advanced.advance.waiting,
          checkedLabel: advanced.advance.checkedAt
            ? momentLabel(advanced.advance.checkedAt, context.profile.timezone)
            : null,
        }
      : null,
    pulse,
    dataInChat,
    autonomy: Object.fromEntries((autonomy ?? []).map((decision) => [decision.key, decision.mode])) as Partial<
      Record<AutonomyDecision, AutonomyMode>
    >,
    readAt: new Date().toISOString(),
    managesFirm: isManager(context.firm.role),
    worksDeadlines: ["socio", "advogado", "controladoria"].includes(context.firm.firmFunction),
    confirmsDeadlines: context.firm.firmFunction === "socio" || context.firm.firmFunction === "controladoria",
    lawyer: context.firm.firmFunction === "socio" || context.firm.firmFunction === "advogado",
    decidesCourtSystem: ["socio", "advogado", "controladoria"].includes(context.firm.firmFunction),
    partner: context.firm.firmFunction === "socio",
    today: todayInBrazil(),
    cpfLookup: cpfLookup() !== null,
    supportVisit: cookieStore.has(IMPERSONATION_MARKER_COOKIE),
    statementApprovals,
    secondFactor,
    firmFunction: context.firm.firmFunction,
  };
}

/**
 * What a case of an area of the firm reads of its area (0274): the area's name, the kind of case and the stages by
 * the version of the script it was opened under, and its work outside the lawsuit. A read that fails leaves what it
 * could not read empty, never the case unread.
 */
async function loadCaseArea(
  supabase: SupabaseClient,
  firm: string,
  row: { id: string; area_id: string | null; case_type: string | null; area_script_id: string | null },
): Promise<CaseArea> {
  const [area, script, tasks] = await Promise.all([
    supabase
      .from("firm_areas")
      .select("name")
      .eq("id", row.area_id ?? "")
      .eq("org_id", firm)
      .maybeSingle(),
    supabase
      .from("firm_area_scripts")
      .select("version, script")
      .eq("id", row.area_script_id ?? "")
      .maybeSingle(),
    supabase
      .from("case_tasks")
      .select("id, name, who, phase, done_at, position, case_id")
      .eq("org_id", firm)
      .eq("case_id", row.id)
      .order("position"),
  ]);
  const read = scriptOf((script.data as { script?: unknown } | null)?.script);
  return {
    name: (area.data as { name?: string } | null)?.name ?? "",
    typeName: read?.tipos.find((type) => type.chave === row.case_type)?.nome ?? row.case_type,
    version: (script.data as { version?: number } | null)?.version ?? null,
    stages: (read?.etapas ?? []).map((stage) => ({ key: stage.chave, name: stage.nome, phase: stage.fase })),
    tasks: (
      (tasks.data ?? []) as { id: string; name: string; who: string; phase: string; done_at: string | null }[]
    ).map((task) => ({
      id: task.id,
      name: task.name,
      who: task.who === "cliente" ? "cliente" : "escritorio",
      phase: task.phase,
      doneAt: task.done_at,
    })),
  };
}
