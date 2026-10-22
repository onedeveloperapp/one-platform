/**
 * The firm's test chat (migration 0047), as its page and the connections
 * screen read it: the four ready trips and the tools that make each one's
 * problem happen, and the readers of what the database answers. Pure: the
 * reads and writes are `lib/test-chat/actions.ts`.
 */

/** The ready trips, by the name of their scenario (`tracked_trips.label`). */
export const TEST_TRIPS = ["cancelamento", "familia", "conexao", "internacional"] as const;
export type TestTrip = (typeof TEST_TRIPS)[number];
export const isTestTrip = (value: unknown): value is TestTrip => (TEST_TRIPS as readonly unknown[]).includes(value);

/** What a tool does to a trip's legs, as a source would say it. */
export type ToolLeg = {
  position: number;
  status: "scheduled" | "delayed" | "cancelled" | "changed" | "landed";
  late_minutes?: number;
};

export type TestTool = { key: string; label: string; legs: ToolLeg[] };

/**
 * The tools of each trip: the problem it was made for, and one the rule does
 * not tell (a delay shorter than the setting), so a tester sees ONE stay
 * quiet too. Words of the `product` namespace.
 */
export const TEST_TOOLS: Record<TestTrip, TestTool[]> = {
  cancelamento: [
    { key: "cancel", label: "test-chat-tool-cancel", legs: [{ position: 1, status: "cancelled" }] },
    {
      key: "late_short",
      label: "test-chat-tool-late-short",
      legs: [{ position: 1, status: "delayed", late_minutes: 120 }],
    },
  ],
  familia: [
    { key: "late_6h", label: "test-chat-tool-late-6", legs: [{ position: 1, status: "delayed", late_minutes: 360 }] },
    { key: "cancel", label: "test-chat-tool-cancel", legs: [{ position: 1, status: "cancelled" }] },
  ],
  conexao: [
    {
      key: "missed",
      label: "test-chat-tool-missed",
      legs: [
        { position: 1, status: "delayed", late_minutes: 180 },
        { position: 2, status: "delayed", late_minutes: 420 },
      ],
    },
    {
      key: "late_short",
      label: "test-chat-tool-late-short",
      legs: [{ position: 2, status: "delayed", late_minutes: 120 }],
    },
  ],
  internacional: [
    { key: "late_9h", label: "test-chat-tool-late-9", legs: [{ position: 1, status: "delayed", late_minutes: 540 }] },
    { key: "cancel", label: "test-chat-tool-cancel", legs: [{ position: 1, status: "cancelled" }] },
  ],
};

/** The tool of a trip by its key; null for one it does not have. */
export function toolOf(trip: string, key: string): TestTool | null {
  if (!isTestTrip(trip)) return null;
  return TEST_TOOLS[trip].find((tool) => tool.key === key) ?? null;
}

/** What each trip is, in a word, beside its passenger. */
export const TRIP_KEY: Record<TestTrip, string> = {
  cancelamento: "test-chat-trip-cancelamento",
  familia: "test-chat-trip-familia",
  conexao: "test-chat-trip-conexao",
  internacional: "test-chat-trip-internacional",
};

/** The quick replies of ONE's first word, as a person taps them. */
export const QUICK_REPLIES = ["SIM", "NÃO", "SAIR"] as const;
export type QuickReply = (typeof QUICK_REPLIES)[number];
export const isQuickReply = (value: unknown): value is QuickReply =>
  (QUICK_REPLIES as readonly unknown[]).includes(value);

export type TestLeg = {
  position: number;
  flightNumber: string;
  origin: string;
  originCity: string | null;
  destination: string;
  destinationCity: string | null;
  departure: string;
  arrival: string;
  status: string;
  estimatedArrival: string | null;
};

export type TestAlert = {
  kind: string;
  status: string;
  reason: string | null;
  answer: string | null;
  delayMinutes: number | null;
};

export type TestTripView = {
  id: string;
  label: TestTrip;
  passengerName: string;
  phone: string;
  companions: { name: string; birthDate: string | null }[];
  status: string;
  caseId: string | null;
  legs: TestLeg[];
  alert: TestAlert | null;
  conversationId: string | null;
};

export type TestChatView = {
  firm: string;
  delayMinutes: number;
  trips: TestTripView[];
};

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The database's answer of `test_chat_view`, read; null when it is not one or opens nothing. */
export function testChatViewOf(raw: unknown): TestChatView | null {
  if (typeof raw !== "object" || raw === null) return null;
  const answer = raw as Record<string, unknown>;
  if (answer.found !== true || !Array.isArray(answer.trips)) return null;
  const trips = answer.trips.flatMap((item): TestTripView[] => {
    const row = (item ?? {}) as Record<string, unknown>;
    const id = text(row.id);
    if (!id || !UUID.test(id) || !isTestTrip(row.label)) return [];
    const legs = (Array.isArray(row.legs) ? row.legs : []).flatMap((leg): TestLeg[] => {
      const l = (leg ?? {}) as Record<string, unknown>;
      if (typeof l.position !== "number" || !text(l.flight_number) || !text(l.origin) || !text(l.destination))
        return [];
      return [
        {
          position: l.position,
          flightNumber: String(l.flight_number),
          origin: String(l.origin),
          originCity: text(l.origin_city),
          destination: String(l.destination),
          destinationCity: text(l.destination_city),
          departure: text(l.departure) ?? "",
          arrival: text(l.arrival) ?? "",
          status: text(l.status) ?? "scheduled",
          estimatedArrival: text(l.estimated_arrival),
        },
      ];
    });
    const alertRow = row.alert && typeof row.alert === "object" ? (row.alert as Record<string, unknown>) : null;
    return [
      {
        id,
        label: row.label,
        passengerName: text(row.passenger_name) ?? "",
        phone: text(row.phone) ?? "",
        companions: (Array.isArray(row.companions) ? row.companions : []).flatMap((companion) => {
          const c = (companion ?? {}) as Record<string, unknown>;
          return text(c.name) ? [{ name: String(c.name), birthDate: text(c.birth_date) }] : [];
        }),
        status: text(row.status) ?? "watching",
        caseId: text(row.case_id),
        legs,
        alert: alertRow
          ? {
              kind: text(alertRow.kind) ?? "",
              status: text(alertRow.status) ?? "",
              reason: text(alertRow.reason),
              answer: text(alertRow.answer),
              delayMinutes: typeof alertRow.delay_minutes === "number" ? alertRow.delay_minutes : null,
            }
          : null,
        conversationId: text(row.conversation_id),
      },
    ];
  });
  return {
    firm: text(answer.firm) ?? "",
    delayMinutes: typeof answer.delay_minutes === "number" ? answer.delay_minutes : 240,
    trips: trips.sort((a, b) => TEST_TRIPS.indexOf(a.label) - TEST_TRIPS.indexOf(b.label)),
  };
}

/** One message of a trip's conversation, as the page draws it. */
export type TestMessage = {
  id: string;
  direction: "in" | "out";
  kind: string;
  body: string | null;
  template: string | null;
  status: string;
  mediaFilename: string | null;
  at: string;
};

export function testMessagesOf(raw: unknown): TestMessage[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item): TestMessage[] => {
    const row = (item ?? {}) as Record<string, unknown>;
    const id = text(row.id);
    const at = text(row.at);
    if (!id || !at || (row.direction !== "in" && row.direction !== "out")) return [];
    return [
      {
        id,
        direction: row.direction,
        kind: text(row.kind) ?? "text",
        body: text(row.body),
        template: text(row.template),
        status: text(row.status) ?? "",
        mediaFilename: text(row.media_filename),
        at,
      },
    ];
  });
}

/** Whether the last word of a conversation is ONE's first one, still waiting for the passenger's choice. */
export function waitsForChoice(messages: readonly TestMessage[]): boolean {
  const last = messages[messages.length - 1];
  return Boolean(last && last.direction === "out" && last.template?.startsWith("one_aviso_voo"));
}

/** The test chat as the connections screen shows it (`test_chat_link`). */
export type TestChatCard = {
  on: boolean;
  keeper: boolean;
  token: string | null;
  startedAt: string | null;
  realNumber: boolean;
  endedReason: string | null;
};

export function testChatCardOf(raw: unknown): TestChatCard | null {
  if (typeof raw !== "object" || raw === null) return null;
  const answer = raw as Record<string, unknown>;
  if (typeof answer.on !== "boolean") return null;
  const token = text(answer.token);
  return {
    on: answer.on,
    keeper: answer.keeper === true,
    token: token && /^[A-Za-z0-9_-]{32,64}$/.test(token) ? token : null,
    startedAt: text(answer.started_at),
    realNumber: answer.real_number === true,
    endedReason: text(answer.ended_reason),
  };
}
