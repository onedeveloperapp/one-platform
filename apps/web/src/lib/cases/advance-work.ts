import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { type AccountState, accountStateOf } from "@/lib/cases/account";
import { lawsuitsWaiting } from "@/lib/cases/advance";
import { caseMissing, firstNameOf, type MissingParty, type PersonData, type RequiredDocument } from "@/lib/cases/cases";
import { draftBlocks } from "@/lib/cases/drafts";
import { queueDraftWork } from "@/lib/cases/drafts-work";
import { queueFilingPackage } from "@/lib/cases/filing-work";
import { lawsuitPlan, type MinimumWage, type RuleParty } from "@/lib/cases/rules";
import { supabaseFileStore } from "@/lib/files/store";
import { soon } from "@/lib/jobs/soon";
import { WHATSAPP_COPY } from "@/lib/messages/whatsapp-copy";
import { openReservedEnvelopes } from "@/lib/signatures/work";
import { deliverOutbox } from "@/lib/whatsapp/send";
import { createServiceClient } from "@flyee/auth/service";
import { BRAND } from "@flyee/content";
import { takeBackFile } from "@flyee/documents/files";
import { measureFile } from "@flyee/documents/measure";
import { renderTextPdf } from "@flyee/documents/text-pdf";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The backend's half of ONE carrying a case on (migration 0039): a case is
 * claimed under a number, and what is due is done through the database's own
 * functions, which make every check a person's request makes. Creating the
 * lawsuits needs the rules of the app (what the case lacks, the plan of the
 * lawsuits), so the case is read here with the same rules the case screen
 * shows; the piece and the package are the database's. Before them, ONE
 * sends the client's link to who is owed one (0046): the token is minted
 * here and only its SHA-256 goes to the database; once the client finished,
 * the papers they sign (0054) and its word that what they sent arrived and
 * what comes next (0055). What ONE then waits for is
 * recorded for the screen. Nothing of a client is kept in a job's state: the
 * steps carry case ids and outcomes only.
 */

/** A case a worker holds, and whether sending a link, creating its lawsuits or asking for a package is what to look at. */
export type HeldAdvance = {
  caseId: string;
  claim: number;
  linkDue: boolean;
  lawsuitsDue: boolean;
  packageDue: boolean;
  /** A paper the client signs is owed (0054): the power of attorney, the contract. */
  papersDue: boolean;
  /** A client who finished on their link is owed ONE's word that it arrived and what comes next (0055). */
  receivedDue: boolean;
};

export type AdvanceOutcome = "created" | "acted" | "waiting" | "idle" | "lost" | "failed";

/** What follows a piece, a package or a message ONE asked for (`followSoon`: each done right after, on its own). */
export type AdvanceFollow = {
  draft: (draftId: string) => Promise<void>;
  package: (packageId: string) => Promise<void>;
  /** A message ONE wrote to the outbox (a client's link): sent at once, or by the outbox's sweep. */
  message: (messageId: string) => Promise<void>;
};

/** Today on the platform's calendar (Brasília): the day a minor is a minor on and the minimum wage is read for. */
function today(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date());
}

/** The cases claimed, and how many the claim set aside on the way (more may be due behind them). */
export async function claimCaseAdvances(
  service: SupabaseClient,
  limit: number,
  target: string | null = null,
): Promise<{ held: HeldAdvance[]; parked: number }> {
  const { data, error } = await service.rpc("claim_case_advances", {
    target_limit: limit,
    target_case: target,
  });
  if (error) throw new Error("case advances could not be claimed");
  const answer = (data ?? {}) as { claimed?: unknown; parked?: unknown };
  const claimed = Array.isArray(answer.claimed) ? answer.claimed : [];
  return {
    held: (
      claimed as {
        case_id: string;
        claim: number;
        link_due?: boolean;
        lawsuits_due: boolean;
        package_due: boolean;
        papers_due?: boolean;
        received_due?: boolean;
      }[]
    ).map((row) => ({
      caseId: row.case_id,
      claim: Number(row.claim),
      linkDue: row.link_due === true,
      lawsuitsDue: row.lawsuits_due === true,
      packageDue: row.package_due === true,
      papersDue: row.papers_due === true,
      receivedDue: row.received_due === true,
    })),
    parked: Number(answer.parked ?? 0) || 0,
  };
}

type LawsuitFacts = {
  parties: (MissingParty & { claimCents: number | null })[];
  documents: { kind: string; party_id: string | null; status: string }[];
  segments: number;
  required: RequiredDocument[];
  wages: MinimumWage[];
  ceilingTimes: number | null;
  familyChoice: "together" | "split";
  courts: { acronym: string; uf: string }[];
  systems: { court: string; proceeding_kind: string; system: string; confirmed: boolean }[];
  /** A case an agency handed over (0071) whose client has not said on their link that they finished. */
  unconfirmedHandoff: boolean;
  /** Where the client's account of what happened stands (0090): the lawsuits wait for it. */
  account: AccountState | null;
};

/** What creating a case's lawsuits reads of it. Throws when a read failed; null for a case that is gone. */
async function loadLawsuitFacts(service: SupabaseClient, caseId: string): Promise<LawsuitFacts | null> {
  const { data: row, error } = await service
    .from("cases")
    .select("id, family_choice, partnership_id")
    .eq("id", caseId)
    .maybeSingle();
  if (error) throw new Error("case unreadable");
  if (!row) return null;
  // A case an agency handed over waits for its client to confirm the agency's data, by saying they finished.
  let unconfirmedHandoff = false;
  if (row.partnership_id) {
    const finished = await service
      .from("client_links")
      .select("id", { count: "exact", head: true })
      .eq("case_id", caseId)
      .not("finished_at", "is", null);
    if (finished.error) throw new Error("client links unreadable");
    unconfirmedHandoff = (finished.count ?? 0) === 0;
  }
  // The client's account, as the database reads it (0090): the piece asked right after the lawsuits is written from it.
  const told = await service.rpc("case_account_state", { target_case: caseId });
  if (told.error) throw new Error("account unreadable");
  const [parties, documents, segments, settings, wages, courts, systems] = await Promise.all([
    service
      .from("case_parties")
      .select("id, person_id, role, guardian_id, claim_cents, created_at::text")
      .eq("case_id", caseId),
    // As the case screen reads them: a photo a client is still sending is not a document yet.
    service
      .from("case_documents")
      .select("kind, party_id, status")
      .eq("case_id", caseId)
      .in("status", ["received", "accepted", "rejected"]),
    service.from("flight_segments").select("id", { count: "exact", head: true }).eq("case_id", caseId),
    service.from("platform_settings").select("key, value").in("key", ["cases", "small_claims"]),
    service.from("minimum_wages").select("valid_from::text, cents, act"),
    service.from("courts").select("acronym, uf"),
    service.from("court_systems").select("court, proceeding_kind, system, confirmed"),
  ]);
  if (parties.error || documents.error || segments.error || settings.error || wages.error || courts.error) {
    throw new Error("case facts unreadable");
  }
  if (systems.error) throw new Error("court systems unreadable");
  const partyRows = (
    (parties.data ?? []) as {
      id: string;
      person_id: string;
      role: string;
      guardian_id: string | null;
      claim_cents: number | null;
      created_at: string;
    }[]
  )
    // The order they joined the case: "the first adult" is always the same one.
    .sort((a, b) => (a.created_at === b.created_at ? (a.id < b.id ? -1 : 1) : a.created_at < b.created_at ? -1 : 1));
  const people =
    partyRows.length === 0
      ? { data: [], error: null }
      : await service
          .from("people")
          // Dates are read as text (the day as the calendar writes it), as PostgREST answers them anyway.
          .select(
            "id, full_name, cpf, birth_date::text, nationality, marital_status, profession, email, phone, postal_code, street, address_number, complement, district, city, uf",
          )
          .in(
            "id",
            partyRows.map((party) => party.person_id),
          );
  if (people.error) throw new Error("people unreadable");
  const personOf = new Map(
    ((people.data ?? []) as (Omit<PersonData, "person_id" | "party_id"> & { id: string })[]).map((person) => [
      person.id,
      person,
    ]),
  );
  const setting = (key: string) =>
    ((settings.data ?? []) as { key: string; value: Record<string, unknown> | null }[]).find((item) => item.key === key)
      ?.value ?? {};
  const times = setting("small_claims").ceiling_minimum_wages;
  return {
    parties: partyRows.flatMap((party) => {
      const person = personOf.get(party.person_id);
      if (!person || (party.role !== "claimant" && party.role !== "guardian")) return [];
      const { id, ...fields } = person;
      return [
        {
          partyId: party.id,
          role: party.role,
          guardianPartyId: party.guardian_id,
          person: { ...fields, person_id: id, party_id: party.id },
          claimCents: party.claim_cents === null ? null : Number(party.claim_cents),
        },
      ];
    }),
    documents: (documents.data ?? []) as { kind: string; party_id: string | null; status: string }[],
    segments: segments.count ?? 0,
    required: (setting("cases").required_documents ?? []) as RequiredDocument[],
    wages: ((wages.data ?? []) as { valid_from: string; cents: number; act: string }[]).map((wage) => ({
      validFrom: wage.valid_from,
      cents: Number(wage.cents),
      act: wage.act,
    })),
    ceilingTimes: typeof times === "number" && times > 0 ? times : null,
    familyChoice: row.family_choice === "split" ? "split" : "together",
    courts: (courts.data ?? []) as { acronym: string; uf: string }[],
    systems: (systems.data ?? []) as { court: string; proceeding_kind: string; system: string; confirmed: boolean }[],
    unconfirmedHandoff,
    account: accountStateOf(told.data),
  };
}

/** The facts with only the papers the firm accepted: what a package can carry. */
const acceptedOnly = (facts: LawsuitFacts): LawsuitFacts => ({
  ...facts,
  documents: facts.documents.filter((document) => document.status === "accepted"),
});

/** What the case screen says the case still lacks, read from the facts the worker read. */
const missingOf = (facts: LawsuitFacts, day: string) =>
  caseMissing({
    parties: facts.parties,
    documents: facts.documents,
    segments: facts.segments,
    required: facts.required,
    today: day,
  });

/**
 * Creates the lawsuits of a claimed case when it has what they need, with
 * the same rules the case screen runs. Answers what ONE waits for instead,
 * `created`, or `lost` when the claim is no longer this worker's. A plan the
 * case changed under (`changed`) waits for nothing: the case is looked at
 * again at once.
 */
async function createLawsuits(
  service: SupabaseClient,
  held: HeldAdvance,
  facts: LawsuitFacts,
  day: string,
): Promise<{ waiting: string | null; created: boolean; lost: boolean }> {
  // A claimant with no Valor da Causa Pedido takes the firm's value for the case's kind of problem, written by the
  // database as ONE (0052); with none, the claim goes with no value and the judge defines it (0064).
  const unclaimed = facts.parties.filter(
    (party) => party.role === "claimant" && !(typeof party.claimCents === "number" && party.claimCents > 0),
  );
  if (unclaimed.length > 0) {
    const { data, error } = await service.rpc("advance_claim_defaults", {
      target_case: held.caseId,
      target_claim: held.claim,
    });
    if (error) throw new Error("claim defaults failed");
    const answer = (data ?? {}) as { ok?: boolean; code?: string; applied?: unknown; cents?: unknown };
    if (!answer.ok && answer.code === "not_working") return { waiting: null, created: false, lost: true };
    if (answer.ok && typeof answer.cents === "number" && typeof answer.applied === "number" && answer.applied > 0) {
      for (const party of unclaimed) party.claimCents = answer.cents;
    }
  }
  const waiting = lawsuitsWaiting({
    missing: missingOf(facts, day),
    claims: facts.parties.filter((party) => party.role === "claimant").map((party) => party.claimCents),
    account: facts.account,
    unconfirmedHandoff: facts.unconfirmedHandoff,
  });
  if (waiting) return { waiting, created: false, lost: false };
  const planned = lawsuitPlan({
    parties: facts.parties.map(
      (party): RuleParty => ({
        partyId: party.partyId,
        role: party.role,
        guardianPartyId: party.guardianPartyId,
        birthDate: party.person.birth_date || null,
        city: party.person.city || null,
        uf: party.person.uf || null,
        claimCents: party.claimCents,
      }),
    ),
    wages: facts.wages,
    ceilingTimes: facts.ceilingTimes,
    familyChoice: facts.familyChoice,
    courts: facts.courts,
    systems: facts.systems,
    day,
  });
  if (!planned.ok) return { waiting: planned.code, created: false, lost: false };
  const { data, error } = await service.rpc("advance_create_lawsuits", {
    target_case: held.caseId,
    target_claim: held.claim,
    target_plan: planned.plan,
  });
  if (error) throw new Error("lawsuits could not be created");
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  if (answer.ok) return { waiting: null, created: true, lost: false };
  if (answer.code === "not_working") return { waiting: null, created: false, lost: true };
  // Nothing to do after all (a person created them meanwhile, the firm stopped it, the case changed while it was
  // read): nothing to wait for.
  if (answer.code === "not_due" || answer.code === "not_auto" || answer.code === "changed") {
    return { waiting: null, created: false, lost: false };
  }
  return { waiting: String(answer.code ?? "failed"), created: false, lost: false };
}

/** What issuing a held case's papers came to: what it waits for, an envelope the backend opens, whether it was lost. */
type PapersSent = { lost: boolean; failed: boolean; waiting: string | null; envelopes: number; zapsign: boolean };

/** How many papers one look issues at most: each a PDF and an envelope. */
const PAPERS_PER_LOOK = 6;

/** The name of a paper's file, plain: no accent, no space. */
function paperFileName(kind: string, person: string): string {
  const plain = `${kind === "procuracao" ? "procuracao" : "contrato"}-${person}`
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return `${plain || "documento"}.pdf`;
}

/**
 * Issues the papers a held case owes (0054): for each, the database writes the
 * text with the person's facts (`advance_paper_to_issue`), the worker makes it
 * a PDF of the firm's own (nothing of the platform printed on it) and keeps
 * it under the purpose `paper`, and the database makes it a document of the
 * case and sends it to the person to sign, in one step (`advance_record_paper`).
 * A paper whose facts are not all on record is not issued: the case waits for
 * them (`paper_incomplete`). Throws when the database could not be asked.
 */
async function sendPapers(service: SupabaseClient, held: HeldAdvance): Promise<PapersSent> {
  const sent: PapersSent = { lost: false, failed: false, waiting: null, envelopes: 0, zapsign: false };
  const store = supabaseFileStore(service);
  for (let turn = 0; turn < PAPERS_PER_LOOK; turn += 1) {
    const { data, error } = await service.rpc("advance_paper_to_issue", {
      target_case: held.caseId,
      target_claim: held.claim,
    });
    if (error) throw new Error("papers could not be read");
    const paper = (data ?? {}) as {
      ok?: boolean;
      code?: string;
      org_id?: string;
      person_id?: string;
      kind?: string;
      template_id?: string;
      title?: string;
      person?: string;
      firm?: string;
      body?: string;
    };
    if (!paper.ok) return { ...sent, lost: paper.code === "not_working" };
    if (paper.code === "none") return sent;
    if (paper.code === "incomplete" || paper.code === "unwritable") {
      return { ...sent, waiting: paper.code === "incomplete" ? "paper_incomplete" : "paper_unwritable" };
    }
    if (paper.code !== "due" || !paper.org_id || !paper.person_id || !paper.kind || !paper.template_id || !paper.body) {
      return { ...sent, failed: true };
    }
    let pdf: Uint8Array;
    try {
      pdf = await renderTextPdf({
        blocks: draftBlocks(paper.body),
        title: paper.title ?? undefined,
        author: paper.firm ?? undefined,
        producer: paper.firm ?? undefined,
        pageNumbers: true,
      });
    } catch {
      return { ...sent, failed: true };
    }
    const reserved = await store.reserve({
      orgId: paper.org_id,
      purpose: "paper",
      name: paperFileName(paper.kind, paper.person ?? ""),
      mime: "application/pdf",
      bytes: pdf.byteLength,
    });
    if (!reserved.ok) return { ...sent, failed: true };
    let measure: Awaited<ReturnType<typeof measureFile>>;
    try {
      await store.put(reserved.storagePath, pdf, "application/pdf");
      measure = await measureFile(pdf);
    } catch {
      // Nothing names the file yet: it is taken back, and the paper tried again at the next look.
      await takeBackFile(store, reserved.fileId, reserved.storagePath);
      return { ...sent, failed: true };
    }
    const { data: recorded, error: refused } = await service.rpc("advance_record_paper", {
      target_case: held.caseId,
      target_claim: held.claim,
      target_person: paper.person_id,
      target_kind: paper.kind,
      target_template: paper.template_id,
      payload: { file_id: reserved.fileId, sha256: measure.sha256, bytes: measure.bytes, pages: measure.pages ?? 1 },
    });
    // An answer lost on the way may have kept the file as the paper: it is taken back only when the database said
    // it was not, record first, and the database refuses to forget a file a document names.
    if (refused) throw new Error("paper could not be recorded");
    const result = (recorded ?? {}) as { ok?: boolean; code?: string; method?: string };
    if (!result.ok) {
      await takeBackFile(store, reserved.fileId, reserved.storagePath);
      if (result.code === "not_working") return { ...sent, lost: true };
      if (result.code === "not_due") continue;
      return { ...sent, failed: true };
    }
    sent.envelopes += 1;
    if (result.method === "zapsign") sent.zapsign = true;
  }
  return sent;
}

/** The links ONE sent of a held case: the messages the outbox holds for them, and whether something went wrong. */
type LinksSent = { lost: boolean; failed: boolean; messages: string[] };

/**
 * Sends each adult of a held case the link ONE can send them now (0046): the
 * database names who, with the firm's name; a token is minted for each, and
 * the database makes the link and writes its message (the same words a
 * person's link goes with) under the case's own lock, checking again that
 * the person is owed one and that their 24 hours are open. One the database
 * no longer sends (a person made a link meanwhile, the 24 hours closed) is
 * left as it says. Throws when the database could not be asked at all.
 */
async function sendClientLinks(service: SupabaseClient, held: HeldAdvance): Promise<LinksSent> {
  const sent: LinksSent = { lost: false, failed: false, messages: [] };
  const { data, error } = await service.rpc("advance_client_links", {
    target_case: held.caseId,
    target_claim: held.claim,
  });
  if (error) throw new Error("client links could not be read");
  const answer = (data ?? {}) as { ok?: boolean; code?: string; firm?: unknown; people?: unknown };
  if (!answer.ok) return { ...sent, lost: answer.code === "not_working" };
  const firm = typeof answer.firm === "string" ? answer.firm : "";
  const people = (Array.isArray(answer.people) ? answer.people : []) as { person_id?: unknown; full_name?: unknown }[];
  for (const person of people) {
    if (typeof person.person_id !== "string") continue;
    const token = randomBytes(32).toString("base64url");
    const { data: made, error: refused } = await service.rpc("advance_send_client_link", {
      target_case: held.caseId,
      target_claim: held.claim,
      target_person: person.person_id,
      target_token_hash: createHash("sha256").update(token, "utf8").digest("hex"),
      target_body: WHATSAPP_COPY["pt-BR"].clientLink({
        firstName: firstNameOf(typeof person.full_name === "string" ? person.full_name : null),
        firm,
        url: `${BRAND.siteUrl}/c/${token}`,
      }),
    });
    if (refused) {
      sent.failed = true;
      continue;
    }
    const result = (made ?? {}) as { ok?: boolean; code?: string; message_id?: unknown };
    if (result.ok && typeof result.message_id === "string") sent.messages.push(result.message_id);
    else if (result.code === "not_working") return { ...sent, lost: true };
  }
  return sent;
}

/**
 * Tells each client of a held case who finished on their link, in the
 * conversation ONE holds with them, that what they sent arrived and what
 * comes next (0055): the database names who, with the firm's name and
 * whether a power of attorney waits for their signature, and writes each
 * message as ONE's, recorded as the notice the firm's template would have
 * been, checking again under the lock the notices take turns under. One the
 * database no longer says (the 24 hours closed, a person took the
 * conversation, it was told already) is left as it says. Throws when the
 * database could not be asked at all.
 */
async function sayReceived(service: SupabaseClient, held: HeldAdvance): Promise<LinksSent> {
  const said: LinksSent = { lost: false, failed: false, messages: [] };
  const { data, error } = await service.rpc("advance_received_people", {
    target_case: held.caseId,
    target_claim: held.claim,
  });
  if (error) throw new Error("received words could not be read");
  const answer = (data ?? {}) as { ok?: boolean; code?: string; people?: unknown };
  if (!answer.ok) return { ...said, lost: answer.code === "not_working" };
  const people = (Array.isArray(answer.people) ? answer.people : []) as {
    person_id?: unknown;
    full_name?: unknown;
    paper_waiting?: unknown;
    finished?: unknown;
  }[];
  for (const person of people) {
    if (typeof person.person_id !== "string") continue;
    const { data: told, error: refused } = await service.rpc("advance_say_received", {
      target_case: held.caseId,
      target_claim: held.claim,
      target_person: person.person_id,
      target_body: WHATSAPP_COPY["pt-BR"].caseReceived({
        firstName: firstNameOf(typeof person.full_name === "string" ? person.full_name : null),
        paperWaiting: person.paper_waiting === true,
        // A client who did not say they finished hears that their case has what it needs (0057).
        finished: person.finished !== false,
      }),
    });
    if (refused) {
      said.failed = true;
      continue;
    }
    const result = (told ?? {}) as { ok?: boolean; code?: string; message_id?: unknown };
    if (result.ok && typeof result.message_id === "string") said.messages.push(result.message_id);
    else if (result.code === "not_working") return { ...said, lost: true };
  }
  return said;
}

/**
 * Does what is due for one claimed case and records what ONE waits for:
 * the client's link first (what the client sends is what the rest waits
 * for), its lawsuits when they are what to look at, then the piece and the
 * package of each lawsuit. A failure of the moment is recorded as one (the
 * case is looked at again sooner, each time a little later), and what ONE
 * found it waits for before it is still said.
 */
export async function advanceClaimedCase(
  service: SupabaseClient,
  held: HeldAdvance,
  follow: AdvanceFollow,
): Promise<AdvanceOutcome> {
  let waiting: string | null = null;
  let created = false;
  let failed = false;
  const asked: { drafts: string[]; packages: string[]; messages: string[]; papers: number } = {
    drafts: [],
    packages: [],
    messages: [],
    papers: 0,
  };
  try {
    if (held.linkDue) {
      const links = await sendClientLinks(service, held);
      asked.messages = links.messages;
      if (links.failed) failed = true;
      if (links.lost) {
        await deliverMessages(asked.messages, follow);
        return "lost";
      }
    }
    const day = today();
    // The case is read when its lawsuits or a package are what to look at: both need what the screen says it lacks.
    const facts = held.lawsuitsDue || held.packageDue ? await loadLawsuitFacts(service, held.caseId) : null;
    if ((held.lawsuitsDue || held.packageDue) && !facts) {
      await deliverMessages(asked.messages, follow);
      return "lost";
    }
    if (held.lawsuitsDue && facts) {
      const lawsuits = await createLawsuits(service, held, facts, day);
      if (lawsuits.lost) {
        await deliverMessages(asked.messages, follow);
        return "lost";
      }
      waiting = lawsuits.waiting;
      created = lawsuits.created;
    }
    // The papers the client signs, once they finished or their case moved on (0054, 0057): the lawsuits just
    // created move it on, so they are looked for again right then, never left for a later look. The lawsuits do
    // not wait for the papers (only the filing does).
    let papersWaiting: string | null = null;
    if (held.papersDue || created) {
      const papers = await sendPapers(service, held);
      if (papers.lost) {
        await deliverMessages(asked.messages, follow);
        return "lost";
      }
      if (papers.failed) failed = true;
      papersWaiting = papers.waiting;
      if (papers.envelopes > 0) asked.papers = papers.envelopes;
      // An envelope of the firm's ZapSign account is opened by the backend (0023), right after; the sweep catches
      // what that did not.
      if (papers.zapsign) soon("signature-open", () => openReservedEnvelopes(createServiceClient(), 10));
    }
    // Once the papers went, the client hears that what they sent arrived and what comes next (0055, 0057).
    if (held.receivedDue || created) {
      const told = await sayReceived(service, held);
      asked.messages.push(...told.messages);
      if (told.failed) failed = true;
      if (told.lost) {
        await deliverMessages(asked.messages, follow);
        return "lost";
      }
    }
    const { data, error } = await service.rpc("advance_case_steps", {
      target_case: held.caseId,
      target_claim: held.claim,
      // A package goes only with every paper the case needs accepted (a lawsuit a person created early may lack
      // them, and a paper sent again waits for the firm). Not read for a package: nothing is asked of one now.
      target_complete: facts ? missingOf(acceptedOnly(facts), day).length === 0 : null,
    });
    if (error) throw new Error("case steps failed");
    const steps = (data ?? {}) as {
      ok?: boolean;
      code?: string;
      drafts?: unknown;
      packages?: unknown;
      waiting?: string | null;
      failed?: boolean;
    };
    if (!steps.ok && steps.code === "not_working") {
      await deliverMessages(asked.messages, follow);
      return "lost";
    }
    asked.drafts = Array.isArray(steps.drafts) ? steps.drafts.filter((id): id is string => typeof id === "string") : [];
    asked.packages = Array.isArray(steps.packages)
      ? steps.packages.filter((id): id is string => typeof id === "string")
      : [];
    waiting = waiting ?? (typeof steps.waiting === "string" ? steps.waiting : null) ?? papersWaiting;
    // A step that failed (whatever ONE says first) is a failure of the look: tried again later each time, then
    // said to need a person.
    if (steps.failed === true) failed = true;
  } catch {
    failed = true;
  }
  const { error: unrecorded } = await service.rpc("record_case_advance", {
    target_case: held.caseId,
    target_claim: held.claim,
    target_waiting: waiting,
    target_failed: failed,
  });
  // What ONE asked for is the jobs' now (or, with none, done right here); each is also owed to their sweeps.
  await deliverMessages(asked.messages, follow);
  for (const draftId of asked.drafts) {
    try {
      await follow.draft(draftId);
    } catch {
      // Owed: the sweep of the pieces takes it.
    }
  }
  for (const packageId of asked.packages) {
    try {
      await follow.package(packageId);
    } catch {
      // Owed: the sweep of the packages takes it.
    }
  }
  if (created) return "created";
  // The claim stays held until it is stale when its record did not land: the case is looked at again then.
  if (failed || unrecorded) return "failed";
  if (asked.drafts.length > 0 || asked.packages.length > 0 || asked.messages.length > 0 || asked.papers > 0) {
    return "acted";
  }
  return waiting ? "waiting" : "idle";
}

/** The messages ONE wrote, sent now; one that fails here is the outbox's sweep's. */
async function deliverMessages(messages: string[], follow: AdvanceFollow): Promise<void> {
  for (const messageId of messages) {
    try {
      await follow.message(messageId);
    } catch {
      // Owed: the outbox's sweep sends it.
    }
  }
}

/** A message ONE wrote, claimed and sent by the outbox (0019): once, whatever else claims it. */
async function sendNow(messageId: string): Promise<void> {
  await deliverOutbox(createServiceClient(), { messageId });
}

/**
 * What ONE asked for is worked on right after, each on its own (`lib/jobs/soon.ts`): a first text and what follows
 * it, a package built; a message is sent at once. What does not finish is the sweeps'.
 */
export const followSoon: AdvanceFollow = {
  draft: queueDraftWork,
  package: queueFilingPackage,
  message: sendNow,
};

/** One claim and the case it held: its outcome (none when nothing was due), and how many it set aside. */
export async function advanceOne(
  service: SupabaseClient,
  target: string | null,
  follow: AdvanceFollow,
): Promise<{ outcome: AdvanceOutcome | null; parked: number }> {
  const { held, parked } = await claimCaseAdvances(service, 1, target);
  if (!held[0]) return { outcome: null, parked };
  return { outcome: await advanceClaimedCase(service, held[0], follow), parked };
}

/**
 * Claims and carries on the cases due, one at a time, while there may be
 * more (a claim that only set cases aside may have more due behind them);
 * the outcome of each.
 */
export async function advanceCases(
  service: SupabaseClient,
  limit: number,
  target: string | null,
  follow: AdvanceFollow,
): Promise<Record<AdvanceOutcome, number>> {
  const outcomes: Record<AdvanceOutcome, number> = { created: 0, acted: 0, waiting: 0, idle: 0, lost: 0, failed: 0 };
  for (let turn = 0; turn < limit; turn += 1) {
    const round = await advanceOne(service, target, follow);
    if (round.outcome) outcomes[round.outcome] += 1;
    if (target || (!round.outcome && round.parked === 0)) break;
  }
  return outcomes;
}

/** How many woken cases a change of the firm's (named no case) has looked at right after. */
const WOKEN_AT_ONCE = 10;

/**
 * Something a person just did may have a step for ONE to take in a case
 * (the database already woke it): the case is looked at right after they are
 * answered. Named no case (a change of the firm's, such as who signs), the
 * cases it woke are looked at, a few; the sweep takes whatever is left.
 */
export async function queueCaseAdvance(caseId: string | null): Promise<void> {
  soon("case-advance", () => advanceCases(createServiceClient(), caseId ? 1 : WOKEN_AT_ONCE, caseId, followSoon));
}
