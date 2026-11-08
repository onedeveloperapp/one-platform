import "server-only";

import { momentLabel } from "@/lib/ai/approvals";
import { CONVERSATION_TASK } from "@/lib/conversations/agent";
import {
  contactName,
  CONVERSATIONS_SHOWN,
  type ConversationSummary,
  isWaiting,
  phoneLabel,
} from "@/lib/whatsapp/conversations";
import { type InboxCounts, type InboxListQuery, inboxPageOf, inOrder } from "@/lib/whatsapp/inbox-list";
import { isWindowOpen } from "@flyee/whatsapp/rules";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The firm's conversations, read under the person's own session (row-level security shows the conversations of
 * their firm only): the page's first read and every one the screen asks after it (a search, in a server action)
 * are these same calls, so a row is always summarized the same way.
 */

export type NumberRow = { id: string; provider: string; status: string; waba_id: string };

export type ConversationRow = {
  id: string;
  number_id: string;
  contact_wa_id: string;
  contact_name: string | null;
  saved_name: string | null;
  last_inbound_at: string | null;
  last_message_at: string | null;
  last_message_preview: string | null;
  last_message_direction: string | null;
  unread_count: number;
  agent: string;
  called_reason: string | null;
};

/** An answer of ONE that waits for a person (0048), with the conversation it is of. */
export type WaitingRow = {
  id: string;
  approver_functions: string[] | null;
  created_at: string;
  ai_runs:
    | { output: unknown; subject_type: string | null; subject_id: string | null }
    | { output: unknown; subject_type: string | null; subject_id: string | null }[]
    | null;
};

/** How many answers of ONE that wait the inbox reads to mark its conversations: one waits per conversation. */
const WAITING_READ = 100;

export const CONVERSATION_COLUMNS =
  "id, number_id, contact_wa_id, contact_name, saved_name, last_inbound_at, last_message_at, last_message_preview, last_message_direction, unread_count, agent, called_reason";

/** What every summary of the inbox reads besides its own row: the firm's numbers, who asked to stop, the window. */
export type InboxBase = {
  numbers: NumberRow[];
  numberOf: Map<string, NumberRow>;
  stopped: Set<string>;
  /** The answer of ONE that waits in each conversation, by the conversation's id. */
  waitingOf: Map<string, WaitingRow>;
  windowMs: number;
  reference: Date;
  /** The person's own clock; null for the platform's. */
  timeZone: string | null;
};

export async function readInboxBase(
  supabase: SupabaseClient,
  orgId: string,
  timeZone: string | null,
): Promise<InboxBase | null> {
  // The hours are written here, on the person's own clock, and handed over as text.
  const reference = new Date();
  const [numbers, optouts, windowEnd, waitingAnswers] = await Promise.all([
    supabase.from("wa_numbers").select("id, provider, status, waba_id").eq("org_id", orgId),
    supabase.from("wa_optouts").select("contact_wa_id").eq("org_id", orgId),
    // How long the window is belongs to the database's settings, which a
    // person does not read: asking when a window opened now would close gives its length.
    supabase.rpc("wa_window_closes_at", { last_inbound: reference.toISOString() }),
    // The answers of ONE that wait for a person's "Enviar" (0048): one per conversation at most.
    supabase
      .from("approvals")
      .select("id, approver_functions, created_at, ai_runs(output, subject_type, subject_id)")
      .eq("org_id", orgId)
      .eq("status", "pending")
      .eq("task", CONVERSATION_TASK)
      .order("created_at", { ascending: false })
      .limit(WAITING_READ),
  ]);
  if (numbers.error || optouts.error || windowEnd.error || waitingAnswers.error) return null;

  const windowMs = Date.parse(String(windowEnd.data)) - reference.getTime();
  if (!Number.isFinite(windowMs) || windowMs <= 0) return null;

  const waitingOf = new Map<string, WaitingRow>();
  for (const row of (waitingAnswers.data ?? []) as WaitingRow[]) {
    const run = Array.isArray(row.ai_runs) ? (row.ai_runs[0] ?? null) : row.ai_runs;
    if (run?.subject_type === "wa_conversation" && run.subject_id && !waitingOf.has(run.subject_id))
      waitingOf.set(run.subject_id, row);
  }
  const numberRows = (numbers.data ?? []) as NumberRow[];
  return {
    numbers: numberRows,
    numberOf: new Map(numberRows.map((row) => [row.id, row])),
    stopped: new Set(((optouts.data ?? []) as { contact_wa_id: string }[]).map((row) => row.contact_wa_id)),
    waitingOf,
    windowMs,
    reference,
    timeZone,
  };
}

/** A conversation as the list and the thread read it. */
export function summarize(base: InboxBase, row: ConversationRow): ConversationSummary {
  const number = base.numberOf.get(row.number_id);
  const open = isWindowOpen(row.last_inbound_at, base.reference.getTime(), base.windowMs);
  return {
    id: row.id,
    numberId: row.number_id,
    contact: row.contact_wa_id,
    name: contactName({ savedName: row.saved_name, contactName: row.contact_name, contact: row.contact_wa_id }),
    phoneLabel: phoneLabel(row.contact_wa_id),
    preview: row.last_message_preview,
    lastDirection:
      row.last_message_direction === "in" || row.last_message_direction === "out" ? row.last_message_direction : null,
    waiting: isWaiting({
      lastDirection: row.last_message_direction,
      lastInboundAt: row.last_inbound_at,
      lastMessageAt: row.last_message_at,
    }),
    lastLabel: row.last_message_at ? momentLabel(row.last_message_at, base.timeZone) : null,
    unread: row.unread_count,
    windowOpen: open,
    windowClosesLabel:
      open && row.last_inbound_at
        ? momentLabel(new Date(Date.parse(row.last_inbound_at) + base.windowMs).toISOString(), base.timeZone)
        : null,
    optedOut: base.stopped.has(row.contact_wa_id),
    numberActive: number?.status === "active",
    simulated: number?.provider === "simulator",
    test: number?.provider === "test",
    agent: row.agent === "person" ? "person" : "one",
    calledReason: row.called_reason,
    replyWaiting: base.waitingOf.has(row.id),
  };
}

/** The conversations of a view, searched and ordered (`firm_inbox`, 0109), as rows, with the list's total and counts. */
export async function readInboxRows(
  supabase: SupabaseClient,
  orgId: string,
  query: InboxListQuery,
): Promise<{ rows: ConversationRow[]; total: number; counts: InboxCounts } | null> {
  const { data, error } = await supabase.rpc("firm_inbox", {
    target_org: orgId,
    target_view: query.view,
    target_search: query.search === "" ? null : query.search,
    target_module: query.module,
    target_sort: query.sort,
    target_limit: CONVERSATIONS_SHOWN,
  });
  if (error) return null;
  const page = inboxPageOf(data);
  if (!page) return null;
  if (page.ids.length === 0) return { rows: [], total: page.total, counts: page.counts };
  const rows = await supabase
    .from("wa_conversations")
    .select(CONVERSATION_COLUMNS)
    .eq("org_id", orgId)
    .in("id", page.ids);
  if (rows.error) return null;
  return { rows: inOrder(page.ids, (rows.data ?? []) as ConversationRow[]), total: page.total, counts: page.counts };
}

/** The list of a view, summarized: what the screen shows of it. */
export type InboxList = { conversations: ConversationSummary[]; total: number; counts: InboxCounts };

export async function readInboxList(
  supabase: SupabaseClient,
  orgId: string,
  timeZone: string | null,
  query: InboxListQuery,
): Promise<InboxList | null> {
  const [base, found] = await Promise.all([
    readInboxBase(supabase, orgId, timeZone),
    readInboxRows(supabase, orgId, query),
  ]);
  if (!base || !found) return null;
  return {
    conversations: found.rows.map((row) => summarize(base, row)),
    total: found.total,
    counts: found.counts,
  };
}
