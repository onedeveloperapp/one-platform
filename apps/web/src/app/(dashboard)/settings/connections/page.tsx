import ConnectionsView from "./components/connections-view";
import { cookies } from "next/headers";

import { momentLabel, type SecondFactorState } from "@/lib/ai/approvals";
import { CALENDAR_PROVIDER, calendarProvider } from "@/lib/calendar/provider";
import { getVault } from "@/lib/connections/vault";
import { isManager } from "@/lib/firm/roles";
import { getMemberContext } from "@/lib/member/context";
import { firmNotices } from "@/lib/notices/facts";
import { testChatCardOf } from "@/lib/test-chat/test-chat";
import { isSimulatorOn, signupWindowConfig } from "@/lib/whatsapp/config";
import type {
  AccountTemplateRow,
  ConnectedNumber,
  ConnectionsState,
  PendingRegistration,
} from "@/lib/whatsapp/connections";
import { phoneLabel } from "@/lib/whatsapp/conversations";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";
import { BRAND } from "@flyee/content";

type ConnectionRow = {
  id: string;
  status: string;
  last_error: string | null;
  metadata: Record<string, unknown> | null;
};

type NumberRow = {
  id: string;
  connection_id: string;
  provider: string;
  display_phone_number: string;
  verified_name: string | null;
  mode: string;
  status: string;
  disconnect_reason: string | null;
  connected_at: string;
  disconnected_at: string | null;
  contacts_sync_requested_at: string | null;
  history_sync_requested_at: string | null;
  history_progress: number | null;
};

type TemplateRow = {
  id: string;
  name: string;
  language: string;
  category: string;
  status: string;
  body: string;
  header_text: string | null;
  footer_text: string | null;
};

/**
 * /settings/connections: the firm's WhatsApp number, for who manages the
 * firm. Read under that person's own session: the connections of a firm are
 * shown by row-level security to its owner and admins only, so somebody else
 * of the firm is told the screen is not theirs instead of reading an empty one.
 */
async function loadConnections(agenda: string | null): Promise<ConnectionsState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };
  if (!isManager(context.firm.role)) return { kind: "not-manager" };

  const firm = context.firm;
  const { supabase } = context;
  const timeZone = context.profile.timezone;

  const [
    connections,
    numbers,
    templates,
    assurance,
    cookieStore,
    signup,
    signature,
    calendarConnection,
    firmCalendar,
    notices,
    testChat,
  ] = await Promise.all([
    supabase
      .from("connections")
      .select("id, status, last_error, metadata")
      .eq("org_id", firm.id)
      .eq("provider", "whatsapp"),
    supabase
      .from("wa_numbers")
      .select(
        "id, connection_id, provider, display_phone_number, verified_name, mode, status, disconnect_reason, connected_at, disconnected_at, contacts_sync_requested_at, history_sync_requested_at, history_progress",
      )
      .eq("org_id", firm.id)
      .order("connected_at", { ascending: false }),
    supabase
      .from("wa_templates")
      .select("id, name, language, category, status, body, header_text, footer_text")
      .eq("org_id", firm.id)
      .neq("status", "disabled")
      .order("name"),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    cookies(),
    signupWindowConfig(),
    supabase
      .from("connections")
      .select("id, status, last_error, metadata")
      .eq("org_id", firm.id)
      .eq("provider", "zapsign")
      .neq("status", "disconnected")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("connections")
      .select("id, status")
      .eq("org_id", firm.id)
      .eq("provider", CALENDAR_PROVIDER)
      .neq("status", "disconnected")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase.from("firm_calendars").select("name, status, problem").eq("org_id", firm.id).maybeSingle(),
    firmNotices(supabase, firm.id).catch(() => null),
    // The test chat (0047): a read that failed hides its card, and the rest of the screen stands.
    supabase.rpc("test_chat_link", { target_org: firm.id }).then(
      ({ data, error }) => (error ? null : testChatCardOf(data)),
      () => null,
    ),
  ]);
  if (
    connections.error ||
    numbers.error ||
    templates.error ||
    signature.error ||
    calendarConnection.error ||
    firmCalendar.error ||
    !notices
  ) {
    return { kind: "error" };
  }
  const signatureRow = (signature.data ?? null) as ConnectionRow | null;

  const numberRows = (numbers.data ?? []) as NumberRow[];
  const connectionRows = (connections.data ?? []) as ConnectionRow[];

  const list: ConnectedNumber[] = numberRows.map((row) => ({
    id: row.id,
    connectionId: row.connection_id,
    provider: row.provider === "simulator" ? "simulator" : row.provider === "test" ? "test" : "meta",
    phoneLabel: phoneLabel(row.display_phone_number),
    verifiedName: row.verified_name,
    mode: row.mode === "coexistence" ? "coexistence" : "cloud",
    status: row.status === "active" ? "active" : "disconnected",
    disconnectReason: row.disconnect_reason,
    sinceLabel: momentLabel(
      row.status === "active" ? row.connected_at : (row.disconnected_at ?? row.connected_at),
      timeZone,
    ),
    syncRequested: Boolean(row.contacts_sync_requested_at && row.history_sync_requested_at),
    historyProgress: row.history_progress,
  }));

  // Sealed, and the vendor still has to register the number: the signup of a
  // number that lives on the platform alone ends one step short.
  const withNumber = new Set(numberRows.map((row) => row.connection_id));
  const pending: PendingRegistration[] = connectionRows
    .filter((row) => row.status === "connected" && !withNumber.has(row.id))
    .flatMap((row) => {
      const display = row.metadata?.display_phone_number;
      const phoneNumberId = row.metadata?.phone_number_id;
      // Only a number that lives on the platform alone is registered with the six digits:
      // one that also lives on the firm's phone is already registered there.
      return typeof display === "string" && typeof phoneNumberId === "string" && row.metadata?.on_business_app === false
        ? [{ connectionId: row.id, phoneLabel: phoneLabel(display) }]
        : [];
    });

  const activeConnections = new Set(
    list.filter((number) => number.status === "active").map((number) => number.connectionId),
  );
  const failing = connectionRows.some((row) => row.status === "error" && activeConnections.has(row.id));

  const secondFactor: SecondFactorState =
    assurance.data?.currentLevel === "aal2" ? "ok" : assurance.data?.nextLevel === "aal2" ? "challenge" : "missing";

  return {
    kind: "ready",
    firm: { id: firm.id, name: firm.name },
    numbers: list,
    pending,
    failing,
    templates: ((templates.data ?? []) as TemplateRow[]).map(
      (row): AccountTemplateRow => ({
        id: row.id,
        name: row.name,
        language: row.language,
        category: row.category,
        status: row.status,
        body: row.body,
        headerText: row.header_text,
        footerText: row.footer_text,
      }),
    ),
    secondFactor,
    supportVisit: cookieStore.has(IMPERSONATION_MARKER_COOKIE),
    environment: { simulator: isSimulatorOn(), vault: getVault().ok, signup },
    signature: signatureRow
      ? {
          connectionId: signatureRow.id,
          status: signatureRow.status,
          environment: signatureRow.metadata?.environment === "sandbox" ? "sandbox" : "production",
          lastError: signatureRow.last_error,
        }
      : null,
    calendar: {
      available: calendarProvider() !== null,
      connection: (calendarConnection.data as { id: string; status: string } | null) ?? null,
      // A calendar a person turned off stays named: connecting again, or taking it back, may use it again.
      calendar: firmCalendar.data
        ? {
            name: String(firmCalendar.data.name),
            status:
              firmCalendar.data.status === "lost" ? "lost" : firmCalendar.data.status === "off" ? "off" : "active",
            problem: (firmCalendar.data.problem as string | null) ?? null,
          }
        : null,
      outcome: agenda,
    },
    notices,
    testChat: testChat
      ? {
          state: testChat,
          url: testChat.token ? `${BRAND.siteUrl}/t/${testChat.token}` : null,
          sinceLabel: testChat.startedAt ? momentLabel(testChat.startedAt, timeZone) : null,
        }
      : null,
  };
}

export default async function ConnectionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const agenda = typeof query.agenda === "string" ? query.agenda.slice(0, 40) : null;
  return <ConnectionsView state={await loadConnections(agenda)} />;
}
