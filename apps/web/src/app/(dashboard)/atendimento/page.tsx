import InboxView from "./components/inbox-view";
import { cookies } from "next/headers";

import { mayDecide, momentLabel } from "@/lib/ai/approvals";
import { phonesOfWaId } from "@/lib/cases/cases";
import { CONVERSATION_TASK } from "@/lib/conversations/agent";
import { type WaitingReply, waitingReplyOf } from "@/lib/conversations/reply";
import { isFirmFunction } from "@/lib/firm/roles";
import { getMemberContext } from "@/lib/member/context";
import { isSimulatorOn } from "@/lib/whatsapp/config";
import {
  contactName,
  CONVERSATIONS_SHOWN,
  type ConversationSummary,
  type InboxState,
  isWaiting,
  MESSAGES_SHOWN,
  type MessageStatus,
  phoneLabel,
  type TemplateOption,
  type ThreadEvent,
  type ThreadMessage,
} from "@/lib/whatsapp/conversations";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";
import { isWindowOpen } from "@flyee/whatsapp/rules";

type NumberRow = { id: string; provider: string; status: string; waba_id: string };

type ConversationRow = {
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

type MessageRow = {
  id: string;
  direction: string;
  origin: string;
  kind: string;
  body: string | null;
  status: string;
  error_code: string | null;
  template_name: string | null;
  media_status: string;
  media_file_id: string | null;
  media_filename: string | null;
  sent_by: string | null;
  ai_run_id: string | null;
  by_one: boolean;
  created_at: string;
  wa_timestamp: string | null;
};

type EventRow = {
  id: string;
  kind: string;
  data: Record<string, unknown> | null;
  actor_id: string | null;
  created_at: string;
};

type TemplateRow = {
  id: string;
  name: string;
  body: string;
  header_text: string | null;
  footer_text: string | null;
  param_count: number;
};

type TeamRow = { user_id: string; display_name: string | null; email: string | null };

/** An answer of ONE that waits for a person (0048), with the conversation it is of. */
type WaitingRow = {
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
const CONVERSATION_COLUMNS =
  "id, number_id, contact_wa_id, contact_name, saved_name, last_inbound_at, last_message_at, last_message_preview, last_message_direction, unread_count, agent, called_reason";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STATUSES: readonly MessageStatus[] = ["received", "queued", "sending", "sent", "delivered", "read", "failed"];

/**
 * /atendimento: the firm's conversations over WhatsApp. Everything is read
 * under the person's own session: row-level security shows the conversations
 * of their firm only. What may be sent is the database's to decide
 * (`reserve_wa_send`, migration 0019); the page only tells the screen what it
 * will answer, so the composer never offers what would be refused.
 */
async function loadInbox(selectedId: string | null): Promise<InboxState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };

  const firm = context.firm;
  const { supabase } = context;
  // The hours are written here, on the person's own clock, and handed over as text.
  const timeZone = context.profile.timezone;
  const reference = new Date();

  const [numbers, conversations, optouts, windowEnd, waitingAnswers, cookieStore] = await Promise.all([
    supabase.from("wa_numbers").select("id, provider, status, waba_id").eq("org_id", firm.id),
    supabase
      .from("wa_conversations")
      .select(CONVERSATION_COLUMNS)
      .eq("org_id", firm.id)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .limit(CONVERSATIONS_SHOWN),
    supabase.from("wa_optouts").select("contact_wa_id").eq("org_id", firm.id),
    // How long the window is belongs to the database's settings, which a
    // person does not read: asking when a window opened now would close gives its length.
    supabase.rpc("wa_window_closes_at", { last_inbound: reference.toISOString() }),
    // The answers of ONE that wait for a person's "Enviar" (0048): one per conversation at most.
    supabase
      .from("approvals")
      .select("id, approver_functions, created_at, ai_runs(output, subject_type, subject_id)")
      .eq("org_id", firm.id)
      .eq("status", "pending")
      .eq("task", CONVERSATION_TASK)
      .order("created_at", { ascending: false })
      .limit(WAITING_READ),
    cookies(),
  ]);
  if (numbers.error || conversations.error || optouts.error || windowEnd.error || waitingAnswers.error)
    return { kind: "error" };

  const waitingOf = new Map<string, WaitingRow>();
  for (const row of (waitingAnswers.data ?? []) as WaitingRow[]) {
    const run = Array.isArray(row.ai_runs) ? (row.ai_runs[0] ?? null) : row.ai_runs;
    if (run?.subject_type === "wa_conversation" && run.subject_id && !waitingOf.has(run.subject_id))
      waitingOf.set(run.subject_id, row);
  }

  const windowMs = Date.parse(String(windowEnd.data)) - reference.getTime();
  if (!Number.isFinite(windowMs) || windowMs <= 0) return { kind: "error" };

  const numberRows = (numbers.data ?? []) as NumberRow[];
  const numberOf = new Map(numberRows.map((row) => [row.id, row]));
  const stopped = new Set(((optouts.data ?? []) as { contact_wa_id: string }[]).map((row) => row.contact_wa_id));

  const summarize = (row: ConversationRow): ConversationSummary => {
    const number = numberOf.get(row.number_id);
    const open = isWindowOpen(row.last_inbound_at, reference.getTime(), windowMs);
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
      lastLabel: row.last_message_at ? momentLabel(row.last_message_at, timeZone) : null,
      unread: row.unread_count,
      windowOpen: open,
      windowClosesLabel:
        open && row.last_inbound_at
          ? momentLabel(new Date(Date.parse(row.last_inbound_at) + windowMs).toISOString(), timeZone)
          : null,
      optedOut: stopped.has(row.contact_wa_id),
      numberActive: number?.status === "active",
      simulated: number?.provider === "simulator",
      test: number?.provider === "test",
      agent: row.agent === "person" ? "person" : "one",
      calledReason: row.called_reason,
      replyWaiting: waitingOf.has(row.id),
    };
  };

  const list = ((conversations.data ?? []) as ConversationRow[]).map(summarize);

  let chosen: ConversationSummary | null = null;
  let messages: ThreadMessage[] = [];
  let olderHidden = false;
  let templates: TemplateOption[] = [];
  let personCases: { id: string; seq: number }[] = [];
  let events: ThreadEvent[] = [];
  let waitingReply: { reply: WaitingReply; mayDecide: boolean } | null = null;

  if (selectedId && UUID.test(selectedId)) {
    chosen = list.find((conversation) => conversation.id === selectedId) ?? null;
    if (!chosen) {
      // Older than what the list shows: read on its own. One of another firm is not found.
      const { data: row, error } = await supabase
        .from("wa_conversations")
        .select(CONVERSATION_COLUMNS)
        .eq("id", selectedId)
        .eq("org_id", firm.id)
        .maybeSingle();
      if (error) return { kind: "error" };
      chosen = row ? summarize(row as ConversationRow) : null;
    }
  }

  if (chosen) {
    const account = numberOf.get(chosen.numberId)?.waba_id ?? "";
    const [thread, approved, team, people, happened] = await Promise.all([
      supabase
        .from("wa_messages")
        .select(
          "id, direction, origin, kind, body, status, error_code, template_name, media_status, media_file_id, media_filename, sent_by, ai_run_id, by_one, created_at, wa_timestamp",
        )
        .eq("conversation_id", chosen.id)
        .eq("org_id", firm.id)
        .order("created_at", { ascending: false })
        .limit(MESSAGES_SHOWN + 1),
      supabase
        .from("wa_templates")
        .select("id, name, body, header_text, footer_text, param_count")
        .eq("org_id", firm.id)
        .eq("waba_id", account)
        .eq("status", "approved")
        .order("name"),
      supabase.rpc("firm_team", { target_org: firm.id }),
      // The person of the firm with this number, and their cases.
      supabase
        .from("people")
        .select("id, case_parties(cases(id, seq, updated_at))")
        .eq("org_id", firm.id)
        .in("phone", phonesOfWaId(chosen.contact)),
      // What ONE did here and who took it over (0048).
      supabase
        .from("wa_conversation_events")
        .select("id, kind, data, actor_id, created_at")
        .eq("conversation_id", chosen.id)
        .eq("org_id", firm.id)
        .order("created_at", { ascending: false })
        .limit(MESSAGES_SHOWN),
    ]);
    if (thread.error || approved.error || team.error || people.error || happened.error) return { kind: "error" };

    type CaseRef = { id: string; seq: number; updated_at: string };
    const found = new Map<string, CaseRef>();
    for (const person of (people.data ?? []) as { case_parties: { cases: CaseRef | CaseRef[] | null }[] }[]) {
      for (const party of person.case_parties ?? []) {
        for (const item of Array.isArray(party.cases) ? party.cases : party.cases ? [party.cases] : [])
          found.set(item.id, item);
      }
    }
    personCases = [...found.values()]
      .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
      .map((item) => ({ id: item.id, seq: item.seq }));

    const names = new Map(
      ((team.data ?? []) as TeamRow[]).map((row) => [
        row.user_id,
        row.display_name?.trim() || row.email?.split("@")[0] || "",
      ]),
    );
    const rows = (thread.data ?? []) as MessageRow[];
    olderHidden = rows.length > MESSAGES_SHOWN;
    messages = rows
      .slice(0, MESSAGES_SHOWN)
      .reverse()
      .map((row) => ({
        id: row.id,
        direction: row.direction === "out" ? "out" : "in",
        origin: row.origin === "app" || row.origin === "history" ? row.origin : "cloud",
        kind: row.kind,
        body: row.body,
        status: (STATUSES as readonly string[]).includes(row.status) ? (row.status as MessageStatus) : "received",
        errorCode: row.error_code,
        momentLabel: momentLabel(row.wa_timestamp ?? row.created_at, timeZone),
        authorName: (row.sent_by && names.get(row.sent_by)) || null,
        at: row.created_at,
        byOne: row.by_one === true,
        aiRun: Boolean(row.ai_run_id),
        templateName: row.template_name,
        media: {
          state:
            row.media_status === "stored"
              ? "stored"
              : row.media_status === "failed"
                ? "failed"
                : row.media_status === "pending" || row.media_status === "fetching"
                  ? "pending"
                  : "none",
          fileId: row.media_file_id,
          filename: row.media_filename,
        },
      }));
    const firstMessage = messages[0]?.at ?? null;
    events = ((happened.data ?? []) as EventRow[])
      // Only what happened while the messages shown were written: nothing older than the first of them.
      .filter((row) => !olderHidden || !firstMessage || row.created_at >= firstMessage)
      .reverse()
      .map((row) => ({
        id: row.id,
        kind: row.kind,
        at: row.created_at,
        momentLabel: momentLabel(row.created_at, timeZone),
        caseId: typeof row.data?.case_id === "string" ? row.data.case_id : null,
        seq: typeof row.data?.seq === "number" ? row.data.seq : null,
        reason: typeof row.data?.reason === "string" ? row.data.reason : null,
        actorName: (row.actor_id && names.get(row.actor_id)) || null,
        fromPhone: row.data?.from_phone === true,
      }));
    const waiting = waitingOf.get(chosen.id);
    if (waiting) {
      const run = Array.isArray(waiting.ai_runs) ? (waiting.ai_runs[0] ?? null) : waiting.ai_runs;
      waitingReply = {
        reply: waitingReplyOf(waiting.id, run?.output, momentLabel(waiting.created_at, timeZone)),
        mayDecide: mayDecide(firm.firmFunction, (waiting.approver_functions ?? []).filter(isFirmFunction)),
      };
    }
    templates = ((approved.data ?? []) as TemplateRow[]).map((row) => ({
      id: row.id,
      name: row.name,
      body: row.body,
      headerText: row.header_text,
      footerText: row.footer_text,
      paramCount: row.param_count,
    }));
  }

  const active = numberRows.filter((row) => row.status === "active");
  const simulatorOn = isSimulatorOn();

  return {
    kind: "ready",
    firm: { id: firm.id, name: firm.name },
    me: { role: firm.role, firmFunction: firm.firmFunction },
    whatsapp: active.length > 0 ? "active" : numberRows.length > 0 ? "disconnected" : "none",
    conversations: list,
    selected: chosen ? { conversation: chosen, messages, olderHidden, cases: personCases, events, waitingReply } : null,
    templates,
    supportVisit: cookieStore.has(IMPERSONATION_MARKER_COOKIE),
    simulatorNumberId: simulatorOn ? (active.find((row) => row.provider === "simulator")?.id ?? null) : null,
  };
}

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ c?: string | string[] }> }) {
  const { c } = await searchParams;
  return <InboxView state={await loadInbox(typeof c === "string" ? c : null)} />;
}
