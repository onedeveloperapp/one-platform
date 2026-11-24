/**
 * Court integrations of ONE (docs/ONE-PLANO-DESENVOLVIMENTO.md, 4.6 and 6).
 *
 * Every integration is an interface with two implementations, a real one and
 * a fake, and one contract test both must pass. Nothing here does I/O: the
 * real clients live beside this file when their milestone builds them.
 */

/**
 * The filing system a court runs. Which court runs which system, and since
 * when, is data (the `court_systems` table), never a constant in code.
 */
export type CourtSystem = "projudi" | "eproc" | "pje" | "esaj";

/**
 * A lawyer's registration at the bar: the state and the number as the bar
 * writes it, with its letter when it has one ("12345A" is another lawyer
 * than "12345").
 */
export type OabRegistration = { uf: string; number: string };

/**
 * One communication published in the DJEN (Diário de Justiça Eletrônico
 * Nacional): a summons or a notice addressed to a lawyer in a case.
 */
export type DjenCommunication = {
  /**
   * The DJEN's own identifier of the communication. It is the idempotency key
   * of the capture. A client hands over what is addressed to the lawyer as it
   * came, so this may be empty, and the case number or the day may not be one:
   * the capture refuses what it cannot keep, and counts it.
   */
  hash: string;
  /** The court's acronym as the DJEN writes it ("TJGO", "TJSP"). */
  court: string;
  /** The case number: its digits, no mask (20 of them when it is one). */
  cnj: string;
  /** The day it was made available, as YYYY-MM-DD. */
  availableOn: string;
  /** The kind the DJEN gives it ("Intimação", "Citação"), as published. */
  kind: string;
  /** What the court published under it ("Sentença", "Decisão", "Despacho"), when the DJEN says. */
  documentType: string | null;
  /** The body, as published. */
  text: string;
  /** The address of the case in the court's own system, when the DJEN gives one. Its host tells the system. */
  link: string | null;
  /** The unit of the court that published it ("2º Juizado Especial Cível de Goiânia"), when the DJEN names it. */
  unit: string | null;
  /** The class of the case, as published ("Procedimento do Juizado Especial Cível"). */
  className: string | null;
  /** False once the court cancelled it after making it available. */
  active: boolean;
  /** The reason the court gave for cancelling it, when the DJEN gives one. */
  cancelReason: string | null;
};

/**
 * What one look at the public API saw of a court on a day (the platform's watch over the DJEN): whether it answered,
 * how many communications the first page held, how many of them came with no text, and, by the kind of lawsuit each
 * is of, which system their links point to.
 */
export type DjenProbe = {
  items: number;
  withoutText: number;
  /** Links by kind of lawsuit and system: `{ juizado: { projudi: 40, pje: 3 } }`. A communication of no known kind is left out. */
  systems: Partial<Record<"juizado" | "comum", Partial<Record<"projudi" | "eproc" | "pje" | "esaj" | "outro", number>>>>;
};

export interface DjenClient {
  /**
   * Every communication addressed to a lawyer and made available on or after
   * `since` and, when `until` is given, on or before it (both YYYY-MM-DD),
   * oldest first. The public API serves a limited number of calls per window:
   * an implementation paces itself and waits within what one call may wait,
   * and past that says the limit was reached, so the capture tries again
   * later instead of insisting. A listing is whole or it is an error: when
   * the days asked hold more than one listing reads (more than a search
   * gives, or than the calls and the time of one turn), the implementation
   * says so and the capture asks for fewer days, never taking a part for the
   * whole and never asking again for what it could not read. And what cannot
   * be asked at all (a registration or a day that is not one) is refused: a
   * listing with nothing in it means days that were read.
   */
  listByOab(input: OabRegistration & { since: string; until?: string }): Promise<DjenCommunication[]>;
  /**
   * Every communication of one lawsuit, by its number (20 digits, with or without the mask), whoever it was
   * addressed to and whenever it was made available, oldest first: the history of a lawsuit the firm brings to ONE
   * already in court. Whole or an error, paced and refused as `listByOab` is; a number that is not one is refused.
   */
  listByProcess(input: { cnj: string }): Promise<DjenCommunication[]>;
  /**
   * The public address of the certificate of a communication, as the DJEN
   * itself issues it, by the hash. (The public API has no reading of one
   * communication by its hash: what it gives by the hash is its certificate.)
   */
  certificateUrl(hash: string): string;
  /**
   * One look at what a court made available on a day (its first page): the platform's watch over the DJEN. An API
   * that does not answer, refuses or answers what is no listing is an error, as in a listing; one call, never a wait.
   */
  probe(input: { court: string; day: string }): Promise<DjenProbe>;
}

/**
 * A lawsuit as a court's system (or an aggregator of many) shows it, read by
 * its CNJ number: what the firm checks its own records against. Who the
 * parties are is not kept: the firm has its clients, and the court's list
 * of them is personal data with no use here.
 */
export type CourtProceeding = {
  /** The case number as the source writes it ("5000123-60.2099.8.09.0051"). */
  number: string;
  /** The unit that holds it ("Goiânia - 3º Juizado Especial Cível"), as written. */
  unit: string | null;
  /** The class and the subjects, as written. */
  className: string | null;
  subjects: string[];
  /** The phase ("Conhecimento", "Execução") and the state ("Ativo", "Arquivado"), as written. */
  phase: string | null;
  status: string | null;
  /** The value of the claim, as written ("21.034,13"), when given. */
  claimValue: string | null;
  /** The day it was distributed and the day its decision became final, YYYY-MM-DD, when known. */
  distributedOn: string | null;
  finalOn: string | null;
  /** In secret ("segredo de justiça"): the source shows nothing of its course. */
  secret: boolean;
  /** The lawyers on record, with the registration as the source writes it and whom they act for. */
  lawyers: { name: string; oab: string | null; party: string | null; receivesNotices: boolean | null }[];
  /** Who answers for it at the court: the judge, as the source names them. */
  responsibles: { role: string; name: string; unit: string | null }[];
  /** What waits in it: an intimation and its term, a conclusion, a hearing, as written. Instants are ISO. */
  pending: { kind: "pendency" | "conclusion" | "hearing"; title: string; status: string | null; start: string | null; end: string | null }[];
};

/** One movement of a lawsuit ("andamento"), as its source wrote it. */
export type CourtMovement = {
  /** The source's own id of the movement: what makes reading it twice write nothing new. */
  id: string;
  /** When it happened: an ISO instant. */
  at: string;
  /** What happened ("Decisão -> Outras Decisões"), as written. */
  title: string;
  /** What the source adds to it ("Recebe inicial | Determina citação"), when it does. */
  detail: string | null;
  /** Who did it, as the source names them (a clerk, a judge, "SISTEMA PROJUDI"), when it does. */
  by: string | null;
};

/** What reading a lawsuit came to: found, with every movement oldest first, or not found at the source. */
export type ProceedingRead =
  | { found: true; proceeding: CourtProceeding; movements: CourtMovement[] }
  | { found: false };

/**
 * Where the course of lawsuits is read: a court's own system (TJGO's Projudi)
 * or an aggregator of many courts. Read by the CNJ number alone, with no
 * login of a lawyer: a source that would need one is not a source of ONE.
 */
export interface ProceedingSource {
  /** Which source this is ("projudi", or an aggregator's name). */
  readonly name: string;
  /** Whether it reads the lawsuits of the court of a CNJ number (20 digits). */
  covers(cnj: string): boolean;
  /**
   * The lawsuit and every movement of it, oldest first; not found when the
   * source has no such lawsuit. An answer that cannot be had, or read whole,
   * is an error: never a lawsuit with no movements.
   */
  read(cnj: string): Promise<ProceedingRead>;
}

// ---------- Filing a lawsuit through a court's own channel (the MNI) ----------

/**
 * A party of a lawsuit to be filed, as a court's filing channel takes it.
 * What is not on record goes as such, never invented: the MNI's own "D"
 * ("desconhecido") for a sex nobody wrote, no document, no address.
 */
export type FilingParty = {
  name: string;
  sex: "M" | "F" | "D";
  kind: "fisica" | "juridica";
  /** A CPF (11 digits) or a CNPJ (14 digits), digits only; null when not on record. */
  document: string | null;
  address: {
    street: string;
    number: string | null;
    complement: string | null;
    district: string | null;
    city: string;
    /** The state's two letters. */
    state: string;
    /** The CEP, digits only. */
    zip: string | null;
  } | null;
  /** The lawyers who sign for the party: the registration as the MNI writes it (UF, seven digits, a letter). */
  lawyers: { name: string; oab: string; cpf: string | null }[];
  /** Who answers for a party who is a minor, named on the party. */
  representedBy: { name: string; document: string | null } | null;
};

/** A document of the filing, the petition first. */
export type FilingDocument = {
  /** Its own id at the sender, unique within the filing. */
  id: string;
  /**
   * The national code of its type (Resolução CNJ 46): 202 the initial petition, 99 a power of attorney, 65 an
   * identity, 277 a proof of address; the court's table says which it takes.
   */
  typeCode: string;
  description: string;
  pdf: Uint8Array;
  /** The lawyer's signature over it, when the court takes one: the CMS (`.p7s`) and the signer's certificate (PEM). */
  signature: { cms: Uint8Array; certificatePem: string; signedAt: Date } | null;
};

/** A new lawsuit, as a court's filing channel takes it. Every code is the court's, from the platform's table. */
export type LawsuitFiling = {
  /** The locality (comarca) the lawsuit is distributed in, by the court's own code. */
  localityCode: string;
  /** The court's code of the competence the lawsuit goes to, when it asks one. */
  competence: number | null;
  /** The judging body it is addressed to; the MNI asks one even of an initial petition. */
  judgingBody: { code: string; name: string; ibgeCity: string };
  /** The class of the lawsuit (Resolução CNJ 46): 436 the small-claims court, 7 the common civil procedure. */
  classCode: number;
  /** Its subjects (Resolução CNJ 46), one of them the main one. */
  subjects: { code: number; main: boolean }[];
  /** The value of the cause, in reais; null when none is given (the judge defines it). */
  value: number | null;
  plaintiffs: FilingParty[];
  defendants: FilingParty[];
  /** The petition first, then the documents, in the order of the filing package. */
  documents: FilingDocument[];
  /** The court's codes of the lawsuit's priorities of processing (an elderly party's); none when it has none. */
  priorities?: string[];
  sentAt: Date;
};

/**
 * A petition into a lawsuit the court already has (an intermediate piece: a manifestation, the réplica, an appeal, the
 * cumprimento), as a court's filing channel takes it: the lawsuit's number and the documents, the petition first.
 */
export type PetitionFiling = {
  /** The lawsuit's CNJ number, 20 digits. */
  caseNumber: string;
  /** The petition first, then what goes with it. */
  documents: FilingDocument[];
  sentAt: Date;
};

/**
 * What sending a lawsuit came to:
 * - `filed`: the court received it, with its protocol, the lawsuit's number when the court said it, and the
 *   receipt it gave (a PDF);
 * - `refused`: the court answered it did not take it, and why (nothing was filed);
 * - `unavailable`: the court could not be reached, and nothing was sent (safe to send again later);
 * - `unknown`: it was sent and no answer could be read: it may have been filed, so it is never sent again
 *   by itself (a person looks in the court's system first).
 */
export type FilingOutcome =
  | { kind: "filed"; protocol: string; caseNumber: string | null; receipt: Uint8Array | null; at: Date; message: string | null }
  | { kind: "refused"; protocol: string | null; message: string }
  | { kind: "unavailable"; reason: string }
  | { kind: "unknown"; reason: string };

/**
 * A court's own channel to file a new lawsuit by machine: the MNI
 * (`entregarManifestacaoProcessual`), with the credential the court gave.
 * Never a lawyer's login on the court's screen.
 */
export interface FilingChannel {
  /** Which channel this is ("mni", "fake", "test_court"). */
  readonly name: string;
  fileLawsuit(filing: LawsuitFiling): Promise<FilingOutcome>;
  /** A petition into a lawsuit the court has, by its number: the same outcomes, `caseNumber` the lawsuit's own. */
  filePetition(filing: PetitionFiling): Promise<FilingOutcome>;
}
