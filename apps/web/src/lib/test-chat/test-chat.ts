/**
 * The firm's test chat (migration 0047), as its page and the connections
 * screen read it: the four ready trips and the tools that make each one's
 * problem happen, the real flight a tester names to be followed at
 * FlightAware (0051), and the readers of what the database answers. Pure:
 * the reads and writes are `lib/test-chat/actions.ts`.
 */

/**
 * The trips, by the name of their scenario (`tracked_trips.label`): the four ready ones, a passenger an agency
 * registered (migration 0071), and a real flight.
 */
export const TEST_TRIPS = ["cancelamento", "familia", "conexao", "internacional", "agencia", "voo_real"] as const;

/** The trip of a real flight, followed at FlightAware: no tool makes it happen. */
export const REAL_FLIGHT = "voo_real";

/**
 * The trip of a passenger an agency registered with the test chat's number for it: the firm's test chat follows it
 * once the passenger agrees on the agency's link (0071), with the legs the agency wrote.
 */
export const AGENCY_TRIP = "agencia";

/** The WhatsApp an agency gives its passenger for the test chat to follow them, as the database keeps it. */
export const AGENCY_TEST_PHONE = "5500988880006";

/**
 * Whether a phone is one of the test chat's (0047, 0071): "(00) 98888-000N", an area code no real number has, so
 * nothing written to it could reach a person. The forms take it as a phone (an agency writes it for its passenger,
 * a person of a test case carries it), though a real Brazilian number is never one.
 */
export const isTestChatPhone = (value: string): boolean => /^(?:55)?0098888000[0-9]$/.test(value.replace(/\D/g, ""));

/** A tool's leg that is the trip's last, whichever it is: an agency's trip has the legs the agency wrote. */
export const LAST_LEG = 0;
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
  agencia: [
    { key: "cancel", label: "test-chat-tool-cancel", legs: [{ position: 1, status: "cancelled" }] },
    {
      key: "late_6h",
      label: "test-chat-tool-late-6-last",
      legs: [{ position: LAST_LEG, status: "delayed", late_minutes: 360 }],
    },
  ],
  voo_real: [],
};

/** A flight as a tester types it ("la 3300"), as the platform writes it ("LA3300"); null for one that is not. */
export function flightNumberOf(input: string): string | null {
  const code = String(input ?? "")
    .replace(/\s+/g, "")
    .toUpperCase();
  return /^[A-Z0-9]{2}\d{1,4}[A-Z]?$/.test(code) ? code : null;
}

/** Whether a day may be followed: from yesterday to the day after tomorrow, what FlightAware keeps in sight. */
export function followableDay(day: string, today: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return false;
  const days = Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return days >= -1 && days <= 2;
}

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
  agencia: "test-chat-trip-agencia",
  voo_real: "test-chat-trip-voo-real",
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

/** A piece of a message the firm wrote: words, or a web address the page opens as a link. */
export type MessagePart = { text: string; href?: string };

/**
 * The words of a message the firm wrote, with each web address in it as a link, as WhatsApp shows them on the
 * passenger's phone: the client's link ONE sends opens with a tap. A mark that ends a sentence right after an
 * address is not part of it. The page reads only the firm's messages this way: the passenger's words stay as typed.
 */
export function messagePartsOf(body: string): MessagePart[] {
  const parts: MessagePart[] = [];
  let from = 0;
  for (const match of body.matchAll(/https?:\/\/[^\s<>"'`]+/g)) {
    const address = match[0].replace(/[.,;:!?)\]]+$/, "");
    if (!/^https?:\/\/[^/]/.test(address)) continue;
    const at = match.index ?? 0;
    if (at > from) parts.push({ text: body.slice(from, at) });
    parts.push({ text: address, href: address });
    from = at + address.length;
  }
  if (from < body.length) parts.push({ text: body.slice(from) });
  return parts;
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
