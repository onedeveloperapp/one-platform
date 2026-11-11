/**
 * How the courts decide passengers' lawsuits against airlines, read from public decisions (the case journey plan,
 * phase 5): the unit, the judge, the airline, the result, the moral damages set, the kind of problem and whether the
 * lawsuit was extinguished for want of a prior complaint. Never a passenger: no name, no number of a person and no
 * lawsuit's number is kept (the number leads to the parties).
 */

export type MarketProblem = "delay" | "cancellation" | "overbooking" | "baggage" | "other";

/** What the decision came to: a judgment's result, a settlement approved, or the lawsuit extinguished. */
export type MarketResult = "procedente" | "parcial" | "improcedente" | "acordo" | "extinto";

export type MarketDecision = {
  /** The source's own key of the communication (the DJEN's hash): a decision is read once. */
  key: string;
  /** The court's acronym (TJGO). */
  court: string;
  /** The unit as the court names it. */
  unit: string | null;
  /** The judge who signed it, as written; null when the text does not say. */
  judge: string | null;
  /** The airline as the court writes the party asked for. */
  party: string;
  /** The day the source made it available, YYYY-MM-DD. */
  day: string;
  /** First instance, or an appeal's panel (a turma recursal, a câmara). */
  instance: "first" | "appeal";
  result: MarketResult;
  /** The moral damages set, in cents, when the words set them. */
  moralCents: number | null;
  /** The value is each claimant's. */
  perClaimant: boolean;
  problem: MarketProblem;
  /** Extinguished for want of a prior complaint (pretensão resistida, interesse de agir). */
  priorComplaint: boolean;
  /**
   * The grounds and the operative part, with identifiers taken out, for the theses' reading at the moment it is read:
   * never kept.
   */
  grounds: string;
};

export type MarketQuery = {
  court: string;
  /** The airline as the court writes the party (one of `airlines.court_names`). */
  party: string;
  /** The day read, YYYY-MM-DD. */
  day: string;
};

export type MarketListing = {
  decisions: MarketDecision[];
  /** How many communications were read, decisions or not. */
  read: number;
  /** Every page of the day was read; false when the day held more than one reading takes. */
  complete: boolean;
};

/** A source of public decisions. */
export interface MarketSource {
  readonly name: string;
  decisionsOn(query: MarketQuery): Promise<MarketListing>;
}

/** The source could not be read now: nothing of the day is taken as read. */
export class MarketUnavailableError extends Error {
  readonly status: number | null;
  constructor(status: number | null) {
    super(`market_unavailable${status === null ? "" : `_${status}`}`);
    this.name = "MarketUnavailableError";
    this.status = status;
  }
}
