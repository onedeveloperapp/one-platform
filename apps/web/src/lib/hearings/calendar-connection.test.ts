// @vitest-environment node
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { FakeCalendarProvider } from "@flyee/calendar/fake";

/**
 * How the firm's calendar of hearings is taken when an account is connected
 * (the callback of Google's consent) and by the card's actions, with Google
 * standing in as the strict fake: the calendar the firm had is taken again
 * when the account may still write it and it was not deleted; a new one is
 * made otherwise; none is made on a guess when the account could not be
 * asked; a grant Google no longer honours is said to the firm and to the
 * connection; cutting gives the grant back.
 *
 * The database and the person's session stand in as small fakes that record
 * the calls the code makes. Every firm and calendar here is invented.
 */

type Call = { name: string; args: Record<string, unknown> };

const state = vi.hoisted(() => ({
  provider: null as unknown as InstanceType<typeof import("@flyee/calendar/fake").FakeCalendarProvider>,
  token: "",
  firmCalendar: null as Record<string, unknown> | null,
  connection: null as Record<string, unknown> | null,
  rpcs: [] as Call[],
  sessionRpcs: [] as Call[],
  reported: [] as unknown[],
  cookies: new Map<string, string>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => undefined }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) => (state.cookies.has(name) ? { name, value: state.cookies.get(name) } : undefined),
    set: (name: string, value: string) => state.cookies.set(name, value),
    delete: (options: { name: string } | string) =>
      state.cookies.delete(typeof options === "string" ? options : options.name),
  }),
}));
vi.mock("@flyee/jobs", () => ({ sendEvent: async () => ({ sent: true }) }));

/** A query of supabase-js, as far as this code reads: every filter returns itself, the end gives the row. */
function chain(row: () => Record<string, unknown> | null) {
  const node: Record<string, unknown> = {};
  for (const name of ["select", "eq", "neq", "order", "limit", "like", "in"]) node[name] = () => node;
  node.maybeSingle = async () => ({ data: row(), error: null });
  return node;
}

const service = {
  from: (table: string) => chain(() => (table === "firm_calendars" ? state.firmCalendar : null)),
  rpc: async (name: string, args: Record<string, unknown>) => {
    state.rpcs.push({ name, args });
    if (name === "firm_calendar_lost") return { data: { ok: true, code: "lost" }, error: null };
    return { data: { ok: true, code: "recorded" }, error: null };
  },
};
vi.mock("@flyee/auth/service", () => ({ createServiceClient: () => service }));

const FIRM = "be100000-0000-4000-8000-00000000000a";
const CONNECTION = "ce100000-0000-4000-8000-00000000000a";
const context = {
  userId: "ae100000-0000-4000-8000-000000000001",
  firm: { id: FIRM, name: "Souza Advogados", role: "owner" },
  supabase: {
    from: (table: string) => chain(() => (table === "connections" ? state.connection : null)),
    rpc: async (name: string, args: Record<string, unknown>) => {
      state.sessionRpcs.push({ name, args });
      return { data: { ok: true, code: "disconnected" }, error: null };
    },
  },
};
vi.mock("@/lib/member/context", () => ({ getMemberContext: async () => context }));
vi.mock("@/lib/whatsapp/session", () => ({ connectionRefusal: async () => null }));
vi.mock("@/lib/connections/vault", () => ({
  getVault: () => ({
    ok: true,
    vault: {
      seal: async () => ({ kind: "sealed" }),
      report: async (...args: unknown[]) => state.reported.push(args),
    },
  }),
}));
vi.mock("@/lib/calendar/provider", async (original) => ({
  ...(await original<typeof import("@/lib/calendar/provider")>()),
  calendarProvider: () => state.provider,
  calendarGrant: async () => ({ ok: true, grant: { refreshToken: state.token } }),
}));

const { GET } = await import("@/app/api/connections/google/callback/route");
const { disconnectCalendar, recreateCalendar, retakeCalendar } = await import("@/lib/hearings/calendar-actions");

const REDIRECT = "https://app.one.invalid/api/connections/google/callback";

/** Google sends the person back with the consent's code and the state their start kept. */
async function comeBack(code = "consentiu", given = "estado-certo"): Promise<string> {
  state.cookies.set("one-calendar-state", `estado-certo.${CONNECTION}`);
  const response = await GET(new NextRequest(`${REDIRECT}?code=${code}&state=${given}`));
  return new URL(response.headers.get("location") ?? "", REDIRECT).searchParams.get("agenda") ?? "";
}

/** A calendar the account already has, made under a grant of its own. */
async function existingCalendar(): Promise<string> {
  const grant = {
    refreshToken: (await state.provider.exchangeCode({ code: "antes", redirectUri: REDIRECT })).refreshToken,
  };
  return (
    await state.provider.createCalendar(grant, {
      name: "Audiências · Souza Advogados",
      description: "",
      timeZone: "America/Sao_Paulo",
    })
  ).id;
}

const recorded = () => state.rpcs.filter((call) => call.name === "record_firm_calendar");

beforeEach(() => {
  state.provider = new FakeCalendarProvider();
  state.token = "";
  state.firmCalendar = null;
  state.connection = { id: CONNECTION, status: "pending" };
  state.rpcs = [];
  state.sessionRpcs = [];
  state.reported = [];
  state.cookies.clear();
});

describe("connecting the account: which calendar the firm takes", () => {
  it("takes again the calendar the firm had when the account may still write it", async () => {
    const previous = await existingCalendar();
    state.firmCalendar = { calendar_id: previous, name: "Audiências · Souza Advogados", status: "off", problem: null };
    expect(await comeBack()).toBe("conectada");
    expect(recorded()).toHaveLength(1);
    expect(recorded()[0].args.target_calendar).toBe(previous);
    expect(state.provider.calendars.size).toBe(1);
  });

  it("makes a new one when the account may only read the one it had, or it was deleted in Google", async () => {
    const shared = await existingCalendar();
    state.provider.readOnly.add(shared);
    state.firmCalendar = { calendar_id: shared, name: "Audiências", status: "lost", problem: "auth" };
    expect(await comeBack()).toBe("conectada");
    expect(recorded()[0].args.target_calendar).not.toBe(shared);
    expect(state.provider.calendars.size).toBe(2);

    // Deleted in Google: never asked about, a new one at once.
    state.rpcs = [];
    const probe = vi.spyOn(state.provider, "calendarAccess");
    state.firmCalendar = { calendar_id: shared, name: "Audiências", status: "lost", problem: "gone" };
    expect(await comeBack("outra-vez")).toBe("conectada");
    expect(probe).not.toHaveBeenCalled();
    expect(recorded()[0].args.target_calendar).not.toBe(shared);
  });

  it("makes no calendar on a guess when the account could not be asked", async () => {
    const previous = await existingCalendar();
    state.firmCalendar = { calendar_id: previous, name: "Audiências", status: "off", problem: null };
    state.provider.failures.push("unavailable");
    expect(await comeBack()).toBe("sem-agenda");
    expect(recorded()).toHaveLength(0);
    expect(state.provider.calendars.size).toBe(1);
  });

  it("takes nothing from a return whose state is not the one the person's start kept", async () => {
    expect(await comeBack("consentiu", "outro-estado")).toBe("expirada");
    expect(recorded()).toHaveLength(0);
  });
});

describe("the card's actions, under the grant in hand", () => {
  beforeEach(async () => {
    state.token = (await state.provider.exchangeCode({ code: "em-uso", redirectUri: REDIRECT })).refreshToken;
    state.connection = { id: CONNECTION, status: "connected" };
  });

  it("takes back the calendar the firm had, and never makes one when the account cannot write it", async () => {
    const previous = await existingCalendar();
    state.firmCalendar = { calendar_id: previous, name: "Audiências", status: "off", problem: null };
    expect(await retakeCalendar()).toEqual({ ok: true, code: "retaken" });
    expect(recorded()[0].args.target_calendar).toBe(previous);

    state.rpcs = [];
    state.provider.readOnly.add(previous);
    expect(await retakeCalendar()).toEqual({ ok: false, code: "calendar_unusable" });
    expect(recorded()).toHaveLength(0);
    expect(state.provider.calendars.size).toBe(1);
  });

  it("makes a new calendar when asked, and says a grant Google refused as the worker says it", async () => {
    state.firmCalendar = {
      calendar_id: "agenda-antiga@group.calendar.invalid",
      name: "Audiências",
      status: "active",
      problem: null,
    };
    expect(await recreateCalendar()).toEqual({ ok: true, code: "recreated" });
    expect(state.provider.calendars.size).toBe(1);

    state.rpcs = [];
    state.provider.grants.clear();
    expect(await recreateCalendar()).toEqual({ ok: false, code: "grant_refused" });
    expect(state.rpcs.map((call) => [call.name, call.args.target_problem])).toEqual([["firm_calendar_lost", "auth"]]);
    expect(state.reported).toHaveLength(1);
  });

  it("gives the grant back to Google when the firm cuts the calendar", async () => {
    expect(await disconnectCalendar()).toEqual({ ok: true, code: "disconnected" });
    expect(state.provider.grants.has(state.token)).toBe(false);
    expect(state.sessionRpcs.map((call) => call.name)).toEqual(["disconnect_connection"]);
  });
});
