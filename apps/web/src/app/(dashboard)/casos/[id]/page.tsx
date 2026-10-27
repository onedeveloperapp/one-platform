import type { AirlineOption } from "../cases-types";
import {
  type CaseDocument,
  type CaseEnvelope,
  type CaseParty,
  type CaseProceeding,
  type CaseSegment,
  type CaseState,
  type CourtOption,
  type CourtSystem,
  EVENTS_SHOWN,
  type TeamMember,
} from "./case-types";
import CaseView from "./components/case-view";
import { cookies } from "next/headers";

import { momentLabel } from "@/lib/ai/approvals";
import { caseAdvanceOf } from "@/lib/cases/advance";
import { CAUSES, isCaseStatus, isIncident, linksOwedOf, ORIGINS, type RequiredDocument } from "@/lib/cases/cases";
import { readCheckAnswer } from "@/lib/cases/document-check";
import { readQuality } from "@/lib/cases/document-quality";
import { loadCasePieces } from "@/lib/cases/draft-facts";
import { loadCaseFilings } from "@/lib/cases/filing-facts";
import { cpfLookup } from "@/lib/cases/identity";
import { readFieldsOf } from "@/lib/cases/read-fields";
import { loadCivilCourt, loadRuleFacts } from "@/lib/cases/rule-facts";
import { assessWeather, caseDomicile, smallClaimsCeiling, tripPlaces } from "@/lib/cases/rules";
import { loadStatementFacts } from "@/lib/cases/statement-facts";
import { loadCourseFacts } from "@/lib/courts/course-facts";
import { caseDeadlines, deadlineActs } from "@/lib/deadlines/facts";
import { isFirmFunction, isManager } from "@/lib/firm/roles";
import { loadFlightChecks } from "@/lib/flights/facts";
import { weatherProvider } from "@/lib/flights/weather";
import { caseHearings, colleagues, courtZones } from "@/lib/hearings/facts";
import { getMemberContext } from "@/lib/member/context";
import { caseNotices } from "@/lib/notices/facts";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";

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

const one = <T,>(value: T | T[] | null): T | null => (Array.isArray(value) ? (value[0] ?? null) : value);

type Embedded<T> = T | T[] | null;

/** The AI's check of a document, from its run: what it suggested, and whether that waits for a person. */
function checkOf(run: Embedded<{ output: unknown; approvals: Embedded<{ status: string }> }>): CaseDocument["check"] {
  const found = one(run);
  const answer = found ? readCheckAnswer(found.output) : null;
  if (!found || !answer) return null;
  return { answer, waiting: one(found.approvals)?.status === "pending" };
}
const text = (value: unknown): string | null => (typeof value === "string" && value !== "" ? value : null);

/** The day in Brazil's official time. */
const todayInBrazil = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());

/**
 * /casos/[id]: one case and everything in it, read under the person's own
 * session (a case of another firm is not found). Every change is a function
 * of the database reached through lib/cases/actions.ts.
 */
async function loadCase(id: string): Promise<CaseState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };
  if (!UUID.test(id)) return { kind: "not-found" };
  const { supabase } = context;
  const firm = context.firm.id;

  const { data: row, error } = await supabase
    .from("cases")
    .select(
      "id, seq, incident, airline_iata, flight_date, cause, status, origin, summary, responsible_id, close_reason, created_at",
    )
    .eq("id", id)
    .eq("org_id", firm)
    .maybeSingle();
  if (error) return { kind: "error" };
  if (!row || !isIncident(row.incident) || !isCaseStatus(row.status)) return { kind: "not-found" };

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
    zapsign,
    cookieStore,
    facts,
    told,
    filings,
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
        "id, position, flight_number, origin_iata, destination_iata, scheduled_departure_local, scheduled_arrival_local, actual_departure_local, actual_arrival_local, booking_reference, affected, source",
      )
      .eq("case_id", id)
      .eq("org_id", firm)
      .order("position"),
    supabase
      .from("case_documents")
      .select(
        "id, kind, party_id, status, rejected_reason, source, file_id, created_at, envelope_id, processing, processing_error, normalized_file_id, quality, files!case_documents_file_id_org_id_fkey(name, detected_mime), ai_runs(output, approvals(status))",
      )
      .eq("case_id", id)
      .eq("org_id", firm)
      .neq("status", "uploading")
      .order("created_at"),
    supabase
      .from("proceedings")
      .select(
        "id, kind, court, comarca, unit, system, cnj, forum_basis, forum_reason, forum_city, status, filed_at, proceeding_parties(party_id), proceeding_lawyers(user_id)",
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
    supabase.from("court_systems").select("court, proceeding_kind, system, confirmed, notes, file_types"),
    supabase.from("platform_settings").select("value").eq("key", "cases").maybeSingle(),
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
    // The account itself is shown to who manages the firm only; whether there is one, to anybody of it.
    supabase.rpc("firm_has_signature_account", { target_org: firm }),
    cookies(),
    // What the rules decide on. A read that failed is an error of the page, never a case with no rules.
    loadRuleFacts(supabase, firm, id, Number(todayInBrazil().slice(0, 4))).catch(() => undefined),
    // The accounts and the complaints. A read that failed is an error of the page too.
    loadStatementFacts(supabase, firm, id, context.profile.timezone).catch(() => undefined),
    loadCaseFilings(supabase, firm, id, context.profile.timezone, context.userId).catch(() => undefined),
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
  const [deadlines, acts, hearings, people, zones, notices, civilCourt, advanced, linksOwed] = await Promise.all([
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
  ]);
  if (!deadlines || !acts || !hearings || !people || !zones || !notices || !civilCourt || !advanced || !linksOwed) {
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

  const required = ((setting.data?.value as { required_documents?: RequiredDocument[] } | null)?.required_documents ??
    []) as RequiredDocument[];

  return {
    kind: "ready",
    case: {
      id: row.id,
      seq: row.seq,
      incident: row.incident,
      airlineIata: row.airline_iata,
      flightDate: row.flight_date,
      cause: (CAUSES as readonly string[]).includes(row.cause) ? row.cause : "undetermined",
      status: row.status,
      origin: (ORIGINS as readonly string[]).includes(row.origin ?? "") ? row.origin : null,
      summary: row.summary,
      responsibleId: row.responsible_id,
      closeReason: row.close_reason,
      createdAt: row.created_at,
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
        files: { name: string; detected_mime: string | null } | { name: string; detected_mime: string | null }[] | null;
        ai_runs: Embedded<{ output: unknown; approvals: Embedded<{ status: string }> }>;
      }[]
    ).map((document) => ({
      id: document.id,
      kind: document.kind,
      partyId: document.party_id,
      status: document.status,
      rejectedReason: document.rejected_reason,
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
      (proceedings.data ?? []) as {
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
        status: CaseProceeding["status"];
        filed_at: string | null;
        proceeding_parties: { party_id: string }[];
        proceeding_lawyers: { user_id: string }[];
      }[]
    ).map((proceeding) => ({
      id: proceeding.id,
      kind: proceeding.kind,
      court: proceeding.court,
      comarca: proceeding.comarca,
      unit: proceeding.unit,
      system: proceeding.system,
      cnj: proceeding.cnj,
      forumBasis: proceeding.forum_basis,
      forumReason: proceeding.forum_reason,
      forumCity: proceeding.forum_city,
      status: proceeding.status,
      filedAt: proceeding.filed_at,
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
    zapsign: zapsign.data === true,
    courtSystems: (
      (systems.data ?? []) as {
        court: string;
        proceeding_kind: CourtSystem["kind"];
        system: string;
        confirmed: boolean;
        notes: string | null;
        file_types: Record<string, unknown> | null;
      }[]
    ).map((row) => ({
      court: row.court,
      kind: row.proceeding_kind,
      system: row.system,
      confirmed: row.confirmed,
      notes: row.notes,
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
    statements: told.statements,
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
    managesFirm: isManager(context.firm.role),
    worksDeadlines: ["socio", "advogado", "controladoria"].includes(context.firm.firmFunction),
    confirmsDeadlines: context.firm.firmFunction === "socio" || context.firm.firmFunction === "controladoria",
    lawyer: context.firm.firmFunction === "socio" || context.firm.firmFunction === "advogado",
    partner: context.firm.firmFunction === "socio",
    today: todayInBrazil(),
    cpfLookup: cpfLookup() !== null,
    supportVisit: cookieStore.has(IMPERSONATION_MARKER_COOKIE),
  };
}

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  // Keyed by the case: what the view keeps of the last read (so that a refresh that fails does not take the
  // screen away) is never another case's.
  return <CaseView key={id} state={await loadCase(id)} />;
}
