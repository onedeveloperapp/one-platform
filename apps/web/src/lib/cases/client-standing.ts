import { accountAsksClient } from "@/lib/cases/account";
import { documentNeeds, missingItems } from "@/lib/cases/cases";
import { documentsStanding } from "@/lib/cases/client-documents";
import type { ClientLinkView, ClientTasks } from "@/lib/cases/client-link";

/**
 * Where a client's case stands on their link, and what the link asks of them, in one rule (the owner, 2026-11-13,
 * who approved the proposal for the client's page: it followed no order and said "O que ainda falta" for four things
 * while it asked nine). The head's count, the order of the steps, each step's count and the list of what is done all
 * come from here, from what the page already reads, so the count never says less than the page asks.
 *
 * The steps are what the client does now, in the order of the case: sign (once there is a paper), send the
 * documents, complete the data, tell what happened and answer what the firm asks (ONE marks when they finished, 0240). What the
 * client answered or the firm has is done, one line each. The path of the case has five points: the papers, the
 * signature, the action, the court and the result.
 */

export const CLIENT_PATH = ["papers", "signature", "action", "court", "result"] as const;
export type ClientPathStage = (typeof CLIENT_PATH)[number];

export const CLIENT_STEPS = ["sign", "documents", "data", "account", "answers"] as const;
export type ClientStepKey = (typeof CLIENT_STEPS)[number];

/** What a client answers, in the order "Suas respostas" lists it. */
export const CLIENT_ANSWERS = [
  "terms",
  "civilCourt",
  "freeJustice",
  "residence",
  "priorComplaint",
  "pieceFacts",
  "judgments",
] as const;
export type ClientAnswerKey = (typeof CLIENT_ANSWERS)[number];

/** What is done, in the order "Já feito" lists it. */
export const CLIENT_DONE = [
  "sign",
  "pieceFacts",
  "documents",
  "data",
  "trip",
  "account",
  "terms",
  "civilCourt",
  "freeJustice",
  "residence",
  "priorComplaint",
  "finish",
] as const;
export type ClientDoneKey = (typeof CLIENT_DONE)[number];

export type ClientStep = {
  key: ClientStepKey;
  /** How many things of the step the client owes: what its chip says. */
  count: number;
  /** For "answers": which answers it holds, in their order. */
  answers?: ClientAnswerKey[];
  /** For "data": the trip's legs are owed too (no leg yet). */
  trip?: boolean;
};

export type ClientStanding = {
  stage: ClientPathStage;
  /** Whose turn the case is: the client's while a step is owed; then the firm's, the court's, or nobody's. */
  turn: "client" | "firm" | "court" | "closed";
  steps: ClientStep[];
  done: ClientDoneKey[];
  /** Since when it is the firm's turn (the client finished) or the court's (the first lawsuit filed). */
  since: string | null;
};

type OpenView = Extract<ClientLinkView, { state: "open" }>;

/** Each answer the link asks, and whether the client gave it: how many are owed, and whether any was given. */
function answersOf(tasks: ClientTasks): Record<ClientAnswerKey, { owed: number; given: number }> {
  const civil = (tasks.civilCourt ?? []).filter((item) => item.wording !== null || item.accepted !== null);
  const justice = tasks.freeJustice?.items ?? [];
  const prior = tasks.priorComplaint;
  const judgments = tasks.judgments.filter((item) => item.result && (item.decision === null || item.agrees !== null));
  return {
    terms: {
      owed: tasks.terms.filter((term) => !term.accepted_at).length,
      given: tasks.terms.filter((term) => term.accepted_at).length,
    },
    civilCourt: {
      owed: civil.filter((item) => item.wording && item.accepted === null).length,
      given: civil.filter((item) => item.accepted !== null).length,
    },
    freeJustice: {
      owed: justice.filter((item) => item.asks === null).length,
      given: justice.filter((item) => item.asks !== null).length,
    },
    // A declaration a document of the link settled owes no answer (0294).
    residence: {
      owed: tasks.residence.filter((item) => !item.answered_at && !item.linked).length,
      given: tasks.residence.filter((item) => item.answered_at || item.linked).length,
    },
    priorComplaint: {
      owed: prior?.state === "owed" ? 1 : 0,
      given: prior?.state === "waiting" || prior?.state === "done" ? 1 : 0,
    },
    pieceFacts: {
      owed: tasks.pieceFacts.filter((item) => item.status === "asked").length,
      given: tasks.pieceFacts.filter((item) => item.status !== "asked").length,
    },
    judgments: {
      owed: judgments.filter((item) => item.agrees === null).length,
      given: judgments.filter((item) => item.agrees !== null).length,
    },
  };
}

export function clientStanding(view: OpenView, tasks: ClientTasks, today: string): ClientStanding {
  const editable = view.case.editable;
  const finishedAt = view.link.finished_at;
  const holder = view.people.find((person) => person.is_holder) ?? view.people[0] ?? null;
  const claimants = view.people.filter((person) => person.roles.includes("claimant"));

  // Signing: a paper sent and not signed yet.
  const signsOwed = tasks.signatures.filter((item) => item.status === "pending" && !item.signed_at).length;
  const signsGiven = tasks.signatures.length - signsOwed;

  // The documents the firm needs, as the documents' own card counts them, and the ones asked once ("se tiver").
  const needs = holder
    ? documentNeeds({ holder, holderPartyIds: holder.party_ids, claimants, required: view.required_documents })
    : [];
  const documents = documentsStanding(needs, view.documents);
  const asked = (view.dispensables ?? []).filter((item) => item.state === "asked").length;
  const documentsOwed = editable ? documents.owed + asked : 0;

  // The data of each person and the trip's legs.
  const missing = holder
    ? missingItems({
        holder,
        holderPartyIds: holder.party_ids,
        claimants,
        documents: view.documents,
        segments: view.segments.length,
        required: view.required_documents,
        today,
        // A case of an area of the firm has no trip (0274).
        trip: !view.case.area,
        // Where the case's court asks each claimant's e-mail and mobile, they are data the link asks (0283).
        contact: view.case.asks_contact === true,
      })
    : [];
  const fieldsOwed = editable ? missing.filter((item) => item.type === "fields").length : 0;
  const tripOwed = editable && missing.some((item) => item.type === "flight");

  // What happened: the interview, or the account and the order of its facts to confirm.
  const interviewOpen = tasks.interview?.status === "open";
  const accountAsk = editable ? accountAsksClient(tasks.account) : null;
  const orderToConfirm = tasks.statements.filter((item) => item.chronology_status === "approved").length;
  const accountOwed = (interviewOpen ? 1 : accountAsk ? 1 : 0) + orderToConfirm;
  const accountGiven =
    tasks.statements.length > 0 || tasks.interview?.status === "done" || tasks.interview?.status === "closed";

  const answers = answersOf(tasks);
  const answersOwed = CLIENT_ANSWERS.filter((key) => answers[key].owed > 0);

  const steps: ClientStep[] = [];
  if (signsOwed > 0) steps.push({ key: "sign", count: signsOwed });
  if (documentsOwed > 0) steps.push({ key: "documents", count: documentsOwed });
  if (fieldsOwed > 0 || tripOwed) steps.push({ key: "data", count: fieldsOwed + (tripOwed ? 1 : 0), trip: tripOwed });
  if (accountOwed > 0) steps.push({ key: "account", count: accountOwed });
  if (answersOwed.length > 0) {
    steps.push({
      key: "answers",
      count: answersOwed.reduce((sum, key) => sum + answers[key].owed, 0),
      answers: answersOwed,
    });
  }
  // The client never says they finished (the owner, 2026-11-13): ONE marks it at its look of the case (0240).

  const done: ClientDoneKey[] = [];
  const owes = (key: ClientStepKey) => steps.some((step) => step.key === key);
  if (signsGiven > 0 && !owes("sign")) done.push("sign");
  if (answers.pieceFacts.given > 0 && answers.pieceFacts.owed === 0) done.push("pieceFacts");
  if (view.documents.length > 0 && !owes("documents")) done.push("documents");
  if (view.people.length > 0 && !owes("data")) done.push("data");
  if (view.segments.length > 0 && !tripOwed) done.push("trip");
  if (accountGiven && !owes("account")) done.push("account");
  for (const key of ["terms", "civilCourt", "freeJustice", "residence", "priorComplaint"] as const) {
    if (answers[key].given > 0 && answers[key].owed === 0) done.push(key);
  }
  if (finishedAt) done.push("finish");

  const filed = tasks.course.map((lawsuit) => lawsuit.filed_at).filter((day): day is string => Boolean(day));
  const stage: ClientPathStage =
    tasks.course.length > 0
      ? tasks.course.every((lawsuit) => lawsuit.status === "closed")
        ? "result"
        : "court"
      : signsOwed > 0 && (finishedAt || !editable)
        ? "signature"
        : editable && !finishedAt
          ? "papers"
          : tasks.signatures.length === 0 && finishedAt
            ? "signature"
            : "action";
  const turn: ClientStanding["turn"] =
    steps.length > 0 ? "client" : stage === "result" ? "closed" : stage === "court" ? "court" : "firm";
  const since = turn === "court" ? ([...filed].sort()[0] ?? null) : turn === "firm" ? (finishedAt ?? null) : null;
  return { stage, turn, steps, done, since };
}
