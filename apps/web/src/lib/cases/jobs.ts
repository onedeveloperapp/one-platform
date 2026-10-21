import "server-only";

import { advanceOne, followByJobs } from "@/lib/cases/advance-work";
import { claimCaseDocuments, processClaimedDocument } from "@/lib/cases/documents-work";
import { approveWaitingDrafts, draftNext } from "@/lib/cases/drafts-work";
import { buildClaimedPackage, claimFilingPackages } from "@/lib/cases/filing-work";
import { claimPackageSignatures, signClaimedPackage } from "@/lib/cases/package-signature-work";
import { claimCaseStatements, processClaimedStatement } from "@/lib/cases/statements-work";
import { createServiceClient } from "@flyee/auth/service";
import { inngest, sendEvent } from "@flyee/jobs";

/**
 * The documents' sweep (migration 0024), recomputed from the data on every
 * pass: what reached a case is claimed, normalized and checked by the AI, one
 * document per step so a slow model never holds the others. A document that
 * just arrived starts it at once (`one/case.document.received`); the cron
 * catches what that request did not finish, a document claimed by a run that
 * died goes back to the line by itself, and a passing failure is tried again.
 *
 * The steps carry document ids and outcomes only: Inngest keeps what a step
 * returns, and nothing of a client belongs there.
 */
export const caseDocumentsFunction = inngest.createFunction(
  { id: "one-case-documents", retries: 1, concurrency: { limit: 2 } },
  [{ cron: "*/5 * * * *" }, { event: "one/case.document.received" }],
  async ({ event, step }) => {
    const target =
      event.name === "one/case.document.received" && typeof event.data?.documentId === "string"
        ? event.data.documentId
        : null;
    const claimed = await step.run("claim", () => claimCaseDocuments(createServiceClient(), target ? 1 : 10, target));
    const outcomes: Record<string, number> = {};
    for (const documentId of claimed) {
      const processed = await step.run(`process-${documentId}`, async () => {
        const { outcome } = await processClaimedDocument(createServiceClient(), documentId);
        return outcome;
      });
      outcomes[processed] = (outcomes[processed] ?? 0) + 1;
    }
    return { claimed: claimed.length, ...outcomes };
  },
);

/**
 * The sweep of the clients' accounts (migration 0026), recomputed from the
 * data on every pass: an audio is transcribed, and of the text a chronology
 * is proposed to the firm's queue. A statement that just arrived starts it
 * at once (`one/case.statement.received`); one just transcribed is claimed
 * again in the same run for its chronology. The cron catches what a request
 * did not finish, receives the audio a client's page never came back for,
 * and takes as waiting the run whose worker died before saying so.
 *
 * The steps carry statement ids and outcomes only: what a client told is
 * read inside the work on it, never kept in a job's recorded state.
 */
/** How many statements one run of the sweep works on: the next run, five minutes later, takes the rest. */
const STATEMENTS_PER_RUN = 10;

export const caseStatementsFunction = inngest.createFunction(
  { id: "one-case-statements", retries: 1, concurrency: { limit: 2 } },
  [{ cron: "*/5 * * * *" }, { event: "one/case.statement.received" }],
  async ({ event, step }) => {
    const target =
      event.name === "one/case.statement.received" && typeof event.data?.statementId === "string"
        ? event.data.statementId
        : null;
    const outcomes: Record<string, number> = {};
    let worked = 0;
    // One statement is claimed right before it is worked on, never a batch at once: a step may take
    // minutes (a model hearing an audio), and a claim made long before its turn would be over by then.
    for (let turn = 0; turn < (target ? 1 : STATEMENTS_PER_RUN); turn += 1) {
      const claimed = await step.run(`claim-${turn}`, () => claimCaseStatements(createServiceClient(), 1, target));
      const held = claimed[0];
      if (!held) break;
      worked += 1;
      // The step is named by the statement and the number of its claim, and carries both: run again, it
      // works under the same claim, and a claim another run took since then reads nothing.
      const first = await step.run(`process-${held.statementId}-${held.claim}`, () =>
        processClaimedStatement(createServiceClient(), held),
      );
      outcomes[first] = (outcomes[first] ?? 0) + 1;
      if (first !== "transcribed") continue;
      // Its text is there: the chronology is the next work, claimed under a number of its own.
      const again = await step.run(`claim-chronology-${held.statementId}`, () =>
        claimCaseStatements(createServiceClient(), 1, held.statementId),
      );
      if (again.length === 0) continue;
      const second = await step.run(`process-${again[0].statementId}-${again[0].claim}`, () =>
        processClaimedStatement(createServiceClient(), again[0]),
      );
      outcomes[second] = (outcomes[second] ?? 0) + 1;
    }
    return { claimed: worked, ...outcomes };
  },
);

/** How many packages one run of the sweep builds: the next run takes the rest. */
const PACKAGES_PER_RUN = 5;

/**
 * The sweep of the filing packages (migration 0027), recomputed from the
 * data on every pass: a package a person asked for is built (ordered, named,
 * cut under the limit of the court's system). One just asked for starts it
 * at once (`one/case.filing.requested`); the cron catches what that request
 * did not finish and forgets the parts a run cut and never recorded. Each
 * package is claimed right before it is built, and the step is named by the
 * package and the number of its claim.
 *
 * The steps carry package ids and outcomes only.
 */
export const filingPackagesFunction = inngest.createFunction(
  { id: "one-filing-packages", retries: 1, concurrency: { limit: 2 } },
  [{ cron: "*/5 * * * *" }, { event: "one/case.filing.requested" }],
  async ({ event, step }) => {
    const target =
      event.name === "one/case.filing.requested" && typeof event.data?.packageId === "string"
        ? event.data.packageId
        : null;
    const outcomes: Record<string, number> = {};
    let built = 0;
    for (let turn = 0; turn < (target ? 1 : PACKAGES_PER_RUN); turn += 1) {
      const claimed = await step.run(`claim-${turn}`, () => claimFilingPackages(createServiceClient(), 1, target));
      const held = claimed[0];
      if (!held) break;
      built += 1;
      const outcome = await step.run(`build-${held.packageId}-${held.claim}`, () =>
        buildClaimedPackage(createServiceClient(), held),
      );
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      // A package built may owe its signature (0042): signed now rather than at the next sweep.
      if (outcome === "ready") {
        await step.run(`signature-${held.packageId}`, () =>
          sendEvent("one/case.filing.signature", { packageId: held.packageId }),
        );
      }
    }
    return { claimed: built, ...outcomes };
  },
);

/** How many packages one run of the signatures' sweep signs: the next run takes the rest. */
const SIGNATURES_PER_RUN = 3;

/**
 * The sweep of the packages' signatures (migration 0042), recomputed from
 * the data on every pass: a package built of a system that takes signed
 * files, of a firm that lets ONE sign, is signed with the authorization of a
 * lawyer of its lawsuit; one that waited for an authorization is signed once
 * a lawyer has one. A package just built, a lawyer's request and a new
 * authorization start it at once (`one/case.filing.signature`). A package is
 * claimed and signed in the same step: a claim taken in one step and signed
 * in another would go stale while it waits for its turn, and spend a try.
 *
 * The steps carry outcomes only.
 */
export const packageSignaturesFunction = inngest.createFunction(
  { id: "one-package-signatures", retries: 1, concurrency: { limit: 1 } },
  [{ cron: "*/5 * * * *" }, { event: "one/case.filing.signature" }],
  async ({ event, step }) => {
    const target =
      event.name === "one/case.filing.signature" && typeof event.data?.packageId === "string"
        ? event.data.packageId
        : null;
    const outcomes: Record<string, number> = {};
    let signed = 0;
    for (let turn = 0; turn < (target ? 1 : SIGNATURES_PER_RUN); turn += 1) {
      const outcome = await step.run(`sign-${turn}`, async () => {
        const service = createServiceClient();
        const [held] = await claimPackageSignatures(service, 1, target);
        return held ? await signClaimedPackage(service, held) : "none";
      });
      if (outcome === "none") break;
      signed += 1;
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
    }
    return { claimed: signed, ...outcomes };
  },
);

/** How many works on drafts one run of the sweep does: the next run takes the rest. */
const DRAFTS_PER_RUN = 6;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * The sweep of the pieces (migration 0029), recomputed from the data on
 * every pass: a draft is owed its first text (the AI writes it from the
 * firm's model and the facts of the case), the rewriting of its text as a
 * lawyer asked when sending it back, the reading of what its latest text
 * cites, or the PDF of its approved text, which becomes the petition of its
 * case. One just asked for, sent back or edited starts it at once
 * (`one/case.draft.requested`), and a text the AI wrote is followed by the
 * reading of its citations in the same run; the cron catches what a request
 * did not finish. A draft is claimed and worked on in the same step: a text
 * takes minutes to write, and a claim taken in one step and worked on in
 * another would go stale while it waits for its turn.
 *
 * The steps carry outcomes only: a model of the firm, the facts of a case
 * or the text of a piece are read inside the work, never kept in a job's
 * recorded state.
 */
export const caseDraftsFunction = inngest.createFunction(
  { id: "one-case-drafts", retries: 1, concurrency: { limit: 2 } },
  [{ cron: "*/5 * * * *" }, { event: "one/case.draft.requested" }],
  async ({ event, step }) => {
    const asked = event.name === "one/case.draft.requested" ? event.data?.draftId : null;
    const target = typeof asked === "string" && UUID.test(asked) ? asked : null;
    const outcomes: Record<string, number> = {};
    // A draft ONE may approve whose worker stopped between the reading and the approval is approved first: its
    // document is then owed, and taken below.
    if (!target) {
      const approved = await step.run("approve", () => approveWaitingDrafts(createServiceClient()));
      if (approved > 0) outcomes.approved = approved;
    }
    // One draft named: its work, the reading that follows a text the AI wrote, and the document of a text ONE
    // approved then. Otherwise what waits, in turn.
    for (let turn = 0; turn < (target ? 3 : DRAFTS_PER_RUN); turn += 1) {
      const outcome = await step.run(`draft-${turn}`, () => draftNext(createServiceClient(), target));
      if (outcome === "none") break;
      outcomes[outcome] = (outcomes[outcome] ?? 0) + 1;
      if (target && outcome !== "generated" && outcome !== "revised" && outcome !== "checked") break;
    }
    return outcomes;
  },
);

/** How many cases one run of ONE's carrying on looks at: the next run takes the rest. */
const ADVANCES_PER_RUN = 20;

/**
 * ONE carries the cases on by itself where the firm lets it (migration
 * 0039), recomputed from the data on every pass: a case that has what its
 * lawsuits need has them created, a lawsuit nobody asked a piece for has its
 * first text asked of the AI, and a lawsuit whose piece became its petition
 * has its filing package asked for. A case named in the event (a person's
 * change, a piece just issued) is looked at at once; the cron takes the
 * cases something changed in (the database wakes them) and, now and then,
 * the ones that waited. Each case is claimed and carried on in the same
 * step.
 *
 * The steps carry case ids and outcomes only.
 */
export const caseAdvanceFunction = inngest.createFunction(
  { id: "one-case-advance", retries: 1, concurrency: { limit: 1 } },
  [{ cron: "*/10 * * * *" }, { event: "one/case.advance" }],
  async ({ event, step }) => {
    const named = event.name === "one/case.advance" ? event.data?.caseId : null;
    const target = typeof named === "string" && UUID.test(named) ? named : null;
    const outcomes: Record<string, number> = {};
    for (let turn = 0; turn < (target ? 1 : ADVANCES_PER_RUN); turn += 1) {
      const round = await step.run(`advance-${turn}`, () => advanceOne(createServiceClient(), target, followByJobs));
      if (round.outcome) outcomes[round.outcome] = (outcomes[round.outcome] ?? 0) + 1;
      if (round.parked > 0) outcomes.set_aside = (outcomes.set_aside ?? 0) + round.parked;
      // Nothing claimed and nothing set aside: nothing is due now. Cases only set aside may hide more behind them.
      if (!round.outcome && round.parked === 0) break;
    }
    return outcomes;
  },
);

export const caseFunctions = [
  caseDocumentsFunction,
  caseStatementsFunction,
  filingPackagesFunction,
  packageSignaturesFunction,
  caseDraftsFunction,
  caseAdvanceFunction,
];
