import type { AirlineOption } from "../cases-types";

import type { PendingApproval, SecondFactorState } from "@/lib/ai/approvals";
import type { AccountState } from "@/lib/cases/account";
import type { CaseStatus, Cause, LinkOwed, Origin, PersonData, RequiredDocument } from "@/lib/cases/cases";
import type { CheckAnswer } from "@/lib/cases/document-check";
import type { DocumentQuality } from "@/lib/cases/document-quality";
import type { CaseDossier, CaseDraft, CasePieces } from "@/lib/cases/draft-facts";
import type { CivilCourtNeed, CourtNote, FamilyState } from "@/lib/cases/family";
import type { CaseCost, CaseFees } from "@/lib/cases/fees";
import type { CaseFiling } from "@/lib/cases/filing-facts";
import type { FreeJusticeNeed } from "@/lib/cases/free-justice";
import type { InterviewView } from "@/lib/cases/interview";
import type { StageMoment } from "@/lib/cases/journey";
import type { LawsuitFact } from "@/lib/cases/outcomes";
import type { CasePulse } from "@/lib/cases/pulse";
import type { CaseQualification } from "@/lib/cases/qualification";
import type { ReadFields } from "@/lib/cases/read-fields";
import type { ResidenceView } from "@/lib/cases/residence";
import type { Ceiling, LawyerCauses, WeatherAssessment } from "@/lib/cases/rules";
import type { CaseAudio, CaseComplaint, CaseStatement } from "@/lib/cases/statement-facts";
import type { ComplaintChannel } from "@/lib/cases/statements";
import type { CourseFacts } from "@/lib/courts/course-facts";
import type { CaseDeadlines, DeadlineAct } from "@/lib/deadlines/facts";
import type { AutonomyDecision, AutonomyMode } from "@/lib/firm/autonomy";
import type { FirmFunction } from "@/lib/firm/roles";
import type { CaseHearings, Colleague } from "@/lib/hearings/facts";
import type { CourtZones } from "@/lib/hearings/hearings";
import type { CaseNotices } from "@/lib/notices/facts";
import type { PublicationRow } from "@/lib/publications/facts";
import type { FlightChecks } from "@/modules/direito-do-passageiro/flights/facts";

export type CasePerson = PersonData & {
  /** What the federal registry said of the CPF, when somebody asked. */
  registry: {
    /** What the registry answered for the CPF with this birth date. */
    result: "found" | "not_found" | "birth_date_mismatch" | "minor";
    checkedAt: string;
    name: string | null;
    situation: string | null;
    regular: boolean | null;
    nameMatches: boolean | null;
  } | null;
  updatedVia: "firm" | "client";
  /** The fields ONE read from a document of theirs (migration 0063), until a person writes them. */
  readFields: ReadFields;
};

/** One person in the case: a claimant (an adult, or a minor with who answers for them) or a guardian. */
export type CaseParty = {
  partyId: string;
  role: "claimant" | "guardian";
  /** For a minor claimant: the guardian party who answers for them. */
  guardianPartyId: string | null;
  person: CasePerson;
};

export type CaseSegment = {
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
  source: "firm" | "client";
};

export type CaseDocument = {
  id: string;
  kind: string;
  partyId: string | null;
  status: "received" | "accepted" | "rejected";
  rejectedReason: string | null;
  /** Who sent it: the client, the firm, WhatsApp, the signature provider, or the partner agency (0071). */
  source: "client" | "firm" | "whatsapp" | "signature" | "partner" | "reuse";
  fileId: string;
  name: string;
  createdAt: string;
  /** The envelope a file the client sent back belongs to (gov.br). */
  envelopeId: string | null;
  /** Its bytes are a PDF (what a signature and a court system take). */
  pdf: boolean;
  /** What the backend did with it (migration 0024): normalized, checked, or why it could not. */
  processing: "pending" | "working" | "done" | "skipped" | "failed";
  processingError: string | null;
  /** The PDF the backend made of a photo: what goes to a court system. */
  normalizedFileId: string | null;
  /** What the rule measured of its photo where it arrived: what keeps it from being read, when something does. */
  quality: DocumentQuality | null;
  /** The AI's check: what it suggested, and whether the suggestion still waits for a person. */
  check: { answer: CheckAnswer; waiting: boolean } | null;
};

/** A lawyer who signs a planned lawsuit and whom the client's power of attorney does not name (0093). */
export type UnnamedSigner = { proceedingId: string; userId: string; lawyer: string | null };

/**
 * A planned lawsuit whose files ONE will sign in the cloud and that no lawyer of it covers yet with an
 * authorization (0102), with whether the person reading signs it and declared their CPF: asked on the card of the
 * filing before the package exists. Listed only where a provider of the cloud signature can be used here.
 */
export type SignatureAhead = { proceedingId: string; viewerSigns: boolean; viewerCpf: boolean };

export type CaseProceeding = {
  id: string;
  kind: "juizado" | "comum";
  court: string | null;
  comarca: string | null;
  unit: string | null;
  system: string | null;
  cnj: string | null;
  forumBasis: string | null;
  forumReason: string | null;
  /** The city the forum is in, when it is not the domicile's. */
  forumCity: string | null;
  /** The comarca is one the platform's table of the court knows (migration 0145). */
  comarcaChecked: boolean;
  status: "planned" | "filed" | "closed";
  filedAt: string | null;
  /** The system is ONE's, from the court's row of the platform's table (migration 0066). */
  systemByOne: boolean;
  /** The firm's approval of the system, as its decision: who and when (nobody named for one chosen before 0066). */
  systemApproval: { by: string | null; at: string } | null;
  /** The firm did not approve the system, and said why: the platform checks the court's acts. */
  systemRefusal: { by: string | null; at: string; reason: string } | null;
  /** ONE created the lawsuit, by the rules of the case. */
  createdByOne: boolean;
  parties: string[];
  lawyers: string[];
};

export type CaseLink = {
  id: string;
  personId: string;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  visits: number;
  lastOpenedAt: string | null;
  uploads: number;
  finishedAt: string | null;
};

export type CaseEvent = {
  id: string;
  at: string;
  kind: string;
  actorType: string;
  actorName: string | null;
  data: Record<string, unknown>;
};

/** A document sent to be signed (migration 0023). */
export type CaseEnvelope = {
  id: string;
  documentId: string;
  method: "zapsign" | "govbr" | "enotariado";
  status: string;
  signers: { position: number; personId: string; name: string; signUrl: string | null; signedAt: string | null }[];
  enotariadoUrl: string | null;
  signedDocumentId: string | null;
  lastError: string | null;
  endedReason: string | null;
  createdAt: string;
};

/** What a client accepted on their link: the text's title and version, and when. */
export type CaseConsent = { personId: string; title: string; version: number; acceptedAt: string };

export type TeamMember = { userId: string; name: string; firmFunction: FirmFunction };

export type CourtOption = { acronym: string; name: string; uf: string };

/** The filing system a court uses for each kind of proceeding, as the platform knows it (migration 0021). */
export type CourtSystem = {
  court: string;
  kind: "juizado" | "comum";
  system: string;
  confirmed: boolean;
  notes: string | null;
  /** The type the lawyer picks in the system for each kind of file, where it is known (0036). */
  fileTypes: Record<string, string>;
};

export type CaseDetail = {
  id: string;
  seq: number;
  /** A case of the test chat (0061): its papers may be signed by simulation (0138). */
  isTest?: boolean;
  /** The rule's word on whether the problem qualifies (0147), and a lawyer's going on with it all the same. */
  qualification?: CaseQualification | null;
  /** The product module of the case (migration 0068). */
  module: string;
  /** The kind of problem, one of its module's (lib/modules/registry.ts); null for a module that has none. */
  incident: string | null;
  airlineIata: string | null;
  flightDate: string | null;
  cause: Cause;
  status: CaseStatus;
  origin: Origin | null;
  /** The travel agency whose passenger the case came from (migration 0071), by its name; null for any other. */
  agency: string | null;
  summary: string | null;
  responsibleId: string | null;
  closeReason: string | null;
  createdAt: string;
};

/** What the rules of the domain decide on, and what they answered (migration 0025, `@flyee/rules`). */
export type CaseRules = {
  /** The small-claims court's ceiling today; null when no minimum wage is on record. */
  ceiling: Ceiling | null;
  /** What is asked for each claimant, by party, in centavos. */
  claims: Record<string, number | null>;
  /**
   * The firm's Valor da Causa Pedido for the case's kind of problem, in centavos: what a claimant with no value asks
   * once the lawsuits are created. Null when the firm gives none: the lawsuit goes with no value, for the judge.
   */
  claimDefault: number | null;
  /** Where the lawsuits are filed by default. */
  domicile: { city: string; uf: string } | null;
  /** The cities of the airports of the trip: where another forum may be. */
  tripPlaces: { city: string; uf: string }[];
  /** What the airline told the passenger was the cause. */
  statedCause: string | null;
  decision: "pending" | "file" | "hold";
  /** The decision was ONE's, from the triage, where the firm lets it. */
  decisionAuto: boolean;
  /** The triage kept the last time somebody saved it. */
  savedTriage: { risk: string; grounds: string[]; rule: string; at: string | null } | null;
  /** The weather read for the affected legs: per airport, and what the triage may conclude from it. */
  weather: WeatherAssessment;
  /** This environment has the key to read the reports. */
  weatherConfigured: boolean;
  /** The firm's lawyers' causes per state this year, and their registrations at the bar. */
  causes: LawyerCauses[];
  registrations: { userId: string; uf: string }[];
  year: number;
  /** How the family goes to court: together (the default) or split by a lawyer's choice, with the reason. */
  family: FamilyState;
  /** What the platform read of each court on a family split. */
  courtNotes: CourtNote[];
};

export type { CaseAudio, CaseComplaint, CaseDossier, CaseDraft, CaseFiling, CasePieces, CaseStatement };

export type CaseState =
  | {
      kind: "ready";
      case: CaseDetail;
      /**
       * The declarations of residence of the case (0123): each bill in somebody else's name the firm accepted, with
       * where its declaration stands; null when they could not be read.
       */
      residence: ResidenceView[] | null;
      /** Each claimant's word on free justice in the civil court (0125); null when it could not be read. */
      freeJustice: FreeJusticeNeed[] | null;
      /** What each lawsuit came to (0130): its facts, ONE's and the firm's; null when they could not be read. */
      outcomes: LawsuitFact[] | null;
      /** ONE closed the case and no lawyer said yet they saw it (0130). */
      closedByOne: { closed: boolean; acked: boolean };
      /** The case's costs (0131), read by anybody of the firm; null when they could not be read. */
      costs: CaseCost[] | null;
      /** The case's fees (0131), only for who reads the books (null for anybody else, or none set). */
      fees: CaseFees | null;
      /** What the person reads and does of the firm's books (0126), for the fees' card. */
      financeLevel: string | null;
      parties: CaseParty[];
      segments: CaseSegment[];
      documents: CaseDocument[];
      proceedings: CaseProceeding[];
      links: CaseLink[];
      /** Who of the case is owed a link and why ONE has not sent it (0046). */
      linksOwed: LinkOwed[];
      envelopes: CaseEnvelope[];
      consents: CaseConsent[];
      /** The firm has its ZapSign account connected. */
      zapsign: boolean;
      /** Every time the case entered a stage, the oldest first: the dates of its progress. */
      stageMoments: StageMoment[];
      /** The day the case's judgment and first payment were published (its steps in court besides the hearings). */
      courtPublications: { decidedAt: string | null; paidAt: string | null };
      /**
       * The publications in force of the case's lawsuits: what nobody triaged yet, a decision nobody said is or is
       * not the judgment (0096), and what ONE reads of each (0040).
       */
      publications: {
        id: string;
        category: string | null;
        availableOn: string;
        judgment: boolean | null;
        readings: { kind: string; status: string }[];
        /** ONE triaged it and nobody said yet that they are aware of it (0104). */
        ackOwed?: boolean;
        /** Of one nobody triaged: ONE is triaging it, or left it to a person (0104). */
        triageState?: "working" | "left" | null;
        /** The lawyers it was addressed to, by name. */
        lawyers?: string[];
      }[];
      /**
       * Every publication of the case's lawsuits as its card shows them (0104), the newest first, with whether there
       * are more than shown; null when they could not be read, which the card says.
       */
      publicationRows: { rows: PublicationRow[]; more: boolean } | null;
      /** The mark of the case and whether ONE is at it (0096): what the screen follows while it is open; null unread. */
      pulse: CasePulse | null;
      /** How the firm lets ONE take each decision now; a decision not read is ONE's, the platform's default. */
      autonomy: Partial<Record<AutonomyDecision, AutonomyMode>>;
      /** When the case was read, for the screen to say how fresh it is. */
      readAt: string;
      events: CaseEvent[];
      team: TeamMember[];
      airlines: AirlineOption[];
      courts: CourtOption[];
      courtSystems: CourtSystem[];
      required: RequiredDocument[];
      rules: CaseRules;
      /** Each claimant of a lawsuit planned in the civil court, and their word on it (0025). */
      civilCourt: CivilCourtNeed[];
      /** The lawyers of the planned lawsuits the client's power of attorney does not name (0093). */
      unnamedSigners: UnnamedSigner[];
      /** The planned lawsuits whose cloud signature no lawyer of them covers yet (0102). */
      signatureAhead: SignatureAhead[];
      /** What the clients told about the trip, each with where its chronology stands. */
      statements: CaseStatement[];
      /** Where the case's account stands, as ONE waits for it before the lawsuits (0090); null when unreadable. */
      account: AccountState | null;
      /** How many times ONE orders an account again by itself. */
      accountMaxRounds: number;
      /** The passenger's interview, one question at a time (0095); null with none, or unreadable. */
      interview: InterviewView | null;
      /** The audios the case's people sent over WhatsApp that are not an account yet. */
      audios: CaseAudio[];
      /** The complaints made before suing, with their protocol and what came of each. */
      complaints: CaseComplaint[];
      /** How many days each channel gives for an answer, as the platform's setting says. */
      complaintAnswerDays: Partial<Record<ComplaintChannel, number>>;
      /** The filing package of each lawsuit (the one in course, or the one filed), with its files and receipt. */
      filings: CaseFiling[];
      /** The draft of each lawsuit's piece, the models it may be asked from, and the dossiers issued. */
      pieces: CasePieces;
      /** What ANAC's official record and FlightAware said of each leg, beside the case's own times. */
      flights: FlightChecks;
      /** The course of each lawsuit as the court shows it: its reading, what waits in it and its latest movements. */
      course: CourseFacts;
      /** The case's deadlines: every open one and the latest closed. */
      deadlines: CaseDeadlines;
      /** The acts a term is usually set for, for the form of a new deadline. */
      deadlineActs: DeadlineAct[];
      /** The case's hearings: the ones to come and the ones with no word on them, and the latest held or cancelled. */
      hearings: CaseHearings;
      /** The firm's people, for who attends a hearing. */
      colleagues: Colleague[];
      /** The zones of each court, for the zone a new hearing is said in. */
      courtZones: Record<string, CourtZones>;
      /** What ONE waits for to carry the case on by itself (0039), and when it last looked; null with no record. */
      advance: { waiting: string | null; checkedLabel: string | null } | null;
      /** A partner of the firm: who names who signs what ONE prepares. */
      partner: boolean;
      /** What the case's clients are told on WhatsApp by themselves: who may be, what went and what is due. */
      notices: CaseNotices;
      /** The person manages the firm: the notices are switched on in its settings. */
      managesFirm: boolean;
      /** The person proposes, completes and corrects deadlines: who signs, or runs them. */
      worksDeadlines: boolean;
      /** The person confirms deadlines: a partner or the controladoria. */
      confirmsDeadlines: boolean;
      /** The person reading is a partner or a lawyer of the firm: who decides to file or to hold. */
      lawyer: boolean;
      /** The person reading approves, or not, the court system ONE names for a lawsuit (0066). */
      decidesCourtSystem: boolean;
      /** The day in Brazil's official time: who is a minor is decided by it. */
      today: string;
      /** The CPF registry is configured in this environment. */
      cpfLookup: boolean;
      supportVisit: boolean;
      /** The order of the facts (and a transcription) of the case's accounts that waits for a person (0016, 0026). */
      statementApprovals: PendingApproval[];
      /** Whether this session may decide what asks the second factor now. */
      secondFactor: SecondFactorState;
      /** The person's function in the firm: who the answers that wait name as deciders. */
      firmFunction: FirmFunction;
    }
  | { kind: "not-found" }
  | { kind: "no-firm" }
  | { kind: "unavailable" }
  | { kind: "error" };

/** How many events of the timeline the screen reads. */
export const EVENTS_SHOWN = 80;
