import type { CaseState } from "./case-types";

import { cardStates } from "@/lib/cases/card-state";
import { caseMissing } from "@/lib/cases/cases";
import { civilCourtPending } from "@/lib/cases/family";
import { interviewCounts } from "@/lib/cases/interview";
import { caseJourney } from "@/lib/cases/journey";
import { caseNow } from "@/lib/cases/now";
import { statementStage } from "@/lib/cases/statements";

type ReadyCase = Extract<CaseState, { kind: "ready" }>;

/** The stages a paper sent to be signed waits in: ONE sending it, the client signing it, the firm confirming it. */
const SIGNATURE_WAITS = ["reserved", "opening", "pending", "received", "uncertain"];

/**
 * What happens in a case now, read from what its screen read (pure): the top of the case (`caseNow`: what ONE is
 * doing, what holds the case and whose turn it is, who has the case), the step of its way (`caseJourney`) and where
 * each card stands. The screen shows it; the test that compares the controladoria's rule in the database with the
 * top of each case (`standing.db.test.ts`) reads the very same thing, so the two never say different people.
 */
export function caseFacts(ready: ReadyCase) {
  const missing = caseMissing({
    parties: ready.parties,
    documents: ready.documents.map((document) => ({
      kind: document.kind,
      party_id: document.partyId,
      status: document.status,
    })),
    segments: ready.segments.length,
    required: ready.required,
    today: ready.today,
  });
  const interview = ready.interview
    ? (() => {
        const counts = interviewCounts(ready.interview);
        return {
          status: ready.interview.status,
          inChat: ready.interview.inChat,
          position: counts.position,
          total: counts.total,
          done: counts.done,
        };
      })()
    : null;
  const civil = civilCourtPending(ready.civilCourt).map((need) => ({
    partyId: need.partyId,
    accepted: need.accepted,
    minor: need.minor,
  }));
  const now = caseNow({
    status: ready.case.status,
    today: ready.today,
    now: ready.readAt,
    parties: ready.parties,
    documents: ready.documents,
    missing,
    civilCourt: civil,
    account: ready.account,
    interview,
    waiting: ready.advance?.waiting ?? null,
    waitingSince: ready.pulse?.advance.waitingSince ?? null,
    advance: ready.pulse ? { running: ready.pulse.advance.running, due: ready.pulse.advance.due } : null,
    linksOwed: ready.linksOwed,
    envelopes: ready.envelopes,
    proceedings: ready.proceedings,
    drafts: ready.pieces.drafts,
    filings: ready.filings,
    unnamedSigners: ready.unnamedSigners,
    deadlines: ready.deadlines.open,
    hearings: ready.hearings.upcoming,
    hearingMinutes: ready.hearings.durationMinutes,
    publications: ready.publications,
    complaints: ready.complaints.map((complaint) => ({
      id: complaint.id,
      outcome: complaint.outcome,
      answerDueOn: complaint.answerDueOn,
    })),
    statementsWorking: ready.statements
      .filter((statement) => statement.work !== null && !statement.stalled)
      .map((statement) => ({
        id: statement.id,
        spoken: statement.spoken && statement.work === "transcribe",
        since: null,
      })),
  });
  const signatureSince =
    ready.envelopes
      .filter((envelope) => SIGNATURE_WAITS.includes(envelope.status))
      .map((envelope) => envelope.createdAt)
      .sort()[0] ?? null;
  const filingSince =
    ready.filings
      .filter((filing) => filing.status === "requested" || filing.status === "ready")
      .map((filing) => filing.requestedAt)
      .sort()[0] ?? null;
  const journey = caseJourney({
    status: ready.case.status,
    createdAt: ready.case.createdAt,
    moments: ready.stageMoments,
    court: {
      heldAt:
        ready.hearings.past
          .filter((hearing) => hearing.status === "held")
          .map((hearing) => hearing.startsAt)
          .sort()
          .at(-1) ?? null,
      nextHearingAt:
        ready.hearings.upcoming
          .filter(
            (hearing) =>
              hearing.status === "scheduled" && Date.parse(hearing.startsAt) > Date.parse(ready.hearings.now),
          )
          .map((hearing) => hearing.startsAt)
          .sort()[0] ?? null,
      decidedAt: ready.courtPublications.decidedAt,
      paidAt: ready.courtPublications.paidAt,
    },
    facts: { signatureSince, filingSince },
  });
  // Where each card stands, said on its head (the owner, 2026-11-05).
  const cards = cardStates(
    {
      status: ready.case.status,
      now: ready.readAt,
      today: ready.today,
      peopleMissing: missing.filter((item) => item.type === "fields").length,
      people: ready.parties.length,
      flightMissing: missing.some((item) => item.type === "flight"),
      segments: ready.segments.length,
      documentsMissing: missing.filter((item) => item.type === "document").length,
      documents: ready.documents,
      account: ready.account,
      statements: ready.statements.map((statement) => ({ stage: statementStage(statement) })),
      interviewOpen: ready.interview?.status === "open",
      envelopes: ready.envelopes,
      proceedings: ready.proceedings,
      drafts: ready.pieces.drafts,
      filings: ready.filings,
      hearings: ready.hearings.upcoming,
      publications: (ready.publicationRows?.rows ?? []).map((row) => ({
        category: row.category,
        ackOwed: row.ackOwed,
      })),
      deadlinesOpen: ready.deadlines.open.length,
      complaints: ready.complaints,
      links: ready.links,
      dossierIssued: ready.pieces.dossiers.some((dossier) => dossier.status === "issued"),
    },
    now,
  );
  return { now, journey, cards };
}
