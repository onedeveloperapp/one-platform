import "server-only";

import type { DecisionKind, WaitingDecision, WaitingDecisions } from "@/lib/ai/decisions";
import { DOCUMENT_CHECK_TASK } from "@/lib/cases/document-check";
import { DRAFT_TASK } from "@/lib/cases/drafts";
import { CHRONOLOGY_TASK, TRANSCRIPTION_TASK } from "@/lib/cases/statements";
import { CONVERSATION_TASK } from "@/lib/conversations/agent";
import type { SupabaseClient } from "@supabase/supabase-js";

/** How many of the person's decisions the center and the home name one by one; the rest are one line. */
export const DECISIONS_LISTED = 20;

type Embedded<T> = T | T[] | null;
const one = <T>(value: Embedded<T>): T | null => (Array.isArray(value) ? (value[0] ?? null) : value);

type Row = {
  id: string;
  task: string;
  approver_functions: string[] | null;
  created_at: string;
  ai_runs: Embedded<{ subject_type: string | null; subject_id: string | null }>;
};

type CaseSubject = {
  id: string;
  case_id: string;
  cases: Embedded<{ seq: number }>;
  case_parties?: Embedded<{ people: Embedded<{ full_name: string }> }>;
};

const KIND: Record<string, DecisionKind> = {
  [DRAFT_TASK]: "piece",
  [DOCUMENT_CHECK_TASK]: "document",
  [CHRONOLOGY_TASK]: "chronology",
  [TRANSCRIPTION_TASK]: "transcription",
  [CONVERSATION_TASK]: "conversation",
};

/**
 * The answers of the AI that wait for a person of the firm, each placed where it is decided (its case or its
 * conversation), for the center of what waits and the home (the owner, 2026-11-05). Read under the person's own
 * session: theirs are the ones whose task names their function. Null when it could not be read, and the screens fall
 * back to the count they had.
 */
export async function readWaitingDecisions(
  supabase: SupabaseClient,
  firmId: string,
  firmFunction: string,
): Promise<WaitingDecisions | null> {
  const [mine, others] = await Promise.all([
    supabase
      .from("approvals")
      .select("id, task, approver_functions, created_at, ai_runs(subject_type, subject_id)", { count: "exact" })
      .eq("org_id", firmId)
      .eq("status", "pending")
      .contains("approver_functions", [firmFunction])
      .order("created_at", { ascending: true })
      .limit(DECISIONS_LISTED),
    supabase
      .from("approvals")
      .select("id", { count: "exact", head: true })
      .eq("org_id", firmId)
      .eq("status", "pending")
      // The text of a piece is approved on its case only, never in the list of all of them.
      .neq("task", DRAFT_TASK)
      .not("approver_functions", "cs", `{${firmFunction}}`),
  ]);
  if (mine.error || others.error) return null;
  const rows = (mine.data ?? []) as Row[];

  const subjectsOf = (type: string) =>
    rows.flatMap((row) => {
      const run = one(row.ai_runs);
      return run?.subject_type === type && run.subject_id ? [run.subject_id] : [];
    });
  const documentIds = subjectsOf("case_document");
  const statementIds = subjectsOf("case_statement");
  const draftIds = subjectsOf("case_draft");
  const conversationIds = subjectsOf("wa_conversation");

  const none = Promise.resolve({ data: [] as unknown[], error: null });
  const [documents, statements, drafts, conversations] = await Promise.all([
    documentIds.length > 0
      ? supabase
          .from("case_documents")
          .select("id, case_id, cases(seq), case_parties(people(full_name))")
          .eq("org_id", firmId)
          .in("id", documentIds)
      : none,
    statementIds.length > 0
      ? supabase
          .from("case_statements")
          .select("id, case_id, cases(seq), case_parties(people(full_name))")
          .eq("org_id", firmId)
          .in("id", statementIds)
      : none,
    draftIds.length > 0
      ? supabase.from("case_drafts").select("id, case_id, cases(seq)").eq("org_id", firmId).in("id", draftIds)
      : none,
    conversationIds.length > 0
      ? supabase
          .from("wa_conversations")
          .select("id, saved_name, contact_name")
          .eq("org_id", firmId)
          .in("id", conversationIds)
      : none,
  ]);
  if (documents.error || statements.error || drafts.error || conversations.error) return null;

  const cases = new Map<string, { caseId: string; seq: number | null; client: string }>();
  for (const row of [...(documents.data ?? []), ...(statements.data ?? []), ...(drafts.data ?? [])] as CaseSubject[]) {
    cases.set(row.id, {
      caseId: row.case_id,
      seq: one(row.cases)?.seq ?? null,
      client: one(one(row.case_parties ?? null)?.people ?? null)?.full_name ?? "",
    });
  }
  const contacts = new Map(
    ((conversations.data ?? []) as { id: string; saved_name: string | null; contact_name: string | null }[]).map(
      (row) => [row.id, row.saved_name?.trim() || row.contact_name?.trim() || ""],
    ),
  );

  const decisions: WaitingDecision[] = rows.map((row) => {
    const run = one(row.ai_runs);
    const kind = KIND[row.task] ?? "other";
    const subject = run?.subject_id ? cases.get(run.subject_id) : undefined;
    const conversationId = run?.subject_type === "wa_conversation" ? (run.subject_id ?? null) : null;
    return {
      approvalId: row.id,
      kind,
      mine: true,
      caseId: subject?.caseId ?? null,
      caseSeq: subject?.seq ?? null,
      client: conversationId ? (contacts.get(conversationId) ?? "") : (subject?.client ?? ""),
      conversationId,
      since: row.created_at,
    };
  });
  return { mine: decisions, mineTotal: mine.count ?? decisions.length, others: others.count ?? 0 };
}
