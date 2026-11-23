import type { AccountState } from "@/lib/cases/account";
import { type WaitActor, waitingKey, type WaitOwner, waitPlaceOf } from "@/lib/cases/advance";
import {
  type CaseStatus,
  DOCUMENT_KIND_KEY,
  type DocumentKind,
  isDocumentKind,
  type LinkOwed,
  type Missing,
  PERSON_FIELD_KEY,
} from "@/lib/cases/cases";
import { DATA_KINDS } from "@/lib/cases/read-fields";
import type { CaseSection } from "@/lib/cases/sections";
import { complaintOverdue } from "@/lib/cases/statements";
import { type ScreenFilingFacts, type ScreenStanding, screenStanding } from "@/lib/filing-ways/ways";
import type { PendingText } from "@/lib/firm/pending";
import { momentIn } from "@/lib/hearings/hearings";

/**
 * What happens in a case now, said in one place at its top (the owner's audit of the case screen, 2026-11-05):
 * what ONE is doing at this moment, what holds the case and whose turn it is, and who the case is with. Read from
 * what the case screen already reads (pure): its people and documents, the client's account, its signatures, its
 * lawsuits with their pieces and packages, what it has in court, the links ONE owes and what ONE waits for, so the
 * top says each thing the cards say, once, with the card it is done in. A person reads where the case stands, and
 * whether ONE is at it, without hunting through the cards.
 */

/** Who of the firm acts on a line: anybody, a lawyer, who decides for the firm, who approves the court's system or confirms a deadline, who runs the deadlines. */
export type NowActor = WaitActor | "confirmers" | "deadlines";

export type NowTone = "failed" | "attention" | "waiting" | "info";

/** One thing the top says: whose it is, in words, with the card it is done in. */
export type NowItem = {
  id: string;
  owner: WaitOwner;
  actor: NowActor | null;
  tone: NowTone;
  text: PendingText;
  /** The card of the case it is done in; null for a place out of the case (`href`). */
  section: CaseSection | null;
  href: string | null;
  /** Since when, for what ONE is doing and what waits. */
  since: string | null;
  /** A question the line asks in place: whether a decision the court published is the judgment. */
  ask: { kind: "judgment"; publicationId: string } | null;
  /** The fields of a person still empty, for the screen to say each in its words (`PERSON_FIELD_KEY`). */
  fields: string[] | null;
  /** ONE's work that took longer than it should: still ONE's, said as late, and not asked about every few seconds. */
  slow: boolean;
  /**
   * ONE's work that waits on somebody outside it (a court out of reach, tried again at a later time): still ONE's,
   * but never a reason to hold the screen while the court takes its time.
   */
  outside?: boolean;
};

/** Who the case is with now. */
export type NowHolder = "client" | "firm" | "one" | "platform" | "court" | "ended";

export type CaseNow = {
  /** What ONE is doing at this moment, the oldest first. */
  working: NowItem[];
  /**
   * What ONE does after what waits now (the account it asks once the client signs, the data it asks in the chat once
   * the client answered what comes first): said under its own title, never as ONE's work now, never what holds the
   * case nor a reason to hold the screen (the owner's test of 2026-11-23).
   */
  later: NowItem[];
  /** What holds the case: the firm's first (a failure before the rest), then the client's, ONE's and the platform's. */
  blocking: NowItem[];
  holder: NowHolder;
  /** What each card holds of the top: whether something there waits for the firm, and whether ONE works there. */
  sections: Partial<Record<CaseSection, { firm: boolean; failed: boolean; client: boolean; working: boolean }>>;
};

// The shapes the case screen reads, as much of them as the top needs.

type Doc = {
  id: string;
  kind: string;
  partyId: string | null;
  status: "received" | "accepted" | "rejected";
  createdAt: string;
  processing: "pending" | "working" | "done" | "skipped" | "failed";
  check: { waiting: boolean; answer: { decisao?: string } | Record<string, unknown> } | null;
  /** The envelope a paper the client sent back signed belongs to (gov.br): said by that envelope, once (0280). */
  envelopeId?: string | null;
};
type Party = { partyId: string; role: "claimant" | "guardian"; person: { full_name: string; person_id: string } };
type Lawsuit = {
  id: string;
  kind: "juizado" | "comum";
  system: string | null;
  status: "planned" | "filed" | "closed";
  systemApproval: unknown | null;
  systemRefusal: unknown | null;
};
type Envelope = {
  id: string;
  documentId: string;
  status: string;
  createdAt: string;
  signers: { name: string; signedAt: string | null }[];
};
type Draft = {
  id: string;
  proceedingId: string;
  status: string;
  work: string | null;
  slow?: boolean;
  requestedAt?: string | null;
  /** What ONE is doing with a text it carries (0099, 0100): asking the client what it lacks, or writing it again. */
  oneRedo?: "asking" | "rewriting" | null;
  /** The text of its latest version: what it leaves to complete ("[COMPLETAR: CNPJ da companhia]") is said. */
  body?: string | null;
  /** What its filled text leaves to complete, as the database read it (0245); else read from `body`. */
  gaps?: string[];
};

/** What a piece leaves to complete: as the database read its filled text, else from its own text. */
const gapsOf = (draft: Draft): string[] => (draft.gaps && draft.gaps.length > 0 ? draft.gaps : draftGaps(draft.body));

/** What a piece's text leaves to complete, in its own words, once each. */
export function draftGaps(body: string | null | undefined): string[] {
  const gaps = [...(body ?? "").matchAll(/\[COMPLETAR:\s*([^\]]+)\]/g)].map((match) => match[1].trim());
  return [...new Set(gaps.filter(Boolean))];
}
type Filing = {
  id: string;
  proceedingId: string;
  system: string;
  status: string;
  slow?: boolean;
  blocker: string | null;
  signature: { takesSigned: boolean; status: "due" | "waiting" | "signed" | "failed" | null };
  /**
   * ONE filing it itself (0101): through which channel, what keeps it from doing so, and what came of its sending; a
   * sending of `browser` or `extension` is a lawyer's batch on the court's screen (0264).
   */
  byOne?: {
    channel: string | null;
    blocker: string | null;
    submission: { status: string; channel?: string; attempts?: number; retryAfter?: string | null } | null;
    /** The court's screen ONE files on where its court has no channel (0263), and how its lawyers file there. */
    screen?: ScreenFilingFacts | null;
  } | null;
};
type Deadline = { id: string; status: string; overdue: boolean; review: boolean };
type Hearing = { id: string; status: string; startsAt: string; timeZone: string };
type Publication = {
  id: string;
  category: string | null;
  availableOn: string;
  judgment: boolean | null;
  readings: { kind: string; status: string }[];
  /** ONE triaged it and nobody said yet that they are aware of it (0104). */
  ackOwed?: boolean;
  /** Of one nobody triaged: ONE is triaging it, or left it to a person (0104). */
  triageState?: "working" | "left" | null;
  /** The lawyers it was addressed to, by name: whose awareness it waits for. */
  lawyers?: string[];
};
type Complaint = { id: string; outcome: string; answerDueOn: string | null };
type Interview = { status: string; inChat: boolean; position: number; total: number; done: number } | null;

export type CaseNowInput = {
  status: CaseStatus;
  today: string;
  now: string;
  parties: Party[];
  documents: Doc[];
  missing: Missing[];
  /** The claimants of a lawsuit planned in the civil court whose word on it is missing or a no. */
  civilCourt: { partyId: string; accepted: boolean | null | undefined; minor: boolean }[];
  account: AccountState | null;
  /**
   * The client's account is asked by ONE in an interview that starts once something of the case is signed (0181):
   * until then it is ONE's work to come, never what holds the case (the owner's test of 2026-11-13).
   */
  accountAfterSignature?: boolean;
  /**
   * The passenger whose data ONE asks in the WhatsApp (the chat's check of data, 0232; `case_data_in_chat`, 0280):
   * asked and waiting for the answer, to ask now, or to ask once the client answered what comes first. Null when ONE
   * does not ask it there (no conversation ONE carries, the window closed), and the client completes it on the link.
   */
  dataInChat?: DataInChat | null;
  interview: Interview;
  /** What ONE waits for to carry the case on (0039), and since when. */
  waiting: string | null;
  waitingSince: string | null;
  /** ONE is looking at the case now, or owes it a look at its next round (0096). */
  advance: { running: boolean; due: boolean } | null;
  linksOwed: LinkOwed[];
  envelopes: Envelope[];
  proceedings: Lawsuit[];
  drafts: Draft[];
  filings: Filing[];
  /** The lawyers of the planned lawsuits the client's power of attorney does not name. */
  unnamedSigners: { proceedingId: string; lawyer: string | null }[];
  deadlines: Deadline[];
  hearings: Hearing[];
  hearingMinutes: number;
  publications: Publication[];
  complaints: Complaint[];
  statementsWorking: { id: string; spoken: boolean; since: string | null }[];
};

/** Where the data ONE asks the passenger in the chat stands (0280): asked, to ask now, or to ask later. */
export type DataInChat = { personId: string; state: "asked" | "to_ask" | "later" };

const DATA_STATES: readonly DataInChat["state"][] = ["asked", "to_ask", "later"];

/** The answer of `case_data_in_chat`, read; null when ONE does not ask it there or the answer is not one. */
export function dataInChatOf(raw: unknown): DataInChat | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  const state = DATA_STATES.find((one) => one === row.state);
  return typeof row.person_id === "string" && state ? { personId: row.person_id, state } : null;
}

/** What ONE asks of a person in the chat's check of data (0232): what the papers need and no document gives. */
const CHAT_FIELDS: ReadonlySet<string> = new Set(["nationality", "marital_status", "profession"]);

const KIND_KEY: Record<Lawsuit["kind"], string> = {
  juizado: "case-proceeding-kind-juizado",
  comum: "case-proceeding-kind-comum",
};

/** A day of the calendar as the screens write it: 03/11/2026. */
const dayWords = (day: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(day) ? `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}` : day;

const SYSTEMS = ["projudi", "eproc", "pje", "esaj", "outro"];
/** A court's system in its own name ("PJe"), or as it is written when the screen has no word for it. */
const systemWord = (system: string) => (SYSTEMS.includes(system) ? { message: `case-system-${system}` } : system);

/**
 * What ONE waits for to file a lawsuit on its court's screen (0263, 0264), as the line of the top says it and who of
 * the firm does it: the firm's way, a lawyer's way at that system, or the batch a lawyer of the lawsuit approves.
 */
const SCREEN_LINE: Record<Exclude<ScreenStanding["kind"], "hand">, { key: string; actor: NowActor }> = {
  firm_unchosen: { key: "case-now-filing-screen-firm", actor: "partner" },
  choose: { key: "case-now-filing-screen-choose", actor: "lawyer" },
  batch: { key: "case-now-filing-screen-batch", actor: "lawyer" },
};

/** What came of ONE's filing, where a lawyer takes it up (0101). */
const FILING_SENT_KEY: Record<"refused" | "failed" | "unknown" | "filed", string> = {
  refused: "case-now-filing-one-refused",
  failed: "case-now-filing-one-failed",
  unknown: "case-now-filing-one-unknown",
  filed: "case-now-filing-one-unnumbered",
};

/**
 * A document named inside a sentence ("o documento de identidade"): the label of its kind starts with a capital and
 * reads as a title, so the top has its own words for the middle of a sentence.
 */
const DOCUMENT_PHRASE_KEY: Record<DocumentKind, string> = {
  identity: "case-now-document-identity",
  address_proof: "case-now-document-address-proof",
  ticket: "case-now-document-ticket",
  boarding_pass: "case-now-document-boarding-pass",
  receipt: "case-now-document-receipt",
  evidence: "case-now-document-evidence",
  power_of_attorney: "case-now-document-power-of-attorney",
  residence_declaration: "case-now-document-residence-declaration",
  free_justice_declaration: "case-now-document-free-justice-declaration",
  income_proof: "case-now-document-income-proof",
  contract: "case-now-document-contract",
  petition: "case-now-document-petition",
  baggage_report: "case-now-document-baggage-report",
  defense: "case-now-document-defense",
  intermediate_petition: "case-now-document-intermediate-petition",
  other: "case-now-document",
};

const documentWord = (kind: string) => (isDocumentKind(kind) ? DOCUMENT_PHRASE_KEY[kind] : "case-now-document");

const item = (fields: Partial<NowItem> & Pick<NowItem, "id" | "owner" | "tone" | "text">): NowItem => ({
  actor: null,
  section: null,
  href: null,
  since: null,
  ask: null,
  fields: null,
  slow: false,
  ...fields,
});

/** The words of a wait ONE recorded, said as whose it is and where it is done. */
function waitItem(code: string, since: string | null): NowItem {
  const place = waitPlaceOf(code);
  return item({
    id: `wait:${code}`,
    owner: place.owner,
    actor: place.actor,
    tone:
      place.owner === "firm"
        ? code === "stuck"
          ? "failed"
          : "attention"
        : place.owner === "platform"
          ? "info"
          : "waiting",
    text: { key: "case-now-wait", values: { reason: { message: waitingKey(code) } } },
    section: (place.section as CaseSection | null) ?? null,
    href:
      code === "no_signer"
        ? "/settings/regras#quem-assina"
        : code === "no_model" || code === "paper_model_marks"
          ? "/biblioteca"
          : null,
    since,
  });
}

/** The waits the top says from the case's own facts, so the wait ONE recorded is not said a second time. */
const SAID_BY_FACTS = new Set([
  "case_incomplete",
  "civil_court_unanswered",
  "account_missing",
  "account_preparing",
  "account_proposed",
  "account_incomplete",
  "account_contested",
  "account_failed",
  "documents_waiting",
  "system_unapproved",
  "system_refused",
  "system_unknown",
  "power_of_attorney_unsigned",
]);

/** Why ONE has not sent somebody their link, said at the top of the case (the keys spelled out for the catalog check). */
const LINK_NOW_KEY: Record<Exclude<LinkOwed["reason"], "sending">, string> = {
  late: "case-now-link-late",
  by_person: "case-now-link-by-person",
  no_phone: "case-now-link-no-phone",
  no_number: "case-now-link-no-number",
  no_conversation: "case-now-link-no-conversation",
  opted_out: "case-now-link-opted-out",
  window_closed: "case-now-link-window-closed",
};

const FIRM_FIRST: Record<NowTone, number> = { failed: 0, attention: 1, waiting: 2, info: 3 };
const OWNER_ORDER: Record<WaitOwner, number> = { firm: 0, client: 1, one: 2, platform: 3 };

export function caseNow(input: CaseNowInput): CaseNow {
  const working: NowItem[] = [];
  const blocking: NowItem[] = [];
  const later: NowItem[] = [];
  const ended = input.status === "closed" || input.status === "declined";
  const nameOf = (partyId: string | null) =>
    input.parties.find((party) => party.partyId === partyId)?.person.full_name ?? "";

  if (!ended) {
    // ONE's own look at the case.
    if (input.advance?.running) {
      working.push(
        item({ id: "advance:running", owner: "one", tone: "waiting", text: { key: "case-now-one-looking" } }),
      );
    } else if (input.advance?.due && input.status !== "filed") {
      working.push(
        item({ id: "advance:due", owner: "one", tone: "waiting", text: { key: "case-now-one-looks-soon" } }),
      );
    }

    // The documents: ONE checking, or waiting for the firm. A paper the client sent back signed is said by its
    // envelope below ("devolveu ... confira e confirme"), never a second time here (the owner's test of 2026-11-23).
    const returned = new Set(
      input.envelopes.filter((envelope) => envelope.status === "received").map((envelope) => envelope.id),
    );
    const received = input.documents.filter(
      (document) => document.status === "received" && !(document.envelopeId && returned.has(document.envelopeId)),
    );
    const checking = received.filter(
      (document) => document.processing === "pending" || document.processing === "working",
    );
    if (checking.length > 0) {
      const since = checking.map((document) => document.createdAt).sort()[0] ?? null;
      working.push(
        item({
          id: "documents:checking",
          owner: "one",
          tone: "waiting",
          text:
            checking.length === 1
              ? nameOf(checking[0].partyId)
                ? {
                    key: "case-now-checking-one",
                    values: {
                      document: { message: documentWord(checking[0].kind) },
                      name: nameOf(checking[0].partyId),
                    },
                  }
                : {
                    key: "case-now-checking-one-case",
                    values: { document: { message: documentWord(checking[0].kind) } },
                  }
              : { key: "case-now-checking-many", values: { count: checking.length } },
          section: "documents",
          since,
        }),
      );
    }
    const suggested = received.filter((document) => document.check?.waiting && !checking.includes(document));
    const unchecked = received.filter(
      (document) => !checking.includes(document) && !document.check?.waiting && document.kind !== "petition",
    );
    if (suggested.length > 0) {
      blocking.push(
        item({
          id: "documents:suggested",
          owner: "firm",
          actor: "anyone",
          tone: "attention",
          text: { key: "case-now-documents-suggested", values: { count: suggested.length } },
          section: "documents",
          since: suggested.map((document) => document.createdAt).sort()[0] ?? null,
        }),
      );
    }
    if (unchecked.length > 0) {
      const failed = unchecked.some((document) => document.processing === "failed");
      blocking.push(
        item({
          id: "documents:unchecked",
          owner: "firm",
          actor: "anyone",
          tone: "attention",
          text: {
            key: failed ? "case-now-documents-check-failed" : "case-now-documents-unchecked",
            values: { count: unchecked.length },
          },
          section: "documents",
          since: unchecked.map((document) => document.createdAt).sort()[0] ?? null,
        }),
      );
    }

    // What the case lacks of its people and trip: the client's to send on the link (or anybody of the firm's to
    // write), never what ONE is reading from a document of that person right now.
    const readingFor = new Set(
      checking
        .filter((document) => DATA_KINDS.includes(document.kind) && document.partyId)
        .map((document) => input.parties.find((party) => party.partyId === document.partyId)?.person.person_id)
        .filter((id): id is string => Boolean(id)),
    );
    for (const [index, missing] of input.missing.entries()) {
      if (missing.type === "fields") {
        if (readingFor.has(missing.personId)) {
          working.push(
            item({
              id: `reading:${missing.personId}`,
              owner: "one",
              tone: "waiting",
              text: { key: "case-now-reading-person", values: { name: missing.name } },
              section: "people",
            }),
          );
          continue;
        }
        const fields = missing.fields.filter((field) => field in PERSON_FIELD_KEY);
        // What ONE asks the passenger in the chat is ONE's until it asked, and the client's to answer there once it
        // did; never "completes on the link" while nobody asked it (the owner's test of 2026-11-23).
        const chat =
          input.dataInChat?.personId === missing.personId &&
          fields.length > 0 &&
          fields.every((field) => CHAT_FIELDS.has(field))
            ? input.dataInChat.state
            : null;
        if (chat === "to_ask" || chat === "later") {
          (chat === "to_ask" ? working : later).push(
            item({
              id: `data:${missing.personId}`,
              owner: "one",
              tone: "waiting",
              text: {
                key: chat === "to_ask" ? "case-now-data-chat-ask" : "case-now-data-chat-later",
                values: { name: missing.name },
              },
              fields,
              section: "people",
            }),
          );
          continue;
        }
        blocking.push(
          item({
            id: `missing:fields:${missing.personId}`,
            owner: "client",
            tone: "waiting",
            text: {
              key: chat === "asked" ? "case-now-data-chat-answer" : "case-now-missing-fields",
              values: { name: missing.name },
            },
            fields,
            section: "people",
          }),
        );
      } else if (missing.type === "document") {
        blocking.push(
          item({
            id: `missing:document:${missing.kind}:${missing.personId ?? index}`,
            owner: "client",
            tone: "waiting",
            text: missing.name
              ? {
                  key: "case-now-missing-document",
                  values: { document: { message: DOCUMENT_KIND_KEY[missing.kind] }, name: missing.name },
                }
              : {
                  key: "case-now-missing-document-case",
                  values: { document: { message: DOCUMENT_KIND_KEY[missing.kind] } },
                },
            section: "documents",
          }),
        );
      } else {
        blocking.push(
          item({
            id: "missing:flight",
            owner: "client",
            tone: "waiting",
            text: { key: "case-now-missing-flight" },
            section: "trip",
          }),
        );
      }
    }

    // The word of each claimant on the civil court.
    for (const need of input.civilCourt) {
      const name = nameOf(need.partyId);
      blocking.push(
        need.accepted === false
          ? item({
              id: `civil:${need.partyId}`,
              owner: "firm",
              actor: "lawyer",
              tone: "attention",
              text: { key: need.minor ? "case-now-civil-declined-minor" : "case-now-civil-declined", values: { name } },
              section: "rules",
            })
          : item({
              id: `civil:${need.partyId}`,
              owner: "client",
              tone: "waiting",
              text: { key: "case-now-civil-unanswered", values: { name } },
              section: "rules",
            }),
      );
    }

    // The client's account of what happened.
    if (input.statementsWorking.length > 0) {
      const spoken = input.statementsWorking.some((statement) => statement.spoken);
      working.push(
        item({
          id: "statements:working",
          owner: "one",
          tone: "waiting",
          text: { key: spoken ? "case-now-transcribing" : "case-now-ordering" },
          section: "statements",
          since:
            input.statementsWorking
              .map((statement) => statement.since)
              .filter(Boolean)
              .sort()[0] ?? null,
        }),
      );
    }
    // What the client still owes of it holds the case only before its lawsuits: ONE waits for it to create them.
    // Once they exist it holds nothing, and goes to the piece when it comes (ONE writes it again, 0097), which the
    // card of the account says.
    const accountHolds = input.proceedings.length === 0;
    switch (input.account) {
      case "missing":
        if (!accountHolds) break;
        if (input.accountAfterSignature) {
          later.push(
            item({
              id: "account:after-signature",
              owner: "one",
              tone: "waiting",
              text: { key: "case-now-account-after-signature" },
              section: "statements",
            }),
          );
          break;
        }
        blocking.push(
          item({
            id: "account:missing",
            owner: "client",
            tone: "waiting",
            text: { key: "case-now-account-missing" },
            section: "statements",
          }),
        );
        break;
      case "preparing":
        if (input.statementsWorking.length === 0) {
          working.push(
            item({
              id: "account:preparing",
              owner: "one",
              tone: "waiting",
              text: { key: "case-now-ordering" },
              section: "statements",
            }),
          );
        }
        break;
      case "proposed":
        blocking.push(
          item({
            id: "account:proposed",
            owner: "firm",
            actor: "anyone",
            tone: "attention",
            text: { key: "case-now-account-proposed" },
            section: "statements",
          }),
        );
        break;
      case "incomplete":
        if (!accountHolds) break;
        blocking.push(
          item({
            id: "account:incomplete",
            owner: "client",
            tone: "waiting",
            text:
              input.interview?.status === "open" && input.interview.total > 0
                ? input.interview.inChat
                  ? {
                      key: "case-now-interview-chat",
                      values: { position: input.interview.position, total: input.interview.total },
                    }
                  : {
                      key: "case-now-interview-link",
                      values: { done: input.interview.done, total: input.interview.total },
                    }
                : { key: "case-now-account-incomplete" },
            section: "statements",
          }),
        );
        break;
      case "contested":
        working.push(
          item({
            id: "account:contested",
            owner: "one",
            tone: "waiting",
            text: { key: "case-now-account-contested" },
            section: "statements",
          }),
        );
        break;
      case "failed":
        blocking.push(
          item({
            id: "account:failed",
            owner: "firm",
            actor: "lawyer",
            tone: "failed",
            text: { key: "case-now-account-failed" },
            section: "statements",
          }),
        );
        break;
      default:
        break;
    }

    // The client's link ONE owes.
    for (const owed of input.linksOwed) {
      const name = input.parties.find((party) => party.person.person_id === owed.personId)?.person.full_name ?? "";
      if (owed.reason === "sending") {
        working.push(
          item({
            id: `link:${owed.personId}`,
            owner: "one",
            tone: "waiting",
            text: { key: "case-now-link-sending", values: { name } },
            section: "link",
          }),
        );
      } else {
        // ONE sends the link when the client writes: the client's turn, which the firm may shortcut on the card.
        const clients = owed.reason === "no_conversation" || owed.reason === "window_closed";
        blocking.push(
          item({
            id: `link:${owed.personId}`,
            owner: clients ? "client" : "firm",
            actor: clients ? null : "anyone",
            tone: clients ? "waiting" : "attention",
            text: { key: LINK_NOW_KEY[owed.reason], values: { name } },
            section: "link",
          }),
        );
      }
    }

    // What the client signs.
    for (const envelope of input.envelopes) {
      const names = envelope.signers
        .filter((signer) => !signer.signedAt)
        .map((signer) => signer.name)
        .join(", ");
      if (envelope.status === "reserved" || envelope.status === "opening") {
        working.push(
          item({
            id: `envelope:${envelope.id}`,
            owner: "one",
            tone: "waiting",
            text: { key: "case-now-envelope-opening" },
            section: "signatures",
            since: envelope.createdAt,
          }),
        );
      } else if (envelope.status === "pending") {
        blocking.push(
          item({
            id: `envelope:${envelope.id}`,
            owner: "client",
            tone: "waiting",
            text: { key: "case-now-envelope-pending", values: { names } },
            section: "signatures",
            since: envelope.createdAt,
          }),
        );
      } else if (envelope.status === "received") {
        // The paper by its own name: the contract is never said as the power of attorney.
        const paper = input.documents.find((document) => document.id === envelope.documentId)?.kind ?? "";
        blocking.push(
          item({
            id: `envelope:${envelope.id}`,
            owner: "firm",
            actor: "anyone",
            tone: "attention",
            text: {
              key: "case-now-envelope-received",
              values: {
                names: envelope.signers.map((s) => s.name).join(", "),
                document: { message: documentWord(paper) },
              },
            },
            section: "signatures",
          }),
        );
      } else if (envelope.status === "uncertain" || envelope.status === "failed") {
        blocking.push(
          item({
            id: `envelope:${envelope.id}`,
            owner: "firm",
            actor: "anyone",
            tone: envelope.status === "failed" ? "failed" : "attention",
            text: { key: envelope.status === "failed" ? "case-now-envelope-failed" : "case-now-envelope-uncertain" },
            section: "signatures",
          }),
        );
      }
    }

    // Each planned lawsuit: its court's system, who signs it, its piece and its package.
    for (const lawsuit of input.proceedings.filter((proceeding) => proceeding.status === "planned")) {
      const kind = { message: KIND_KEY[lawsuit.kind] };
      if (!lawsuit.system) {
        blocking.push(
          item({
            id: `system:${lawsuit.id}`,
            owner: "platform",
            tone: "info",
            text: { key: "case-now-system-unknown", values: { kind } },
            section: "proceedings",
          }),
        );
      } else if (lawsuit.systemRefusal) {
        blocking.push(
          item({
            id: `system:${lawsuit.id}`,
            owner: "platform",
            tone: "info",
            text: { key: "case-now-system-refused", values: { kind } },
            section: "proceedings",
          }),
        );
      } else if (!lawsuit.systemApproval) {
        blocking.push(
          item({
            id: `system:${lawsuit.id}`,
            owner: "firm",
            actor: "deciders",
            tone: "attention",
            text: { key: "case-now-system-unapproved", values: { kind, system: systemWord(lawsuit.system) } },
            section: "proceedings",
          }),
        );
      }
      for (const signer of input.unnamedSigners.filter((one) => one.proceedingId === lawsuit.id)) {
        blocking.push(
          item({
            id: `power:${lawsuit.id}:${signer.lawyer ?? ""}`,
            owner: "firm",
            actor: "partner",
            tone: "attention",
            text: { key: "case-now-power-unnamed", values: { lawyer: signer.lawyer ?? "", kind } },
            section: "proceedings",
          }),
        );
      }

      const draft = input.drafts.find(
        (one) => one.proceedingId === lawsuit.id && !["cancelled", "rejected"].includes(one.status),
      );
      if (draft) {
        if (draft.work === "generate" || draft.work === "revise" || draft.status === "generating") {
          working.push(
            item({
              id: `draft:${draft.id}`,
              owner: "one",
              tone: "waiting",
              text: {
                key: draft.work === "revise" ? "case-now-draft-revising" : "case-now-draft-writing",
                values: { kind },
              },
              section: "drafts",
              since: draft.requestedAt ?? null,
              slow: draft.slow === true,
            }),
          );
        } else if (draft.work === "check") {
          working.push(
            item({
              id: `draft:${draft.id}`,
              owner: "one",
              tone: "waiting",
              text: { key: "case-now-draft-checking", values: { kind } },
              section: "drafts",
            }),
          );
        } else if (draft.work === "issue" || draft.status === "approved") {
          working.push(
            item({
              id: `draft:${draft.id}`,
              owner: "one",
              tone: "waiting",
              text: { key: "case-now-draft-issuing", values: { kind } },
              section: "drafts",
            }),
          );
        } else if (draft.status === "proposed" && draft.oneRedo === "rewriting") {
          // The client answered what the piece lacked: ONE writes it again with the answers (0097, 0100).
          working.push(
            item({
              id: `draft:${draft.id}`,
              owner: "one",
              tone: "waiting",
              text: { key: "case-now-draft-rewriting", values: { kind } },
              section: "drafts",
            }),
          );
        } else if (draft.status === "proposed") {
          // While ONE asks the client what the piece lacks, the piece waits for the client: ONE writes it again with
          // the answers (0099). A lawyer may still take it up on its card.
          const asking =
            (draft.oneRedo === "asking" || input.interview?.status === "open") && (input.interview?.total ?? 0) > 0;
          blocking.push(
            item(
              asking && input.interview
                ? {
                    id: `draft:${draft.id}`,
                    owner: "client",
                    tone: "waiting",
                    text: input.interview.inChat
                      ? {
                          key: "case-now-draft-asking-chat",
                          values: { kind, position: input.interview.position, total: input.interview.total },
                        }
                      : {
                          key: "case-now-draft-asking-link",
                          values: { kind, done: input.interview.done, total: input.interview.total },
                        },
                    section: "drafts",
                  }
                : {
                    id: `draft:${draft.id}`,
                    owner: "firm",
                    actor: "lawyer",
                    tone: "attention",
                    // What the lawyer does, said: what the text leaves to complete, when it does (the owner, 2026-11-13).
                    text:
                      gapsOf(draft).length > 0
                        ? { key: "case-now-draft-complete", values: { kind, gaps: gapsOf(draft).join(", ") } }
                        : { key: "case-now-draft-review", values: { kind } },
                    section: "drafts",
                  },
            ),
          );
        } else if (draft.status === "failed") {
          blocking.push(
            item({
              id: `draft:${draft.id}`,
              owner: "firm",
              actor: "lawyer",
              tone: "failed",
              text: { key: "case-now-draft-failed", values: { kind } },
              section: "drafts",
            }),
          );
        }
      }

      const filing = input.filings.find(
        (one) => one.proceedingId === lawsuit.id && !["cancelled", "filed"].includes(one.status),
      );
      if (!filing) continue;
      if (filing.status === "requested") {
        working.push(
          item({
            id: `filing:${filing.id}`,
            owner: "one",
            tone: "waiting",
            text: { key: "case-now-filing-building", values: { kind } },
            section: "filing",
            slow: filing.slow === true,
          }),
        );
      } else if (filing.status === "failed") {
        blocking.push(
          item({
            id: `filing:${filing.id}`,
            owner: "firm",
            actor: "anyone",
            tone: "failed",
            text: { key: "case-now-filing-failed", values: { kind } },
            section: "filing",
          }),
        );
      } else if (filing.status === "ready") {
        if (filing.blocker) {
          const place = waitPlaceOf(filing.blocker);
          // What keeps the package from being filed is said once: by the line of the system, of the signature or of
          // the civil court above when there is one, and here otherwise.
          const saidAbove = blocking.some((line) =>
            filing.blocker?.startsWith("system_")
              ? line.id === `system:${lawsuit.id}`
              : filing.blocker === "power_of_attorney_unsigned" ||
                  filing.blocker === "residence_declaration_unsigned" ||
                  filing.blocker === "free_justice_unsigned"
                ? line.id.startsWith("envelope:")
                : filing.blocker === "civil_court_unanswered"
                  ? line.id.startsWith("civil:")
                  : false,
          );
          if (!saidAbove) {
            blocking.push(
              item({
                id: `filing:${filing.id}:blocker`,
                owner: place.owner,
                actor: place.actor,
                tone: place.owner === "firm" ? "attention" : place.owner === "platform" ? "info" : "waiting",
                text: {
                  key: "case-now-filing-blocked",
                  values: { kind, reason: { message: waitingKey(filing.blocker) } },
                },
                section: "filing",
              }),
            );
          }
        } else if (filing.signature.takesSigned && filing.signature.status === "due") {
          working.push(
            item({
              id: `filing:${filing.id}`,
              owner: "one",
              tone: "waiting",
              text: { key: "case-now-filing-signing", values: { kind } },
              section: "filing",
            }),
          );
        } else if (filing.signature.takesSigned && filing.signature.status === "waiting") {
          blocking.push(
            item({
              id: `filing:${filing.id}`,
              owner: "firm",
              actor: "lawyer",
              tone: "attention",
              text: { key: "case-now-filing-authorize", values: { kind } },
              section: "filing",
            }),
          );
        } else if (filing.signature.takesSigned && filing.signature.status === "failed") {
          blocking.push(
            item({
              id: `filing:${filing.id}`,
              owner: "firm",
              actor: "lawyer",
              tone: "failed",
              text: { key: "case-now-filing-sign-failed", values: { kind } },
              section: "filing",
            }),
          );
        } else {
          // ONE files it itself through the court's channel (0101): its work, until the court refuses it, does not
          // answer, or takes it without a number, which a lawyer then takes up.
          const byOne = filing.byOne ?? null;
          const sent = byOne?.submission?.status ?? null;
          // A lawyer's batch files it on the court's screen (0264): ONE's work too, once the lawyer handed it.
          const onScreen = byOne?.submission?.channel === "browser" || byOne?.submission?.channel === "extension";
          const where =
            byOne?.channel === "test_court" ? { message: "filing-one-test-court" } : systemWord(filing.system);
          if (onScreen && sent === "confirming") {
            blocking.push(
              item({
                id: `filing:${filing.id}`,
                owner: "firm",
                actor: "lawyer",
                tone: "attention",
                text: { key: "case-now-filing-screen-confirm", values: { kind, system: where } },
                section: "filing",
              }),
            );
          } else if (sent === "refused" || sent === "failed" || sent === "unknown" || sent === "filed") {
            blocking.push(
              item({
                id: `filing:${filing.id}`,
                owner: "firm",
                actor: "lawyer",
                tone: sent === "unknown" || sent === "filed" ? "attention" : "failed",
                text: { key: FILING_SENT_KEY[sent], values: { kind, system: where } },
                section: "filing",
              }),
            );
          } else if ((byOne?.channel || onScreen) && (sent !== null || byOne?.blocker === null)) {
            // A sending the court did not take is tried again at a later time: ONE waits on the court then.
            const retry = byOne?.submission ?? null;
            const outside =
              sent === "owed" &&
              (retry?.attempts ?? 0) > 0 &&
              Boolean(retry?.retryAfter) &&
              Date.parse(retry?.retryAfter ?? "") > Date.parse(input.now);
            working.push(
              item({
                id: `filing:${filing.id}`,
                owner: "one",
                tone: "waiting",
                text: { key: "case-now-filing-one", values: { kind, system: where } },
                section: "filing",
                ...(outside ? { outside: true } : {}),
              }),
            );
          } else {
            // A court with no channel whose screen ONE files on: the line says what ONE waits for there, the same as
            // the card (`screenStanding`); filed by hand, as the firm or every lawyer of it chose, the steps are said.
            const screen = byOne && !byOne.channel && sent === null ? (byOne.screen ?? null) : null;
            const standing = screen && byOne?.blocker === "no_channel" ? screenStanding(screen) : null;
            const line = standing && standing.kind !== "hand" ? SCREEN_LINE[standing.kind] : null;
            blocking.push(
              item({
                id: `filing:${filing.id}`,
                owner: "firm",
                actor: line?.actor ?? "lawyer",
                tone: "attention",
                text:
                  line && screen
                    ? { key: line.key, values: { kind, system: screen.name } }
                    : { key: "case-now-filing-ready", values: { kind, system: systemWord(filing.system) } },
                section: "filing",
              }),
            );
          }
        }
      }
    }

    // In court: the deadlines, the hearings and the publications of the case's lawsuits.
    const overdue = input.deadlines.filter((deadline) => deadline.overdue).length;
    const toConfirm = input.deadlines.filter((deadline) => deadline.status === "proposed").length;
    const toReview = input.deadlines.filter((deadline) => deadline.review).length;
    if (overdue > 0) {
      blocking.push(
        item({
          id: "deadlines:overdue",
          owner: "firm",
          actor: "deadlines",
          tone: "failed",
          text: { key: "case-now-deadlines-overdue", values: { count: overdue } },
          section: "deadlines",
        }),
      );
    }
    if (toConfirm > 0) {
      blocking.push(
        item({
          id: "deadlines:confirm",
          owner: "firm",
          actor: "confirmers",
          tone: "attention",
          text: { key: "case-now-deadlines-confirm", values: { count: toConfirm } },
          section: "deadlines",
        }),
      );
    }
    if (toReview > 0) {
      blocking.push(
        item({
          id: "deadlines:review",
          owner: "firm",
          actor: "confirmers",
          tone: "attention",
          text: { key: "case-now-deadlines-review", values: { count: toReview } },
          section: "deadlines",
        }),
      );
    }
    const nowAt = Date.parse(input.now);
    for (const hearing of input.hearings) {
      if (
        hearing.status === "scheduled" &&
        Date.parse(hearing.startsAt) + Math.max(input.hearingMinutes, 1) * 60_000 <= nowAt
      ) {
        blocking.push(
          item({
            id: `hearing:${hearing.id}`,
            owner: "firm",
            actor: "deadlines",
            tone: "attention",
            text: {
              key: "case-now-hearing-silent",
              values: {
                day: momentIn(hearing.startsAt, hearing.timeZone).day,
                time: momentIn(hearing.startsAt, hearing.timeZone).time,
              },
            },
            section: "hearings",
          }),
        );
      }
    }
    // ONE triages what the court publishes (0104): what it is triaging is its work; what it left is a person's.
    const notTriaged = input.publications.filter((publication) => publication.category === null);
    const triaging = notTriaged.filter((publication) => publication.triageState === "working").length;
    if (triaging > 0) {
      working.push(
        item({
          id: "publications:triaging",
          owner: "one",
          tone: "waiting",
          text: { key: "case-now-publications-triaging", values: { count: triaging } },
          section: "publications",
        }),
      );
    }
    const untriaged = notTriaged.length - triaging;
    if (untriaged > 0) {
      // With no hearing set and none triaged before, what the court published may be the hearing it just marked: once
      // a person says so, ONE writes it in the agenda and the client is told (the owner's test, 2026-11-05).
      const mayBeHearing =
        !input.hearings.some((hearing) => hearing.status === "scheduled") &&
        !input.publications.some((publication) => publication.category === "audiencia");
      blocking.push(
        item({
          id: "publications:untriaged",
          owner: "firm",
          actor: "deadlines",
          tone: "attention",
          text: {
            key: mayBeHearing ? "case-now-publications-untriaged-hearing" : "case-now-publications-untriaged",
            values: { count: untriaged },
          },
          section: "publications",
        }),
      );
    }
    // What ONE triaged waits for the awareness of the lawyer it was addressed to (0104).
    const unacknowledged = input.publications.filter((publication) => publication.ackOwed === true);
    if (unacknowledged.length > 0) {
      const names = [...new Set(unacknowledged.flatMap((publication) => publication.lawyers ?? []))];
      blocking.push(
        item({
          id: "publications:ack",
          owner: "firm",
          actor: "lawyer",
          tone: "attention",
          text:
            names.length > 0
              ? {
                  key: "case-now-publications-ack",
                  values: { count: unacknowledged.length, names: names.join(", ") },
                }
              : { key: "case-now-publications-ack-anyone", values: { count: unacknowledged.length } },
          section: "publications",
        }),
      );
    }
    for (const publication of input.publications) {
      if (publication.category === "decisao" && publication.judgment === null) {
        blocking.push(
          item({
            id: `judgment:${publication.id}`,
            owner: "firm",
            actor: "deadlines",
            tone: "attention",
            text: { key: "case-now-judgment-ask", values: { day: dayWords(publication.availableOn) } },
            ask: { kind: "judgment", publicationId: publication.id },
          }),
        );
      }
      for (const reading of publication.readings) {
        const kind = { message: reading.kind === "hearing" ? "case-now-reading-hearing" : "case-now-reading-deadline" };
        if (reading.status === "due" || reading.status === "working") {
          working.push(
            item({
              id: `reading:${publication.id}:${reading.kind}`,
              owner: "one",
              tone: "waiting",
              text: {
                key: "case-now-publication-reading",
                values: { what: kind, day: dayWords(publication.availableOn) },
              },
              section: reading.kind === "hearing" ? "hearings" : "deadlines",
            }),
          );
        } else if (reading.status === "unread" || reading.status === "failed") {
          blocking.push(
            item({
              id: `reading:${publication.id}:${reading.kind}`,
              owner: "firm",
              actor: "deadlines",
              tone: "attention",
              text: {
                key: "case-now-publication-unread",
                values: { what: kind, day: dayWords(publication.availableOn) },
              },
              section: "publications",
            }),
          );
        }
      }
    }
    const paid = input.publications
      .filter((publication) => publication.category === "pagamento")
      .map((publication) => publication.availableOn)
      .sort()[0];
    if (input.status === "filed" && paid) {
      blocking.push(
        item({
          id: "payment",
          owner: "firm",
          actor: "anyone",
          tone: "attention",
          text: { key: "case-now-payment", values: { day: dayWords(paid) } },
        }),
      );
    }

    // A complaint whose answer is past its day.
    for (const complaint of input.complaints) {
      if (complaintOverdue(complaint, input.today)) {
        blocking.push(
          item({
            id: `complaint:${complaint.id}`,
            owner: "firm",
            actor: "anyone",
            tone: "attention",
            text: { key: "case-now-complaint-overdue" },
            section: "complaints",
          }),
        );
      }
    }

    // What ONE recorded it waits for, when nothing above says it already.
    if (input.waiting && !SAID_BY_FACTS.has(input.waiting) && input.status !== "filed") {
      const line = waitItem(input.waiting, input.waitingSince);
      if (line.owner === "one") working.push(line);
      else blocking.push(line);
    }
  }

  blocking.sort((a, b) => OWNER_ORDER[a.owner] - OWNER_ORDER[b.owner] || FIRM_FIRST[a.tone] - FIRM_FIRST[b.tone]);
  working.sort((a, b) => (a.since ?? "9").localeCompare(b.since ?? "9"));

  const holder: NowHolder = ended
    ? "ended"
    : blocking.some((line) => line.owner === "firm")
      ? "firm"
      : working.length > 0
        ? "one"
        : blocking.some((line) => line.owner === "client")
          ? "client"
          : blocking.some((line) => line.owner === "platform")
            ? "platform"
            : input.status === "filed"
              ? "court"
              : "one";

  const sections: CaseNow["sections"] = {};
  const mark = (line: NowItem, field: "firm" | "failed" | "client" | "working") => {
    if (!line.section) return;
    const current = sections[line.section] ?? { firm: false, failed: false, client: false, working: false };
    current[field] = true;
    sections[line.section] = current;
  };
  for (const line of blocking) {
    if (line.owner === "firm") mark(line, line.tone === "failed" ? "failed" : "firm");
    else if (line.owner === "client") mark(line, "client");
  }
  for (const line of working) mark(line, "working");

  return { working, later, blocking, holder, sections };
}

/** Who of the firm acts on a line, in words: what the top says beside a line that is the firm's. */
export const ACTOR_KEY: Record<NowActor, string> = {
  anyone: "case-now-actor-anyone",
  lawyer: "case-now-actor-lawyer",
  partner: "case-now-actor-partner",
  deciders: "case-now-actor-deciders",
  confirmers: "case-now-actor-confirmers",
  deadlines: "case-now-actor-deadlines",
};

/** Whose a line is, in words, for one that is not the firm's. */
export const OWNER_KEY: Record<WaitOwner, string> = {
  firm: "case-now-owner-firm",
  client: "case-now-owner-client",
  one: "case-now-owner-one",
  platform: "case-now-owner-platform",
};

/** The holder in words, said first and in bold. */
export const HOLDER_KEY: Record<NowHolder, string> = {
  client: "journey-holder-client",
  firm: "journey-holder-firm",
  one: "journey-holder-one",
  platform: "journey-holder-platform",
  court: "journey-holder-court",
  ended: "journey-holder-ended",
};

/** Whether the person reading may do what a line of the firm asks: the screen offers its way only to them. */
export function mayAct(
  actor: NowActor | null,
  viewer: {
    lawyer: boolean;
    partner: boolean;
    decidesForFirm: boolean;
    decidesCourtSystem: boolean;
    confirmsDeadlines: boolean;
    worksDeadlines: boolean;
  },
): boolean {
  switch (actor) {
    case "lawyer":
      return viewer.lawyer;
    case "partner":
      return viewer.decidesForFirm;
    case "deciders":
      return viewer.decidesCourtSystem;
    case "confirmers":
      return viewer.confirmsDeadlines;
    case "deadlines":
      return viewer.worksDeadlines;
    default:
      return true;
  }
}

/** The card a line is done in, by its id on the case screen. */
export const SECTION_ANCHOR: Record<CaseSection, string> = {
  people: "case-people",
  trip: "case-trip",
  statements: "case-statements",
  documents: "case-documents",
  complaints: "case-complaints",
  signatures: "case-signatures",
  rules: "case-rules",
  proceedings: "case-proceedings",
  deadlines: "case-deadlines",
  hearings: "case-hearings",
  publications: "case-publications",
  pieces: "case-pieces",
  drafts: "case-drafts",
  filing: "case-filing",
  link: "case-link",
  notices: "case-notices",
  summary: "case-summary",
  dossier: "case-dossier",
  timeline: "case-timeline",
};

/**
 * What ONE did a moment ago, from the case's timeline (its own events, the latest first): what the top says under
 * what it is doing now, each with the card it is about.
 */
export function recentByOne<T extends { id: string; at: string; kind: string; actorType: string }>(
  events: readonly T[],
  now: string,
  hours = 24,
  limit = 3,
): T[] {
  const since = Date.parse(now) - hours * 3_600_000;
  return events
    .filter((event) => (event.actorType === "system" || event.actorType === "ai") && Date.parse(event.at) >= since)
    .slice(0, limit);
}

/** The card an event of the timeline is about, by its kind; null for one about the case as a whole. */
export function sectionOfEvent(kind: string): CaseSection | null {
  if (kind.startsWith("document_") || kind === "client_document_sent") return "documents";
  if (kind.startsWith("person_") || kind === "client_person_saved" || kind === "client_dependent_added")
    return "people";
  if (
    kind.startsWith("segment") ||
    kind === "client_segment_saved" ||
    kind === "flight_checked" ||
    kind === "flight_looked_up"
  )
    return "trip";
  if (
    kind.startsWith("statement_") ||
    kind.startsWith("chronology_") ||
    kind.startsWith("interview_") ||
    kind.startsWith("account_") ||
    kind.startsWith("client_statement") ||
    kind.startsWith("client_chronology") ||
    kind === "transcription_requested"
  )
    return "statements";
  if (kind.startsWith("signature_") || kind === "paper_issued") return "signatures";
  if (
    kind.startsWith("proceeding_") ||
    kind.startsWith("court_system") ||
    kind === "signers_named" ||
    kind === "signer_occasional"
  )
    return "proceedings";
  if (kind.startsWith("draft_")) return "drafts";
  if (kind.startsWith("filing_")) return "filing";
  if (kind.startsWith("deadline_")) return "deadlines";
  if (kind.startsWith("hearing_")) return "hearings";
  if (kind.startsWith("publication_")) return "publications";
  if (kind.startsWith("client_link")) return "link";
  if (kind.startsWith("notices_")) return "notices";
  if (kind.startsWith("complaint_")) return "complaints";
  if (kind.startsWith("dossier_")) return "dossier";
  if (kind === "court_moved") return "proceedings";
  if (
    kind === "claim_set" ||
    kind === "claim_defaulted" ||
    kind === "suspension_saved" ||
    kind.startsWith("family_") ||
    kind.startsWith("civil_court") ||
    kind === "weather_read"
  )
    return "rules";
  return null;
}
