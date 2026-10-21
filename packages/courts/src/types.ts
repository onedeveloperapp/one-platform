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
   * The public address of the certificate of a communication, as the DJEN
   * itself issues it, by the hash. (The public API has no reading of one
   * communication by its hash: what it gives by the hash is its certificate.)
   */
  certificateUrl(hash: string): string;
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
