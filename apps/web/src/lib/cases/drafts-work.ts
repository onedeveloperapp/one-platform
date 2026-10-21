import "server-only";

import { after } from "next/server";

import { runFirmTask } from "@/lib/ai/executor";
import {
  DRAFT_TASK,
  draftBlocks,
  draftBriefing,
  isPassingDraftFailure,
  readDraft,
  revisionBriefing,
} from "@/lib/cases/drafts";
import { supabaseFileStore } from "@/lib/files/store";
import { createServiceClient } from "@flyee/auth/service";
import { takeBackFile } from "@flyee/documents/files";
import { measureFile } from "@flyee/documents/measure";
import { renderTextPdf } from "@flyee/documents/text-pdf";
import { sendEvent } from "@flyee/jobs";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The backend's half of the piece of a lawsuit (migration 0029). A draft is
 * owed one work at a time: the AI writes its first text from the firm's
 * model and the facts of the case (`caso.peca.minuta`), or rewrites its
 * latest text as a lawyer asked when sending it back, the citations of its
 * latest text are read (and how alike it is to the firm's other pieces is
 * measured from its signature), or its approved text is made a PDF, which
 * becomes the petition of its case.
 *
 * Nothing here approves anything, decides whether a citation is verified,
 * or says what a model answered: the worker names the run, and the database
 * reads the run's own answer; the worker hands over what a text cites, and
 * the database is the one that holds the library and the gate. Every step
 * is a function of the database the service role alone may call; a draft
 * claimed and never recorded goes back to the line by itself. Only ids and
 * outcomes leave this file.
 */

type DraftToWork = {
  draft_id: string;
  org_id: string;
  case_id: string;
  claim: number;
  work: DraftWork;
  version: number;
  /** The text the work is on. For a rewriting: the latest text under numbered marks, which the database puts back. */
  body: string | null;
  template: string | null;
  facts: unknown;
  library: unknown;
  run_key: string | null;
  firm: string | null;
  title: string | null;
  requested_by: string | null;
  /** What the lawyer asked to change, under the same marks as the text. */
  note: string | null;
  /** The marks of that list that name the same person: [[mark, mark], ...]. */
  same: unknown;
};

/** A draft the sweep holds, with the number of the claim. */
export type DraftClaim = { draftId: string; claim: number };

/** The kinds of work a draft may be owed. */
export type DraftWork = "generate" | "revise" | "check" | "issue";

export async function claimCaseDrafts(
  service: SupabaseClient,
  limit = 1,
  draftId: string | null = null,
  works: readonly DraftWork[] | null = null,
): Promise<DraftClaim[]> {
  const { data, error } = await service.rpc("claim_case_drafts", {
    target_limit: limit,
    target_draft: draftId,
    target_works: works ? [...works] : null,
  });
  if (error) throw new Error(`claim_case_drafts failed: ${error.message}`);
  return ((data ?? []) as { draft_id: string; claim: number }[]).map((row) => ({
    draftId: row.draft_id,
    claim: Number(row.claim),
  }));
}

const OUTCOMES = [
  "generated",
  "revised",
  "rejected",
  "checked",
  "stale_version",
  "issued",
  "retry",
  "failed",
  "in_course",
] as const;
/**
 *   generated      the AI's text is the draft's first version: its citations are the next work;
 *   revised        the text the AI rewrote as a lawyer asked is the draft's next version: its citations
 *                  are the next work;
 *   rejected       the answer was turned down in the firm's queue before this word arrived;
 *   checked        the citations of the latest text were read;
 *   stale_version  a lawyer edited the text while it was being read: the reading is owed again;
 *   issued         the approved text is the petition of its case;
 *   retry          a passing failure: tried again after a wait;
 *   failed         final: a person puts the work back;
 *   in_course      the run of this very work is still running elsewhere: the claim was given back for a
 *                  short while, and this look at it spent no attempt;
 *   not_held       the claim is no longer this worker's.
 */
export type DraftOutcome = (typeof OUTCOMES)[number] | "not_held";

/** The name of the PDF of a piece: its title, with nothing a file name refuses. */
const fileName = (title: string | null): string =>
  `${
    (title ?? "Peça")
      .replace(/[\p{Cc}\\/:*?"<>|]/gu, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 150) || "Peça"
  }.pdf`;

/** Does the work a claimed draft is owed and records what came of it. Never throws for what a model or a file did. */
export async function workClaimedDraft(service: SupabaseClient, held: DraftClaim): Promise<DraftOutcome> {
  const { data, error } = await service.rpc("case_draft_to_work", {
    target_draft: held.draftId,
    target_claim: held.claim,
  });
  if (error) throw new Error(`case_draft_to_work failed: ${error.message}`);
  const row = ((data ?? []) as DraftToWork[])[0];
  if (!row) return "not_held";

  const record = async (
    outcome: "generated" | "revised" | "checked" | "issued" | "failed" | "in_course",
    input: { runId?: string | null; code?: string | null; payload?: Record<string, unknown> } = {},
  ): Promise<DraftOutcome> => {
    const said = outcome === "failed" && input.code && isPassingDraftFailure(input.code) ? "retry" : outcome;
    const { data: recorded, error: recordError } = await service.rpc("record_draft_work", {
      target_draft: row.draft_id,
      target_claim: row.claim,
      target_outcome: said,
      target_run: input.runId ?? null,
      target_code: input.code ?? null,
      target_payload: input.payload ?? {},
    });
    if (recordError) throw new Error(`record_draft_work failed: ${recordError.message}`);
    const answer = (recorded ?? {}) as { ok?: boolean; code?: string };
    if (answer.code === "not_working") return "not_held";
    // The database refused what was handed over (a file it would not keep, a run that is not this
    // draft's): said as a failure of this work, so the draft is not held until its claim runs out.
    if (answer.ok === false && outcome !== "failed" && outcome !== "in_course")
      return record("failed", { code: answer.code ?? "refused" });
    // What was recorded is what the database says: it is the one that knows what the draft is now.
    return OUTCOMES.find((code) => code === answer.code) ?? "failed";
  };

  if (row.work === "generate" || row.work === "revise") {
    // What the model is handed: the firm's model for a first text; for a rewriting, the text as it is and
    // what the lawyer asked to change in it. Hashed for the record, never kept as text by the run.
    let input: Record<string, unknown>;
    let briefing: string;
    if (row.work === "generate") {
      if (!row.template || !row.run_key) return record("failed", { code: "nothing_to_write" });
      input = { template: row.template, facts: row.facts, library: row.library };
      briefing = draftBriefing({ template: row.template, facts: row.facts, library: row.library });
    } else {
      if (!row.body || !row.note || !row.run_key) return record("failed", { code: "nothing_to_write" });
      input = { body: row.body, note: row.note, same: row.same ?? [], facts: row.facts, library: row.library };
      briefing = revisionBriefing({
        body: row.body,
        note: row.note,
        same: row.same,
        facts: row.facts,
        library: row.library,
      });
    }
    const result = await runFirmTask({
      orgId: row.org_id,
      task: DRAFT_TASK,
      input,
      messages: [{ role: "user", content: briefing }],
      subject: { type: "case_draft", id: row.draft_id },
      // The same for a work claimed again after its run succeeded, another once a run of it failed: the
      // database says which (`case_draft_to_work`), and each rewriting asked for has runs of its own.
      idempotencyKey: row.run_key,
      requestedBy: row.requested_by,
    });
    if (result.kind === "refused") return record("failed", { code: result.code });
    if (result.kind === "failed") return record("failed", { runId: result.runId, code: result.code });
    // Its run is still running elsewhere (the worker that started it was cut, or is slow): the claim is given
    // back for a short while, and the sweep of the runs closes a run nobody finishes.
    if (result.kind === "replayed" && result.status === "running") return record("in_course");
    if (result.kind === "replayed" && result.status !== "succeeded") return record("failed", { code: "run_failed" });
    return record(row.work === "generate" ? "generated" : "revised", { runId: result.runId });
  }

  if (row.work === "check") {
    if (!row.body) return record("failed", { code: "no_text" });
    const read = readDraft(row.body);
    const checked = await record("checked", {
      payload: { version: row.version, citations: read.citations, signature: read.signature },
    });
    // Where the firm lets ONE approve a piece (0016, `piece_text`), the first text the AI wrote is approved once
    // its citations were read and the gate lets it: the database decides, in a step of its own, and its PDF is
    // then owed as after a lawyer's approval. One it does not approve waits for a lawyer, as before.
    if (checked === "checked") await approveUnattended(service, row.draft_id);
    return checked;
  }

  // The approved text as a PDF of the firm's own: nothing of the platform is printed on it.
  if (!row.body) return record("failed", { code: "no_text" });
  let pdf: Uint8Array;
  try {
    pdf = await renderTextPdf({
      blocks: draftBlocks(row.body),
      title: row.title ?? undefined,
      author: row.firm ?? undefined,
      producer: row.firm ?? undefined,
      pageNumbers: true,
    });
  } catch {
    return record("failed", { code: "render_failed" });
  }
  const store = supabaseFileStore(service);
  const reserved = await store.reserve({
    orgId: row.org_id,
    purpose: "petition",
    name: fileName(row.title),
    mime: "application/pdf",
    bytes: pdf.byteLength,
  });
  if (!reserved.ok) return record("failed", { code: "file_refused" });
  let measure: Awaited<ReturnType<typeof measureFile>>;
  try {
    await store.put(reserved.storagePath, pdf, "application/pdf");
    measure = await measureFile(pdf);
  } catch {
    // The storage did not answer. Nothing names the file yet: it is taken back, and the work tried again.
    await takeBackFile(store, reserved.fileId, reserved.storagePath);
    return record("failed", { code: "store_unavailable" });
  }
  // The database keeps the file and makes it the petition in one step: a file is never kept with no
  // document pointing at it. From here on the file may be the petition even when the answer gets lost on
  // the way (this call then throws, and nothing is taken back): it is taken back only when the database
  // said the piece was not issued, record first, and the database refuses to forget a file a document names.
  const outcome = await record("issued", {
    payload: { file_id: reserved.fileId, sha256: measure.sha256, bytes: measure.bytes, pages: measure.pages ?? 1 },
  });
  if (outcome !== "issued") await takeBackFile(store, reserved.fileId, reserved.storagePath);
  // A petition may let ONE ask for the filing package of its lawsuit (0039): the jobs look at the case now.
  else await sendEvent("one/case.advance", { caseId: row.case_id }).catch(() => undefined);
  return outcome;
}

/**
 * ONE approves a draft where its firm lets it (`approve_case_draft_unattended`): the database says whether, and
 * a failure here leaves the draft as it is, for the sweep or a lawyer.
 */
async function approveUnattended(service: SupabaseClient, draftId: string): Promise<void> {
  try {
    await service.rpc("approve_case_draft_unattended", { target_draft: draftId });
  } catch {
    // The sweep tries again (`approve_case_drafts_unattended`).
  }
}

/**
 * The sweep's share: each draft ONE may approve and did not yet (its worker stopped between the reading and the
 * approval). Answers how many it approved.
 */
export async function approveWaitingDrafts(service: SupabaseClient): Promise<number> {
  const { data, error } = await service.rpc("approve_case_drafts_unattended", { target_limit: 20 });
  return error ? 0 : Number(data ?? 0);
}

/**
 * Claims the draft that waits the longest (or the one named) and does the
 * work it is owed: one piece of work, so a claim is never held while its
 * worker waits in a line for its turn. `none` when nothing is owed.
 */
export async function draftNext(
  service: SupabaseClient,
  draftId: string | null = null,
  works: readonly DraftWork[] | null = null,
): Promise<DraftOutcome | "none"> {
  const held = (await claimCaseDrafts(service, 1, draftId, works))[0];
  return held ? workClaimedDraft(service, held) : "none";
}

/**
 * What a person just did left a work owed. A work of a moment (reading what a text cites, making the
 * document of an approved text) is done before they are answered, so the screen they come back to already
 * shows it and no first text another firm waits for stands in its way. The first text and a rewriting,
 * which a model takes minutes to write, go to the jobs. Whatever is not done here stays owed: the sweep takes it.
 */
export async function settleDraftWork(draftId: string): Promise<void> {
  try {
    const service = createServiceClient();
    let outcome = await draftNext(service, draftId, ["check", "issue"]);
    // A text ONE approved once it was read has its document owed: made here too.
    if (outcome === "checked") {
      const next = await draftNext(service, draftId, ["issue"]);
      if (next !== "none") outcome = next;
    }
    if (outcome === "checked" || outcome === "issued") return;
  } catch {
    // Still owed.
  }
  await queueDraftWork(draftId);
}

/**
 * What a person just did may have left a reading owed (a rewriting turned down puts the text before it
 * back as a new version): done before they are answered when there is one, and nothing is asked of the
 * jobs when there is none. What is not done here stays owed: the sweep takes it.
 */
export async function settleDraftReading(draftId: string): Promise<void> {
  try {
    await draftNext(createServiceClient(), draftId, ["check"]);
  } catch {
    // Still owed.
  }
}

/**
 * A draft is owed a work: the jobs take it at once. Without them (a machine
 * with no Inngest), it is worked on after the response is sent: a first
 * text or a rewriting, then the reading of its citations, and the document
 * of a text ONE approved.
 */
export async function queueDraftWork(draftId: string): Promise<void> {
  const sent = await sendEvent("one/case.draft.requested", { draftId });
  if (sent.sent) return;
  after(async () => {
    try {
      const service = createServiceClient();
      // The work owed, then what follows it: the reading of a text the AI wrote, and the document of a text ONE
      // approved after reading it.
      for (let turn = 0; turn < 3; turn += 1) {
        const outcome = await draftNext(service, draftId);
        if (outcome !== "generated" && outcome !== "revised" && outcome !== "checked") break;
      }
    } catch {
      // Still owed: the sweep takes it.
    }
  });
}
