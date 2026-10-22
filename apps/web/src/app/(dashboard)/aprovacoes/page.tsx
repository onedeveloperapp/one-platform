import ApprovalsView from "./components/approvals-view";
import { cookies } from "next/headers";

import {
  type ApprovalConversation,
  type ApprovalDocument,
  type ApprovalDraft,
  type ApprovalsState,
  type ApprovalStatement,
  DECIDED_SHOWN,
  type DecidedApproval,
  momentLabel,
  PENDING_PAGE,
  type PendingApproval,
  type SecondFactorState,
} from "@/lib/ai/approvals";
import { DOCUMENT_CHECK_TASK } from "@/lib/cases/document-check";
import { readQuality } from "@/lib/cases/document-quality";
import { DRAFT_TASK } from "@/lib/cases/drafts";
import { CHRONOLOGY_TASK, TRANSCRIPTION_TASK } from "@/lib/cases/statements";
import { CONVERSATION_TASK } from "@/lib/conversations/agent";
import { type FirmFunction, isFirmFunction } from "@/lib/firm/roles";
import { getMemberContext } from "@/lib/member/context";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";
import { isWindowOpen } from "@flyee/whatsapp/rules";

type Embedded<T> = T | T[] | null;

type PendingRow = {
  id: string;
  run_id: string;
  task: string;
  approver_functions: string[] | null;
  created_at: string;
  ai_runs: Embedded<{ output: unknown; subject_type: string | null; subject_id: string | null }>;
  ai_tasks: Embedded<{ name: string; description: string | null; revisable: boolean | null }>;
};

type SubjectRow = {
  id: string;
  case_id: string;
  kind: string;
  file_id: string;
  quality: unknown;
  cases: Embedded<{ seq: number }>;
  case_parties: Embedded<{ people: Embedded<{ full_name: string }> }>;
};

type DraftRow = {
  id: string;
  case_id: string;
  template_name: string;
  version: number;
  cases: Embedded<{ seq: number }>;
  proceedings: Embedded<{ kind: string }>;
};

type StatementRow = {
  id: string;
  case_id: string;
  transcript: string | null;
  audio_file_id: string | null;
  client_note: string | null;
  chronology: string | null;
  returned_note: string | null;
  returned_run_id: string | null;
  returns: number | null;
  cases: Embedded<{ seq: number }>;
  case_parties: Embedded<{ people: Embedded<{ full_name: string }> }>;
};

/** The version of a draft a run of the AI wrote, and what it was asked to change when it rewrote one. */
type AnswerVersionRow = {
  run_id: string | null;
  version: number;
  note: string | null;
  asked_by: string | null;
  notes: string[] | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** How many times the proposals of one statement are sent back, when the setting does not say. */
const MAX_RETURNS = 5;

type ConversationRow = {
  id: string;
  number_id: string;
  contact_wa_id: string;
  contact_name: string | null;
  saved_name: string | null;
  last_inbound_at: string | null;
};

type ConversationMessageRow = {
  id: string;
  conversation_id: string;
  direction: string;
  body: string | null;
  by_one: boolean;
  created_at: string;
};

/** How many of a conversation's last messages an answer of ONE is read beside. */
const CONVERSATION_MESSAGES = 6;

type DecidedRow = {
  id: string;
  task: string;
  status: string;
  edited: boolean;
  decided_auto: boolean | null;
  decided_by: string | null;
  decided_at: string;
  decision_note: string | null;
  ai_tasks: Embedded<{ name: string }>;
};

type TeamRow = { user_id: string; display_name: string | null; email: string | null };

const one = <T,>(value: Embedded<T>): T | null => (Array.isArray(value) ? (value[0] ?? null) : value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * /aprovacoes: what the AI suggested and waits for a person of the firm.
 * Everything is read under the person's own session: row-level security shows
 * the queue of their firm only, and the decision itself is the database's
 * (`decide_approval`, migration 0016), which asks for the function the task
 * names and for the second factor.
 */
async function loadApprovals(): Promise<ApprovalsState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };

  const firm = context.firm;
  const { supabase } = context;
  // The hours are written here, on the person's own clock, and handed over as
  // text: the browser never formats a date the server formatted differently.
  const timeZone = context.profile.timezone;

  const [pending, decided, team, assurance, cookieStore] = await Promise.all([
    supabase
      .from("approvals")
      .select(
        "id, run_id, task, approver_functions, created_at, ai_runs(output, subject_type, subject_id), ai_tasks(name, description, revisable)",
        {
          count: "exact",
        },
      )
      .eq("org_id", firm.id)
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(PENDING_PAGE),
    supabase
      .from("approvals")
      .select("id, task, status, edited, decided_auto, decided_by, decided_at, decision_note, ai_tasks(name)")
      .eq("org_id", firm.id)
      .in("status", ["approved", "rejected", "returned"])
      .order("decided_at", { ascending: false })
      .limit(DECIDED_SHOWN),
    supabase.rpc("firm_team", { target_org: firm.id }),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    cookies(),
  ]);
  if (pending.error || decided.error || team.error) return { kind: "error" };

  const names = new Map(
    ((team.data ?? []) as TeamRow[]).map((row) => [
      row.user_id,
      row.display_name?.trim() || row.email?.split("@")[0] || "",
    ]),
  );

  // The documents the checks in the queue are about: named and opened from the card.
  const pendingRows = (pending.data ?? []) as PendingRow[];
  const documentOf = (row: PendingRow): string | null => {
    const run = one(row.ai_runs);
    return row.task === DOCUMENT_CHECK_TASK && run?.subject_type === "case_document" && UUID.test(run.subject_id ?? "")
      ? (run.subject_id as string)
      : null;
  };
  const documentIds = pendingRows.map(documentOf).filter((id): id is string => id !== null);
  const subjects = new Map<string, ApprovalDocument>();
  if (documentIds.length > 0) {
    const { data: rows } = await supabase
      .from("case_documents")
      .select("id, case_id, kind, file_id, quality, cases(seq), case_parties(people(full_name))")
      .eq("org_id", firm.id)
      .in("id", documentIds);
    for (const row of (rows ?? []) as SubjectRow[]) {
      subjects.set(row.id, {
        id: row.id,
        caseId: row.case_id,
        caseSeq: one(row.cases)?.seq ?? null,
        kind: row.kind,
        personName: one(one(row.case_parties)?.people ?? null)?.full_name ?? null,
        fileId: row.file_id,
        quality: readQuality(row.quality),
      });
    }
  }

  // The accounts the transcriptions and the chronologies in the queue are about: read beside the answer.
  const statementOf = (row: PendingRow): string | null => {
    const run = one(row.ai_runs);
    return (row.task === CHRONOLOGY_TASK || row.task === TRANSCRIPTION_TASK) &&
      run?.subject_type === "case_statement" &&
      UUID.test(run.subject_id ?? "")
      ? (run.subject_id as string)
      : null;
  };
  const statementIds = pendingRows.map(statementOf).filter((id): id is string => id !== null);
  const accounts = new Map<string, ApprovalStatement>();
  if (statementIds.length > 0) {
    const [{ data: rows }, { data: limits }] = await Promise.all([
      supabase
        .from("case_statements")
        .select(
          "id, case_id, transcript, audio_file_id, client_note, chronology, returned_note, returned_run_id, returns, cases(seq), case_parties(people(full_name))",
        )
        .eq("org_id", firm.id)
        .in("id", statementIds),
      supabase.from("platform_settings").select("value").eq("key", "statements").maybeSingle(),
    ]);
    // How many times the proposals of one statement are sent back: the database's own ceiling, read here so
    // that a card whose statement reached it says so before anybody writes a request.
    // A setting that is no number is no setting, as the database reads it: never a zero.
    const allowed = (limits?.value as Record<string, unknown> | null | undefined)?.max_returns;
    const mostReturns = typeof allowed === "number" && Number.isFinite(allowed) && allowed >= 0 ? allowed : MAX_RETURNS;
    // The proposals the firm sent back: what the ones that wait now answer, read beside them.
    const returnedRuns = ((rows ?? []) as StatementRow[]).flatMap((row) =>
      row.returned_note && row.returned_run_id ? [row.returned_run_id] : [],
    );
    const proposals = new Map<string, string>();
    if (returnedRuns.length > 0) {
      const { data: runs } = await supabase
        .from("ai_runs")
        .select("id, proposal:output->>cronologia")
        .eq("org_id", firm.id)
        .in("id", returnedRuns);
      for (const run of (runs ?? []) as { id: string; proposal: string | null }[]) {
        if (typeof run.proposal === "string") proposals.set(run.id, run.proposal);
      }
    }
    for (const row of (rows ?? []) as StatementRow[]) {
      accounts.set(row.id, {
        id: row.id,
        caseId: row.case_id,
        caseSeq: one(row.cases)?.seq ?? null,
        personName: one(one(row.case_parties)?.people ?? null)?.full_name ?? null,
        text: row.transcript,
        audioFileId: row.audio_file_id,
        clientNote: row.client_note,
        previousChronology: row.client_note ? row.chronology : null,
        firmNote: row.returned_note,
        returnedProposal:
          row.returned_note && row.returned_run_id ? (proposals.get(row.returned_run_id) ?? null) : null,
        returnsLeft: Math.max(0, mostReturns - Number(row.returns ?? 0)),
      });
    }
  }

  // The drafts the first texts in the queue are of: the card leads to the case each is written on.
  const draftOf = (row: PendingRow): string | null => {
    const run = one(row.ai_runs);
    return row.task === DRAFT_TASK && run?.subject_type === "case_draft" && UUID.test(run.subject_id ?? "")
      ? (run.subject_id as string)
      : null;
  };
  const draftIds = pendingRows.map(draftOf).filter((id): id is string => id !== null);
  const pieces = new Map<string, Omit<ApprovalDraft, "answerVersion" | "request" | "notes">>();
  // The version each answer is on its draft, and what the AI was asked to change when it rewrote one.
  const answers = new Map<string, AnswerVersionRow>();
  if (draftIds.length > 0) {
    const [drafts, versions] = await Promise.all([
      supabase
        .from("case_drafts")
        .select("id, case_id, template_name, version, cases(seq), proceedings(kind)")
        .eq("org_id", firm.id)
        .in("id", draftIds),
      supabase
        .from("case_draft_versions")
        .select("run_id, version, note, asked_by, notes")
        .eq("org_id", firm.id)
        .in(
          "run_id",
          pendingRows.filter((row) => draftOf(row) !== null).map((row) => row.run_id),
        ),
    ]);
    // A text of the AI read without its draft would fall back to the general card, whose approval of a piece
    // the queue refuses: the queue is an error instead, asked again.
    if (drafts.error || versions.error) return { kind: "error" };
    for (const row of (drafts.data ?? []) as DraftRow[]) {
      pieces.set(row.id, {
        id: row.id,
        caseId: row.case_id,
        caseSeq: one(row.cases)?.seq ?? null,
        templateName: row.template_name,
        // As the draft has it: none yet while a first text waits for its worker's word.
        version: Number(row.version) || 0,
        proceedingKind: one(row.proceedings)?.kind ?? null,
      });
    }
    for (const row of (versions.data ?? []) as AnswerVersionRow[]) {
      if (row.run_id) answers.set(row.run_id, row);
    }
  }

  // The conversations the answers of ONE to a passenger are of: the last words each answer answers, and whether
  // it can still go (0048).
  const conversationOf = (row: PendingRow): string | null => {
    const run = one(row.ai_runs);
    return row.task === CONVERSATION_TASK && run?.subject_type === "wa_conversation" && UUID.test(run.subject_id ?? "")
      ? (run.subject_id as string)
      : null;
  };
  const conversationIds = [...new Set(pendingRows.map(conversationOf).filter((id): id is string => id !== null))];
  const talks = new Map<string, ApprovalConversation>();
  if (conversationIds.length > 0) {
    const reference = new Date();
    const [rows, said, numbers, stops, windowEnd] = await Promise.all([
      supabase
        .from("wa_conversations")
        .select("id, number_id, contact_wa_id, contact_name, saved_name, last_inbound_at")
        .eq("org_id", firm.id)
        .in("id", conversationIds),
      supabase
        .from("wa_messages")
        .select("id, conversation_id, direction, body, by_one, created_at")
        .eq("org_id", firm.id)
        .in("conversation_id", conversationIds)
        .order("created_at", { ascending: false })
        .limit(CONVERSATION_MESSAGES * conversationIds.length * 4),
      supabase.from("wa_numbers").select("id, status").eq("org_id", firm.id),
      supabase.from("wa_optouts").select("contact_wa_id").eq("org_id", firm.id),
      supabase.rpc("wa_window_closes_at", { last_inbound: reference.toISOString() }),
    ]);
    if (rows.error || said.error || numbers.error || stops.error || windowEnd.error) return { kind: "error" };
    const windowMs = Date.parse(String(windowEnd.data)) - reference.getTime();
    const active = new Set(
      ((numbers.data ?? []) as { id: string; status: string }[]).filter((n) => n.status === "active").map((n) => n.id),
    );
    const stopped = new Set(((stops.data ?? []) as { contact_wa_id: string }[]).map((row) => row.contact_wa_id));
    const byConversation = new Map<string, ConversationMessageRow[]>();
    for (const message of (said.data ?? []) as ConversationMessageRow[]) {
      const list = byConversation.get(message.conversation_id) ?? [];
      if (list.length < CONVERSATION_MESSAGES) list.push(message);
      byConversation.set(message.conversation_id, list);
    }
    for (const row of (rows.data ?? []) as ConversationRow[]) {
      talks.set(row.id, {
        id: row.id,
        contact: row.saved_name?.trim() || row.contact_name?.trim() || "",
        windowOpen:
          Number.isFinite(windowMs) && windowMs > 0 && isWindowOpen(row.last_inbound_at, reference.getTime(), windowMs),
        optedOut: stopped.has(row.contact_wa_id),
        numberActive: active.has(row.number_id),
        messages: (byConversation.get(row.id) ?? []).reverse().map((message) => ({
          id: message.id,
          author: message.direction === "in" ? "cliente" : message.by_one ? "one" : "escritorio",
          text: message.body ?? "",
          momentLabel: momentLabel(message.created_at, timeZone),
        })),
      });
    }
  }

  const waiting: PendingApproval[] = pendingRows.map((row) => {
    const task = one(row.ai_tasks);
    const answered = one(row.ai_runs)?.output;
    const documentId = documentOf(row);
    const statementId = statementOf(row);
    const draftId = draftOf(row);
    const conversationId = conversationOf(row);
    const piece = draftId ? (pieces.get(draftId) ?? null) : null;
    const answer = answers.get(row.run_id) ?? null;
    // A text of the AI is read whole on its case: the queue shows how the AI's own answer starts and what the
    // AI asked to check, and says when a lawyer already wrote on from it.
    const output =
      draftId && isRecord(answered)
        ? { ...answered, texto: typeof answered.texto === "string" ? answered.texto.slice(0, 1200) : "" }
        : answered;
    return {
      id: row.id,
      task: row.task,
      taskName: task?.name ?? row.task,
      taskDescription: task?.description ?? null,
      approverFunctions: (row.approver_functions ?? []).filter(isFirmFunction) as FirmFunction[],
      revisable: Boolean(task?.revisable),
      receivedLabel: momentLabel(row.created_at, timeZone),
      output: isRecord(output) ? output : {},
      document: documentId ? (subjects.get(documentId) ?? null) : null,
      statement: statementId ? (accounts.get(statementId) ?? null) : null,
      draft: piece
        ? {
            ...piece,
            answerVersion: answer ? Number(answer.version) : null,
            request: answer?.note
              ? { note: answer.note, askedBy: (answer.asked_by && names.get(answer.asked_by)) || null }
              : null,
            notes: (answer?.notes ?? []).filter((item): item is string => typeof item === "string"),
          }
        : null,
      conversation: conversationId ? (talks.get(conversationId) ?? null) : null,
    };
  });

  const recent: DecidedApproval[] = ((decided.data ?? []) as DecidedRow[]).map((row) => ({
    id: row.id,
    taskName: one(row.ai_tasks)?.name ?? row.task,
    status: row.status === "rejected" ? "rejected" : row.status === "returned" ? "returned" : "approved",
    edited: Boolean(row.edited),
    decidedAuto: row.decided_auto === true,
    decidedByName: (row.decided_by && names.get(row.decided_by)) || null,
    decidedLabel: momentLabel(row.decided_at, timeZone),
    note: row.decision_note,
  }));

  // `nextLevel` is aal2 exactly when the account has a verified factor;
  // `currentLevel` is aal2 when this session already confirmed it.
  const secondFactor: SecondFactorState =
    assurance.data?.currentLevel === "aal2" ? "ok" : assurance.data?.nextLevel === "aal2" ? "challenge" : "missing";

  return {
    kind: "ready",
    firm: { id: firm.id, name: firm.name },
    me: { firmFunction: firm.firmFunction },
    pending: waiting,
    pendingTotal: pending.count ?? waiting.length,
    decided: recent,
    secondFactor,
    supportVisit: cookieStore.has(IMPERSONATION_MARKER_COOKIE),
  };
}

export default async function ApprovalsPage() {
  return <ApprovalsView state={await loadApprovals()} />;
}
