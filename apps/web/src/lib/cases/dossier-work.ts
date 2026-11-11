import "server-only";

import { caseLabel, DOCUMENT_KIND_KEY } from "@/lib/cases/cases";
import {
  DOSSIER_ZONE_NAME,
  dossierDay,
  type DossierFacts,
  dossierMoment,
  type DossierRecord,
  dossierSignature,
  type EnvelopeFacts,
  maskCpf,
  type RegistryResult,
} from "@/lib/cases/dossier";
import { evidenceTimeline, readEvidenceKit } from "@/lib/cases/evidence-moments";
import { CHANNEL_KEY, isComplaintChannel, isComplaintOutcome, OUTCOME_KEY } from "@/lib/cases/statements";
import { caseKindLabelKey } from "@/lib/modules/registry";
import { loadFlightChecks, type SourceView } from "@/modules/direito-do-passageiro/flights/facts";
import catalog from "@flyee/content/messages/pt-BR.json";
import { formatCnj } from "@flyee/rules";
import { formatDayBr } from "@flyee/rules/person";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What a dossier of a case is written from (migration 0029), read under the
 * session of the person who asked for it: row-level security shows the case
 * of their firm only, and a case of another firm reads as nothing. The facts
 * come out already in words (a day as people write it, a kind by the name
 * the screens give it), so the pure rule that writes the document
 * (`buildDossier`) decides only what it says and in which order.
 *
 * A dossier travels, so its hours are not the reader's: every moment is
 * written in one zone, named in the document, whoever asked for it.
 *
 * A read that fails throws: a dossier is never written from half of a case.
 */

const product = catalog.product as Record<string, string>;
const word = (key: string | undefined, fallback: string): string => (key ? (product[key] ?? fallback) : fallback);

type Embedded<T> = T | T[] | null;
const one = <T>(value: Embedded<T>): T | null => (Array.isArray(value) ? (value[0] ?? null) : value);

const METHOD_KEY: Record<string, string> = {
  zapsign: "case-signature-method-zapsign",
  govbr: "case-signature-method-govbr",
  enotariado: "case-signature-method-enotariado",
};

/** How an account reached the case, in the words of the document. */
const SOURCE_WORDS: Record<string, string> = {
  client: "contado pela própria pessoa, pelo link do escritório",
  whatsapp: "contado pela própria pessoa, em áudio pelo WhatsApp",
  firm: "registrado pelo escritório",
};

/** Where the chronology of an account stands, when the client did not confirm it. */
const CHRONOLOGY_WORDS: Record<string, string> = {
  none: "sem cronologia ainda",
  proposed: "cronologia em revisão pelo escritório",
  approved: "cronologia enviada para a pessoa confirmar",
  contested: "a pessoa disse que a cronologia está errada",
  dismissed: "cronologia recusada pelo escritório",
};

type PersonRow = {
  id: string;
  full_name: string;
  cpf: string | null;
  cpf_registry_result: string | null;
  cpf_registry_regular: boolean | null;
  cpf_checked_at: string | null;
  cpf_name_matches: boolean | null;
  updated_via: string;
};

const REGISTRY_RESULTS: readonly RegistryResult[] = ["found", "not_found", "birth_date_mismatch", "minor"];
const isRegistryResult = (value: unknown): value is RegistryResult =>
  (REGISTRY_RESULTS as readonly unknown[]).includes(value);

export async function loadDossierFacts(
  supabase: SupabaseClient,
  firm: { id: string; name: string },
  caseId: string,
): Promise<DossierFacts | null> {
  const { data: row, error } = await supabase
    .from("cases")
    .select("id, seq, incident, airline_iata, flight_date")
    .eq("id", caseId)
    .eq("org_id", firm.id)
    .maybeSingle();
  if (error) throw new Error("the case could not be read");
  if (!row) return null;

  const [parties, segments, links, consents, envelopes, statements, complaints, documents, proceedings, airline] =
    await Promise.all([
      supabase
        .from("case_parties")
        .select(
          "id, person_id, role, guardian_id, created_at, people(id, full_name, cpf, cpf_registry_result, cpf_registry_regular, cpf_checked_at, cpf_name_matches, updated_via)",
        )
        .eq("org_id", firm.id)
        .eq("case_id", caseId)
        .order("created_at"),
      supabase
        .from("flight_segments")
        .select(
          "id, position, flight_number, origin_iata, destination_iata, scheduled_departure_local, scheduled_arrival_local, actual_arrival_local, affected",
        )
        .eq("org_id", firm.id)
        .eq("case_id", caseId)
        .order("position"),
      supabase
        .from("client_links")
        .select("person_id, created_at, opened_count, finished_at")
        .eq("org_id", firm.id)
        .eq("case_id", caseId)
        .order("created_at"),
      supabase
        .from("client_consents")
        .select("person_id, term_title, term_version, accepted_at, revoked_at")
        .eq("org_id", firm.id)
        .eq("case_id", caseId)
        .order("accepted_at"),
      supabase
        .from("signature_envelopes")
        .select("document_id, method, status, signers, evidence, signed_sha256, updated_at, created_at")
        .eq("org_id", firm.id)
        .eq("case_id", caseId)
        .order("created_at"),
      supabase
        .from("case_statements")
        .select("party_id, source, status, chronology_status, client_answered_at, created_at")
        .eq("org_id", firm.id)
        .eq("case_id", caseId)
        .order("created_at"),
      supabase
        .from("admin_complaints")
        .select("channel, protocol, filed_on, outcome, created_at")
        .eq("org_id", firm.id)
        .eq("case_id", caseId)
        .order("created_at"),
      supabase
        .from("case_documents")
        // A document names two files (its own and the PDF made of a photo): the embed says which.
        .select("id, kind, party_id, status, decided_at, created_at, files!case_documents_file_id_org_id_fkey(sha256)")
        .eq("org_id", firm.id)
        .eq("case_id", caseId)
        .order("created_at"),
      supabase
        .from("proceedings")
        .select("kind, court, comarca, unit, cnj, status, filed_at, created_at")
        .eq("org_id", firm.id)
        .eq("case_id", caseId)
        .order("created_at"),
      row.airline_iata
        ? supabase.from("airlines").select("name").eq("iata", row.airline_iata).maybeSingle()
        : { data: null, error: null },
    ]);
  if (
    parties.error ||
    segments.error ||
    links.error ||
    consents.error ||
    envelopes.error ||
    statements.error ||
    complaints.error ||
    documents.error ||
    proceedings.error ||
    airline.error
  ) {
    throw new Error("the case could not be read whole");
  }

  type LegRow = {
    id: string;
    flight_number: string | null;
    origin_iata: string | null;
    destination_iata: string | null;
    scheduled_departure_local: string | null;
    scheduled_arrival_local: string | null;
    actual_arrival_local: string | null;
    affected: boolean;
  };
  const legs = (segments.data ?? []) as LegRow[];
  // What the official record says of each leg: read under the same session, and a failed read fails the dossier.
  const checks = await loadFlightChecks(supabase, firm.id, caseId, legs, null);
  // The evidence kit (0209): read under the same session, and a failed read fails the dossier.
  const kitRead = await supabase.rpc("case_evidence_moments", { target_org: firm.id, target_case: caseId });
  if (kitRead.error) throw new Error("the evidence kit could not be read");
  const kit = readEvidenceKit(kitRead.data);
  const wallWords = (time: { wall: string; basis: string } | null | undefined): string | null => {
    const at = time ? hour(time.wall) : null;
    if (!at) return null;
    return time?.basis === "brasilia" ? `${at} (horário de Brasília)` : `${at} (hora local do aeroporto)`;
  };
  const officialOf = (view: SourceView | null): DossierRecord | null => {
    if (!view) return null;
    if (view.status === "not_found" || view.status === "not_published")
      return { status: view.status, month: view.month };
    if (view.status !== "found" || !view.comparison || !view.month) return null;
    return {
      status: "found",
      month: view.month,
      cancelled: view.comparison.agreement === "cancelled",
      scheduledArrival: wallWords(view.times?.scheduledArrival),
      actualArrival: wallWords(view.times?.actualArrival),
      delayMinutes: view.comparison.arrivalDelayMinutes,
      unscheduled: view.unscheduled.map((leg) => ({
        kind: leg.kind,
        origin: leg.origin,
        destination: leg.destination,
        departure: wallWords(leg.departure),
        arrival: wallWords(leg.arrival),
      })),
      reachedDestination: wallWords(view.reachedDestination),
      reachedDelayMinutes: view.comparison.reachedDestinationDelayMinutes,
      stops: view.stops,
      cancelledLegs: view.cancelledLegs.map((leg) => `${leg.origin} para ${leg.destination}`),
      endsAt: view.endsAt,
      justification: view.justification,
    };
  };

  type PartyRow = {
    id: string;
    person_id: string;
    role: string;
    guardian_id: string | null;
    people: Embedded<PersonRow>;
  };
  const partyRows = (parties.data ?? []) as unknown as PartyRow[];
  const personOf = new Map(
    partyRows.flatMap((party) => (one(party.people) ? [[party.id, one(party.people) as PersonRow]] : [])),
  );
  const nameOfPerson = new Map(
    partyRows.flatMap((party) =>
      one(party.people) ? [[party.person_id, (one(party.people) as PersonRow).full_name]] : [],
    ),
  );
  // A day the database keeps as a day (the flight, a filing) is written as it is; a moment is written in
  // the dossier's zone, and so is the day of a moment.
  const day = (value: string | null | undefined): string | null =>
    value ? (formatDayBr(String(value).slice(0, 10)) ?? null) : null;
  const moment = dossierMoment;
  const hour = (value: string | null | undefined): string | null => {
    const match = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/.exec(String(value ?? ""));
    return match ? `${formatDayBr(match[1]) ?? match[1]} às ${match[2]}` : null;
  };
  const documentKind = new Map(
    ((documents.data ?? []) as { id: string; kind: string }[]).map((document) => [document.id, document.kind]),
  );
  const kindWord = (kind: string | undefined): string =>
    word(DOCUMENT_KIND_KEY[kind as keyof typeof DOCUMENT_KIND_KEY], "Documento");

  return {
    moments: kit ? { lines: evidenceTimeline(kit, (kind) => kindWord(kind)), proofs: kit.proofs.length } : undefined,
    firm: firm.name,
    caseLabel: caseLabel(row.seq),
    issuedOn: moment(new Date().toISOString()) ?? "",
    zone: DOSSIER_ZONE_NAME,
    incident: word(caseKindLabelKey(row.incident) ?? undefined, String(row.incident ?? "")),
    airline: (airline.data as { name?: string } | null)?.name ?? null,
    flightDate: day(row.flight_date),
    segments: legs.map((segment) => ({
      flight: segment.flight_number,
      route: `de ${segment.origin_iata ?? "origem não registrada"} para ${segment.destination_iata ?? "destino não registrado"}`,
      scheduled: hour(segment.scheduled_arrival_local),
      actual: hour(segment.actual_arrival_local),
      affected: Boolean(segment.affected),
      official: officialOf(checks.bySegment[segment.id]?.vra ?? null),
    })),
    people: partyRows.flatMap((party) => {
      const person = one(party.people);
      if (!person || (party.role !== "claimant" && party.role !== "guardian")) return [];
      const guardian = party.guardian_id ? personOf.get(party.guardian_id) : null;
      return [
        {
          name: person.full_name,
          cpfMasked: maskCpf(person.cpf),
          role: party.role,
          guardianName: guardian?.full_name ?? null,
          registry:
            person.cpf_checked_at && isRegistryResult(person.cpf_registry_result)
              ? {
                  result: person.cpf_registry_result,
                  nameMatches: person.cpf_name_matches,
                  regular: person.cpf_registry_regular,
                  checkedOn: dossierDay(person.cpf_checked_at) ?? "",
                }
              : null,
          lastChangeByClient: person.updated_via === "client",
        },
      ];
    }),
    links: (
      (links.data ?? []) as {
        person_id: string;
        created_at: string;
        opened_count: number;
        finished_at: string | null;
      }[]
    ).map((link) => ({
      person: nameOfPerson.get(link.person_id) ?? "Pessoa do caso",
      createdOn: moment(link.created_at) ?? "",
      opened: Number(link.opened_count) || 0,
      finishedOn: moment(link.finished_at),
    })),
    consents: (
      (consents.data ?? []) as {
        person_id: string;
        term_title: string;
        term_version: number;
        accepted_at: string;
        revoked_at: string | null;
      }[]
    )
      .filter((consent) => consent.revoked_at === null)
      .map((consent) => ({
        person: nameOfPerson.get(consent.person_id) ?? "Pessoa do caso",
        title: consent.term_title,
        version: Number(consent.term_version) || 1,
        acceptedOn: moment(consent.accepted_at) ?? "",
      })),
    signatures: ((envelopes.data ?? []) as EnvelopeFacts[]).flatMap((envelope) => {
      const told = dossierSignature(envelope, {
        document: kindWord(documentKind.get(envelope.document_id)),
        method: word(METHOD_KEY[envelope.method], envelope.method),
      });
      return told ? [told] : [];
    }),
    statements: (
      (statements.data ?? []) as {
        party_id: string | null;
        source: string;
        status: string;
        chronology_status: string;
        client_answered_at: string | null;
      }[]
    )
      .filter((statement) => statement.status === "received")
      .map((statement) => ({
        person: statement.party_id ? (personOf.get(statement.party_id)?.full_name ?? null) : null,
        source: SOURCE_WORDS[statement.source] ?? SOURCE_WORDS.firm,
        confirmedOn: statement.chronology_status === "confirmed" ? moment(statement.client_answered_at) : null,
        status: CHRONOLOGY_WORDS[statement.chronology_status] ?? CHRONOLOGY_WORDS.none,
      })),
    complaints: (
      (complaints.data ?? []) as {
        channel: string;
        protocol: string | null;
        filed_on: string | null;
        outcome: string;
      }[]
    ).map((complaint) => ({
      channel: isComplaintChannel(complaint.channel)
        ? word(CHANNEL_KEY[complaint.channel], complaint.channel)
        : complaint.channel,
      protocol: complaint.protocol,
      filedOn: day(complaint.filed_on),
      outcome: isComplaintOutcome(complaint.outcome)
        ? word(OUTCOME_KEY[complaint.outcome], complaint.outcome)
        : complaint.outcome,
    })),
    documents: (
      (documents.data ?? []) as unknown as {
        kind: string;
        party_id: string | null;
        status: string;
        decided_at: string | null;
        files: Embedded<{ sha256: string | null }>;
      }[]
    )
      .filter((document) => document.status === "accepted")
      .map((document) => ({
        kind: kindWord(document.kind),
        person: document.party_id ? (personOf.get(document.party_id)?.full_name ?? null) : null,
        acceptedOn: dossierDay(document.decided_at),
        // The start of the file's hash: enough to tell this very file from any other.
        fingerprint: one(document.files)?.sha256?.slice(0, 16) ?? null,
      })),
    proceedings: (
      (proceedings.data ?? []) as {
        kind: string;
        court: string | null;
        comarca: string | null;
        unit: string | null;
        cnj: string | null;
        filed_at: string | null;
      }[]
    ).map((proceeding) => ({
      kind: word(`case-proceeding-kind-${proceeding.kind}`, proceeding.kind),
      forum: [proceeding.unit, proceeding.comarca, proceeding.court].filter(Boolean).join(", ") || null,
      number: proceeding.cnj ? (formatCnj(proceeding.cnj) ?? proceeding.cnj) : null,
      filedOn: day(proceeding.filed_at),
    })),
  };
}
