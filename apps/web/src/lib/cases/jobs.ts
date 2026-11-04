import "server-only";

import { advanceOne, followSoon } from "@/lib/cases/advance-work";
import { claimCaseDocuments, processClaimedDocument } from "@/lib/cases/documents-work";
import { approveWaitingDrafts, draftNext } from "@/lib/cases/drafts-work";
import { buildClaimedPackage, claimFilingPackages } from "@/lib/cases/filing-work";
import { answerFromStatement, sweepInterviews } from "@/lib/cases/interview-work";
import { claimPackageSignatures, signClaimedPackage, signFilingPackages } from "@/lib/cases/package-signature-work";
import { askAccountQuestions, claimCaseStatements, processClaimedStatement } from "@/lib/cases/statements-work";
import type { Sweep } from "@/lib/jobs/schedule";

/** Adds one outcome to a round's counts. */
function tally(outcomes: Record<string, number>, outcome: string): void {
  outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
}

/**
 * The sweeps of a case's work. What a person's action leaves owed is done
 * right after they are answered (each `queue*` of the workers, through
 * `lib/jobs/soon.ts`); these take what that did not finish, recomputed from
 * the data on every pass: a work whose worker died goes back to the line by
 * itself, and a passing failure is tried again. Each work is claimed right
 * before it is done, one at a time, so a round that runs out of time leaves no
 * claim waiting for its turn, and a few works a round are enough: the rest
 * waits for the next one.
 *
 * Their answers carry counts only: a client's documents, account or piece are
 * read inside the work on them, never kept in a round's record.
 */
export const caseSweeps: Sweep[] = [
  /**
   * The documents (migration 0024): what reached a case is claimed,
   * normalized and checked by the AI.
   */
  {
    key: "case-documents",
    when: { every: 5 },
    whileUsed: true,
    run: async (service, until) => {
      const outcomes: Record<string, number> = {};
      for (let turn = 0; turn < 3 && Date.now() < until; turn += 1) {
        const [documentId] = await claimCaseDocuments(service, 1, null);
        if (!documentId) break;
        const processed = await processClaimedDocument(service, documentId).catch(() => ({ outcome: "error" }));
        tally(outcomes, processed.outcome);
      }
      return outcomes;
    },
  },
  /**
   * The clients' accounts (migration 0026): an audio is transcribed, and of
   * the text a chronology is proposed; one just transcribed is claimed again
   * for its chronology. What an order of the facts says is missing is asked in
   * the client's conversation too, once per round (0092).
   */
  {
    key: "case-statements",
    when: { every: 5 },
    whileUsed: true,
    run: async (service, until) => {
      const outcomes: Record<string, number> = {};
      // A step may take minutes (a model hearing an audio): two a round at most.
      for (let turn = 0; turn < 2 && Date.now() < until; turn += 1) {
        const [held] = await claimCaseStatements(service, 1, null);
        if (!held) break;
        const first = await processClaimedStatement(service, held).catch(() => "error");
        tally(outcomes, first);
        if (first !== "transcribed") continue;
        // An audio sent while a question of the interview waited is its answer (0095).
        await answerFromStatement(service, held.statementId);
        // Its text is there: the chronology is the next work, claimed under a number of its own.
        const [again] = await claimCaseStatements(service, 1, held.statementId);
        if (again) tally(outcomes, await processClaimedStatement(service, again).catch(() => "error"));
      }
      const asked = await askAccountQuestions(service, null);
      return { ...outcomes, asked };
    },
  },
  /**
   * The passengers' interviews (migration 0095): a case owed one is opened;
   * each open one goes a step (the next question where none waits, a
   * reminder of the one that waits, the database deciding when); and a
   * passenger outside the 24 hours is asked by the firm's template to go on.
   */
  {
    key: "case-interviews",
    when: { every: 5 },
    whileUsed: true,
    run: (service, until) => sweepInterviews(service, until),
  },
  /**
   * The filing packages (migration 0027): a package a person or ONE asked for
   * is built (ordered, named, cut under the limit of the court's system), and
   * signed at once where it owes its signature (0042).
   */
  {
    key: "filing-packages",
    when: { every: 5 },
    whileUsed: true,
    run: async (service, until) => {
      const outcomes: Record<string, number> = {};
      for (let turn = 0; turn < 2 && Date.now() < until; turn += 1) {
        const [held] = await claimFilingPackages(service, 1, null);
        if (!held) break;
        const outcome = await buildClaimedPackage(service, held).catch(() => "error");
        tally(outcomes, outcome);
        if (outcome === "ready") await signFilingPackages(service, 1, held.packageId).catch(() => undefined);
      }
      return outcomes;
    },
  },
  /**
   * The packages' signatures (migration 0042): a package of a system that
   * takes signed files is signed with the authorization of a lawyer of its
   * lawsuit, also one that waited for an authorization. Claimed and signed in
   * one go: a claim waiting for its turn would go stale and spend a try.
   */
  {
    key: "package-signatures",
    when: { every: 5 },
    whileUsed: true,
    run: async (service, until) => {
      const outcomes: Record<string, number> = {};
      for (let turn = 0; turn < 2 && Date.now() < until; turn += 1) {
        const [held] = await claimPackageSignatures(service, 1, null);
        if (!held) break;
        tally(outcomes, await signClaimedPackage(service, held).catch(() => "error"));
      }
      return outcomes;
    },
  },
  /**
   * The pieces (migration 0029): a draft is owed its first text, the
   * rewriting a lawyer asked for, the reading of what its text cites, or the
   * PDF of its approved text. A draft ONE may approve whose worker stopped
   * between the reading and the approval is approved first.
   */
  {
    key: "case-drafts",
    when: { every: 5 },
    whileUsed: true,
    run: async (service, until) => {
      const outcomes: Record<string, number> = {};
      const approved = await approveWaitingDrafts(service);
      if (approved > 0) outcomes.approved = approved;
      // A text takes a model a minute or two to write: two works a round at most.
      for (let turn = 0; turn < 2 && Date.now() < until; turn += 1) {
        const outcome = await draftNext(service, null);
        if (outcome === "none") break;
        tally(outcomes, outcome);
      }
      return outcomes;
    },
  },
  /**
   * ONE carries the cases on by itself where the firm lets it (migration
   * 0039): the cases something changed in (the database wakes them) and, now
   * and then, the ones that waited. What ONE asks for of a case (a first text,
   * a package) is done right after, each on its own.
   */
  {
    key: "case-advance",
    when: { every: 10 },
    whileUsed: true,
    run: async (service, until) => {
      const outcomes: Record<string, number> = {};
      for (let turn = 0; turn < 10 && Date.now() < until; turn += 1) {
        const round = await advanceOne(service, null, followSoon);
        if (round.outcome) tally(outcomes, round.outcome);
        if (round.parked > 0) outcomes.set_aside = (outcomes.set_aside ?? 0) + round.parked;
        // Nothing claimed and nothing set aside: nothing is due now. Cases only set aside may hide more behind them.
        if (!round.outcome && round.parked === 0) break;
      }
      return outcomes;
    },
  },
];
