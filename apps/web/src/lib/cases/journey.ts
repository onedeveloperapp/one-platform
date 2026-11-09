import { type CaseStatus, isCaseStatus } from "@/lib/cases/cases";

/**
 * Where a case stands along its way, for the view of its progress (the owner, 2026-11-03): its steps in order,
 * each done, under way or still to come with the moment it began, and who the case is with now. Before the court
 * the steps are the case's stages; in court they are what its lawsuits show, since the case stays "filed" until it
 * ends: the hearing (one held, or the next one set), the judgment (a publication triaged as a decision) and the
 * payment (one triaged as a payment). Pure: read from the stage, the moments the case entered each stage (the
 * events `status_changed` of 0022, with `from` and `to`), those facts of the court and what ONE waits for (0039).
 */

/** The way of a case, in the order it goes. A case that does not go on (`declined`) stops on the way. */
export const JOURNEY_STEPS = [
  "intake",
  "documents",
  "signature",
  "drafting",
  "filing",
  "hearing",
  "judgment",
  "payment",
  "closed",
] as const;
export type JourneyStepId = (typeof JOURNEY_STEPS)[number];

export type JourneyStepState = "done" | "current" | "next" | "stopped";

export type JourneyStep = {
  id: JourneyStepId;
  state: JourneyStepState;
  /** When the case reached the step (or stopped there); null when it is not on record (a step it went past). */
  at: string | null;
  /** A hearing set and still to come, for the step of the hearing while it is under way. */
  scheduled: string | null;
};

export type CaseJourney = {
  steps: JourneyStep[];
  /** The step the case is at (or stopped at, or the last once it closed). */
  current: JourneyStepId;
  /** How the way ended, when it did. */
  ended: "closed" | "declined" | null;
  /** The index of the step the case is at: what the small bar of a list fills to. */
  reached: number;
};

/** A stage the case entered, and when. */
export type StageMoment = { from: CaseStatus | null; to: CaseStatus; at: string };

/** What a case's lawsuits show in court, with when; nothing of it before the case is filed. */
export type CourtFacts = {
  /** The latest hearing held. */
  heldAt: string | null;
  /** The next hearing set, still to come. */
  nextHearingAt: string | null;
  /** The first publication triaged as a decision. */
  decidedAt: string | null;
  /** The first publication triaged as a payment. */
  paidAt: string | null;
};

export const NO_COURT_FACTS: CourtFacts = { heldAt: null, nextHearingAt: null, decidedAt: null, paidAt: null };

/** What a case in court has been through, without the moments: what the lists and the counts read. */
export type CourtMarks = { held: boolean; decided: boolean; paid: boolean };

/** The step a case in court is at: the hearing, then the judgment, then the payment, then closing it. */
export function courtStep(marks: CourtMarks): JourneyStepId {
  if (marks.paid) return "closed";
  if (marks.decided) return "payment";
  if (marks.held) return "judgment";
  return "hearing";
}

/** The step a case is at by its stage and what its lawsuits show; null for a case that did not go on. */
export function stepOf(status: CaseStatus, marks: CourtMarks): JourneyStepId | null {
  switch (status) {
    case "ready":
      return "filing";
    case "filed":
      return courtStep(marks);
    case "declined":
      return null;
    default:
      return status;
  }
}

/**
 * The day a case's judgment and first payment were published, from its publications in force triaged so (0028):
 * what the court's side of its way reads besides its hearings. A decision is the judgment only when it was said to
 * be (0096, `judgment`): an injunction or an order on costs, before it, judges nothing.
 */
export function courtPublicationsOf(rows: { category: unknown; available_on: unknown; judgment?: unknown }[]): {
  decidedAt: string | null;
  paidAt: string | null;
} {
  const first = (keep: (row: { category: unknown; judgment?: unknown }) => boolean) =>
    rows
      .filter((row) => keep(row) && typeof row.available_on === "string")
      .map((row) => row.available_on as string)
      .sort()[0] ?? null;
  return {
    decidedAt: first((row) => row.category === "decisao" && row.judgment === true),
    paidAt: first((row) => row.category === "pagamento"),
  };
}

export const marksOf = (facts: CourtFacts): CourtMarks => ({
  held: facts.heldAt !== null,
  decided: facts.decidedAt !== null,
  paid: facts.paidAt !== null,
});

/** The stage changes of a case as the database keeps them (`case_events`), read; what is not one is left out. */
export function stageMomentsOf(rows: { at: unknown; data: unknown }[]): StageMoment[] {
  return rows.flatMap((row): StageMoment[] => {
    const data = (row.data ?? {}) as { from?: unknown; to?: unknown };
    if (typeof row.at !== "string" || !isCaseStatus(data.to)) return [];
    return [{ from: isCaseStatus(data.from) ? data.from : null, to: data.to, at: row.at }];
  });
}

/**
 * What the case's work shows of its way before the court, beside its stage (the owner's audit, 2026-11-05): ONE
 * moves a case to drafting when it creates the lawsuits, with the client's power of attorney still to be signed, and
 * builds the package with the case still in drafting. The way says where the case really is: at the signature while
 * a paper sent waits to be signed or confirmed, and at the filing once a package is being built or is ready.
 */
export type JourneyFacts = {
  /** Since when a paper the client signs waits to be signed, or for the firm to confirm it; null when none waits. */
  signatureSince: string | null;
  /** Since when a package of a lawsuit is being built or waits to be filed; null when none. */
  filingSince: string | null;
};

export const NO_JOURNEY_FACTS: JourneyFacts = { signatureSince: null, filingSince: null };

export function caseJourney(input: {
  status: CaseStatus;
  createdAt: string;
  moments: StageMoment[];
  court: CourtFacts;
  facts?: JourneyFacts;
}): CaseJourney {
  const facts = input.facts ?? NO_JOURNEY_FACTS;
  const moments = [...input.moments].sort((a, b) => a.at.localeCompare(b.at));
  // The latest time the case entered a stage: a stage gone back to begins again then.
  const enteredAt = (status: CaseStatus): string | null => {
    const last = moments.filter((moment) => moment.to === status).at(-1);
    return last?.at ?? (status === "intake" ? input.createdAt : null);
  };
  const court = input.court;
  const marks = marksOf(court);

  // When each step was reached, for a step done or under way: a stage by when the case entered it, the filing by
  // when it was filed (or became ready, while under way), each step in court by what the court showed.
  const reachedAt = (id: JourneyStepId, state: JourneyStepState): string | null => {
    switch (id) {
      case "signature":
        return state === "current" && facts.signatureSince ? facts.signatureSince : enteredAt("signature");
      case "filing":
        return state === "done"
          ? (enteredAt("filed") ?? enteredAt("ready"))
          : (enteredAt("ready") ?? facts.filingSince);
      case "hearing":
        return state === "done" ? court.heldAt : null;
      case "judgment":
        return state === "done" ? court.decidedAt : null;
      case "payment":
        return state === "done" ? court.paidAt : null;
      case "closed":
        return state === "done" ? enteredAt("closed") : null;
      default:
        return enteredAt(id);
    }
  };

  const build = (index: number, last: JourneyStepState, everyDone = false): JourneyStep[] =>
    JOURNEY_STEPS.map((id, at) => {
      const state: JourneyStepState = everyDone || at < index ? "done" : at === index ? last : "next";
      return {
        id,
        state,
        at: state === "next" ? null : reachedAt(id, state),
        scheduled: id === "hearing" && state === "current" ? court.nextHearingAt : null,
      };
    });

  if (input.status === "declined") {
    const declined = moments.filter((moment) => moment.to === "declined").at(-1) ?? null;
    // Where it stopped: the step it was at when it did not go on, or else the furthest stage it ever reached.
    const from = declined?.from ? stepOf(declined.from, marks) : null;
    const furthest = moments.reduce((most, moment) => {
      const step = stepOf(moment.to, marks);
      return step ? Math.max(most, JOURNEY_STEPS.indexOf(step)) : most;
    }, 0);
    const stoppedAt = Math.min(from ? JOURNEY_STEPS.indexOf(from) : furthest, JOURNEY_STEPS.length - 2);
    const steps = build(stoppedAt, "stopped");
    steps[stoppedAt] = { ...steps[stoppedAt], at: declined?.at ?? null };
    return { steps, current: JOURNEY_STEPS[stoppedAt], ended: "declined", reached: stoppedAt };
  }

  if (input.status === "closed") {
    const last = JOURNEY_STEPS.length - 1;
    return { steps: build(last, "done", true), current: "closed", ended: "closed", reached: last };
  }

  let current = stepOf(input.status, marks) ?? "intake";
  if (input.status !== "filed") {
    if (facts.signatureSince && JOURNEY_STEPS.indexOf(current) > JOURNEY_STEPS.indexOf("signature"))
      current = "signature";
    else if (current === "drafting" && facts.filingSince) current = "filing";
  }
  const index = JOURNEY_STEPS.indexOf(current);
  return { steps: build(index, "current"), current, ended: null, reached: index };
}

/** The steps a case in progress may be at: every one but the end. */
export const OPEN_STEPS = JOURNEY_STEPS.filter((id) => id !== "closed") as Exclude<JourneyStepId, "closed">[];
export type OpenStepId = (typeof OPEN_STEPS)[number];

// The `product` message keys, spelled out so the catalog check sees each one.

/** Each step of the way: a word or two. */
export const JOURNEY_STEP_KEY: Record<JourneyStepId, string> = {
  intake: "journey-step-intake",
  documents: "journey-step-documents",
  signature: "journey-step-signature",
  drafting: "journey-step-drafting",
  filing: "journey-step-filing",
  hearing: "journey-step-hearing",
  judgment: "journey-step-judgment",
  payment: "journey-step-payment",
  closed: "journey-step-closed",
};

/** What happens at the step the case is at, in a sentence. */
export const JOURNEY_NOW_KEY: Record<JourneyStepId, string> = {
  intake: "journey-now-intake",
  documents: "journey-now-documents",
  signature: "journey-now-signature",
  drafting: "journey-now-drafting",
  filing: "journey-now-filing",
  hearing: "journey-now-hearing",
  judgment: "journey-now-judgment",
  payment: "journey-now-payment",
  closed: "journey-now-closing",
};

/** What is said of a case whose way ended. */
export const JOURNEY_ENDED_KEY: Record<"closed" | "declined", string> = {
  closed: "journey-now-closed",
  declined: "journey-now-declined",
};

/**
 * Where the list of cases shows the cases of a step: each stage's group (with the client, in preparation, in
 * court), as its filters are.
 */
export const JOURNEY_LIST_FILTER: Record<OpenStepId, "open" | "preparing" | "filed"> = {
  intake: "open",
  documents: "open",
  signature: "open",
  drafting: "preparing",
  filing: "preparing",
  hearing: "filed",
  judgment: "filed",
  payment: "filed",
};
