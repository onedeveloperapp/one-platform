import InboxView from "./components/inbox-view";
import { cookies } from "next/headers";

import { mayDecide, momentLabel } from "@/lib/ai/approvals";
import { phonesOfWaId } from "@/lib/cases/cases";
import { chatwootProvider } from "@/lib/chatwoot/provider";
import { type WaitingReply, waitingReplyOf } from "@/lib/conversations/reply";
import { isFirmFunction } from "@/lib/firm/roles";
import { getMemberContext } from "@/lib/member/context";
import { pageScopeOf } from "@/lib/modules/offer";
import { isSimulatorOn } from "@/lib/whatsapp/config";
import {
  type ConversationSummary,
  type InboxState,
  MESSAGES_SHOWN,
  type MessageStatus,
  type TemplateOption,
  type ThreadEvent,
  type ThreadMessage,
  TOLD_WAYS,
} from "@/lib/whatsapp/conversations";
import { isInboxView, sortOfParam } from "@/lib/whatsapp/inbox-list";
import {
  CONVERSATION_COLUMNS,
  type ConversationRow,
  readInboxBase,
  readInboxRows,
  summarize,
} from "@/lib/whatsapp/inbox-read";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STATUSES: readonly MessageStatus[] = ["received", "queued", "sending", "sent", "delivered", "read", "failed"];

/**
 * /atendimento: the firm's conversations over WhatsApp. Everything is read
 * under the person's own session: row-level security shows the conversations
 * of their firm only. What may be sent is the database's to decide
 * (`reserve_wa_send`, migration 0019); the page only tells the screen what it
 * will answer, so the composer never offers what would be refused.
 */
async function loadInbox(
  selectedId: string | null,
  params: {
    modulo: string | undefined;
    ver: string | undefined;
    ordem: string | undefined;
    painel?: string | undefined;
  },
): Promise<InboxState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };

  const firm = context.firm;
  const { supabase } = context;
  // `?modulo=` keeps the inbox to the conversations of one module (0078): the ones whose contact is somebody of a
  // case of it. A conversation of nobody's case yet is in the firm's inbox only.
  const scope = pageScopeOf(context.catalog, context.modules, params.modulo);
  const module = scope.current?.key ?? null;
  // The view and the order of the list are in the address (`?ver=`, `?ordem=`), so a link of the home opens the
  // view it counts and a conversation opened from a view keeps it. A search is never there (0109).
  const view = isInboxView(params.ver) ? params.ver : "todas";
  const sort = sortOfParam(params.ordem);
  const timeZone = context.profile.timezone;

  const [base, found, cookieStore] = await Promise.all([
    readInboxBase(supabase, firm.id, timeZone),
    readInboxRows(supabase, firm.id, { view, sort, search: "", module }),
    cookies(),
  ]);
  if (!base || !found) return { kind: "error" };
  const { numberOf, waitingOf, numbers: numberRows } = base;

  const list = found.rows.map((row) => summarize(base, row));

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
      chosen = row ? summarize(base, row as ConversationRow) : null;
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
      // A new contact's way (0257) is told only where no other event of the thread tells it.
      .filter((row) => row.kind !== "routed" || (TOLD_WAYS as readonly string[]).includes(String(row.data?.way ?? "")))
      .reverse()
      .map((row) => ({
        id: row.id,
        kind: row.kind,
        at: row.created_at,
        momentLabel: momentLabel(row.created_at, timeZone),
        caseId: typeof row.data?.case_id === "string" ? row.data.case_id : null,
        seq: typeof row.data?.seq === "number" ? row.data.seq : null,
        reason:
          typeof row.data?.reason === "string"
            ? row.data.reason
            : typeof row.data?.area === "string"
              ? row.data.area
              : null,
        way: typeof row.data?.way === "string" ? row.data.way : null,
        actorName: (row.actor_id && names.get(row.actor_id)) || null,
        fromPhone: row.data?.from_phone === true,
        paper: typeof row.data?.kind === "string" ? row.data.kind : null,
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
    total: found.total,
    counts: found.counts,
    view,
    sort,
    selected: chosen ? { conversation: chosen, messages, olderHidden, cases: personCases, events, waitingReply } : null,
    templates,
    supportVisit: cookieStore.has(IMPERSONATION_MARKER_COOKIE),
    simulatorNumberId: simulatorOn ? (active.find((row) => row.provider === "simulator")?.id ?? null) : null,
    scope,
    panel: {
      available: chatwootProvider() !== null && !cookieStore.has(IMPERSONATION_MARKER_COOKIE),
      error: params.painel && /^[a-z0-9_]{1,40}$/.test(params.painel) ? params.painel : null,
    },
  };
}

export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{
    c?: string | string[];
    modulo?: string | string[];
    ver?: string | string[];
    ordem?: string | string[];
    painel?: string | string[];
  }>;
}) {
  const { c, modulo, ver, ordem, painel } = await searchParams;
  const one = (value: string | string[] | undefined) => (typeof value === "string" ? value : undefined);
  return (
    <InboxView
      state={await loadInbox(typeof c === "string" ? c : null, {
        modulo: one(modulo),
        ver: one(ver),
        ordem: one(ordem),
        painel: one(painel),
      })}
    />
  );
}
