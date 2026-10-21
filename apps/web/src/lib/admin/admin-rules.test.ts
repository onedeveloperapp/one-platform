import { describe, expect, it, vi } from "vitest";

import { meetsGoal } from "@/lib/admin/ai";
import { namesOf } from "@/lib/admin/calendar";
import {
  ATTENTION_FILTERS,
  filterFirms,
  firmClock,
  type FirmRow,
  firmSearchText,
  isBanned,
  PLAN_FILTERS,
  planLabel,
} from "@/lib/admin/firms";
import {
  daysSince,
  formatBytes,
  formatDay,
  formatMoney,
  formatMoneyByCurrency,
  formatPercent,
  fromLocalInput,
  lastWeeks,
  ratio,
  sinceLabel,
  toLocalInput,
  untilLabel,
  weekStartOf,
} from "@/lib/admin/format";

const NOW = new Date("2026-10-01T15:00:00Z").getTime();

function firm(overrides: Partial<FirmRow> = {}): FirmRow {
  return {
    orgId: "org-1",
    name: "Souza Advogados",
    createdAt: "2026-09-01T12:00:00Z",
    owner: { userId: "user-1", name: "Ana Souza", email: "ana@example.com", confirmed: true, bannedUntil: null },
    people: 3,
    lawyers: 2,
    openInvitations: 1,
    lastSignInAt: "2026-09-30T12:00:00Z",
    tier: null,
    plan: null,
    grants: [],
    revenue: { BRL: 0, USD: 0 },
    attribution: {},
    flags: {
      hasPlan: false,
      pastDue: false,
      suspended: false,
      cancelScheduled: false,
      idle: false,
      noSecondFactor: false,
      noOwner: false,
      comped: false,
    },
    ...overrides,
  };
}

const plan = (overrides: Partial<NonNullable<FirmRow["plan"]>> = {}): NonNullable<FirmRow["plan"]> => ({
  slug: "escritorio-mensal",
  name: "Plano Escritório",
  status: "active",
  period: "monthly",
  priceCents: 6700,
  currency: "BRL",
  renewsAt: "2026-10-20T12:00:00Z",
  endsAt: null,
  provider: "asaas",
  comped: false,
  ...overrides,
});

describe("admin formatters", () => {
  it("writes money without cents only when there are none, and never adds currencies", () => {
    expect(formatMoney(6700, "BRL")).toBe("R$ 67");
    expect(formatMoney(6750, "BRL")).toBe("R$ 67,50");
    expect(formatMoneyByCurrency({ BRL: 125000, USD: 1900 })).toBe("R$ 1.250 + US$ 19");
    expect(formatMoneyByCurrency({ BRL: 0, USD: 0 })).toBe("—");
  });

  it("keeps an empty cohort apart from a zero rate", () => {
    expect(ratio(0, 0)).toBeNull();
    expect(formatPercent(ratio(0, 0))).toBe("—");
    expect(formatPercent(ratio(0, 10))).toBe("0%");
    expect(formatPercent(ratio(1, 4))).toBe("25%");
  });

  it("writes a calendar day without moving it across a time zone", () => {
    expect(formatDay("2026-09-28")).toBe("28/09/2026");
  });

  it("measures distance in whole days, in both directions", () => {
    expect(daysSince("2026-09-28T15:00:00Z", NOW)).toBe(3);
    expect(sinceLabel(null, NOW)).toBe("nunca");
    expect(sinceLabel("2026-10-01T09:00:00Z", NOW)).toBe("hoje");
    expect(sinceLabel("2026-09-30T14:00:00Z", NOW)).toBe("ontem");
    expect(sinceLabel("2026-09-19T15:00:00Z", NOW)).toBe("há 12 d");
    expect(untilLabel("2026-10-01T20:00:00Z", NOW)).toBe("hoje");
    expect(untilLabel("2026-10-02T16:00:00Z", NOW)).toBe("amanhã");
    expect(untilLabel("2026-10-13T16:00:00Z", NOW)).toBe("em 12 d");
    expect(untilLabel("2026-09-29T10:00:00Z", NOW)).toBe("há 2 d");
  });

  it("names a package size", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(18234)).toBe("17,8 KB");
    expect(formatBytes(3 * 1024 * 1024)).toBe("3,0 MB");
  });

  it("cuts weeks on Monday, Brasília time, like the reporting functions", () => {
    // Thursday 2026-10-01 in Brasília.
    expect(weekStartOf("2026-10-01T15:00:00Z")).toBe("2026-09-28");
    // 01:30 UTC on a Monday is still Sunday night in Brasília: the week before.
    expect(weekStartOf("2026-09-28T01:30:00Z")).toBe("2026-09-21");
    expect(weekStartOf("2026-09-28T03:00:00Z")).toBe("2026-09-28");
    expect(lastWeeks(3, "2026-10-01T15:00:00Z")).toEqual(["2026-09-14", "2026-09-21", "2026-09-28"]);
  });

  it("round-trips a meeting time through the form field on the console's clock", () => {
    expect(toLocalInput("2026-10-08T22:00:00Z")).toBe("2026-10-08T19:00");
    expect(fromLocalInput("2026-10-08T19:00")).toBe("2026-10-08T22:00:00.000Z");
    expect(fromLocalInput("amanhã")).toBeNull();
  });
});

describe("firms console", () => {
  it("selects with the flags the database counted, each firm with a plan or without one", () => {
    const flags = firm().flags;
    const rows = [
      firm({ orgId: "a" }),
      firm({ orgId: "b", flags: { ...flags, hasPlan: true } }),
      firm({ orgId: "c", flags: { ...flags, hasPlan: true, pastDue: true } }),
      firm({ orgId: "d", flags: { ...flags, idle: true, noSecondFactor: true } }),
    ];
    expect(filterFirms(rows, "firms")).toHaveLength(4);
    expect(filterFirms(rows, "noPlan").map((row) => row.orgId)).toEqual(["a", "d"]);
    expect(filterFirms(rows, "withPlan").map((row) => row.orgId)).toEqual(["b", "c"]);
    expect(filterFirms(rows, "pastDue").map((row) => row.orgId)).toEqual(["c"]);
    expect(filterFirms(rows, "idle").map((row) => row.orgId)).toEqual(["d"]);
    expect(filterFirms(rows, "noSecondFactor").map((row) => row.orgId)).toEqual(["d"]);
    // Every firm sits in exactly one of the two plan filters.
    const sides = PLAN_FILTERS.filter((entry) => entry.key !== "firms");
    for (const row of rows) expect(sides.filter((entry) => entry.matches(row))).toHaveLength(1);
    expect(ATTENTION_FILTERS.map((entry) => entry.key)).toEqual([
      "pastDue",
      "idle",
      "noSecondFactor",
      "cancelScheduled",
      "suspended",
    ]);
  });

  it("says what was sold: the plan and its price, a courtesy, a purchased access, or nothing", () => {
    expect(planLabel(firm({ plan: plan() }))).toBe("Plano Escritório · R$\u00a067 mensal");
    expect(planLabel(firm({ plan: plan({ name: "Plano piloto", comped: true, provider: null, priceCents: 0 }) }))).toBe(
      "Plano piloto · cortesia",
    );
    const grant = {
      id: "g",
      kind: "kit",
      plan: "acesso",
      source: "purchase",
      createdAt: "2026-09-02",
      expiresAt: null,
    };
    expect(planLabel(firm({ grants: [grant] }))).toBe("Acesso comprado");
    expect(planLabel(firm({ grants: [{ ...grant, kind: "comp", source: "admin" }] }))).toBe("Cortesia da equipe");
    expect(planLabel(firm())).toBe("Sem plano");
  });

  it("names the one deadline that matters, money problems first", () => {
    const flags = firm().flags;
    expect(firmClock(firm({ plan: plan(), flags: { ...flags, pastDue: true } }), NOW)).toBe("inadimplente");
    expect(firmClock(firm({ plan: plan(), flags: { ...flags, suspended: true } }), NOW)).toBe("acesso suspenso");
    expect(firmClock(firm({ plan: plan() }), NOW)).toBe("renova em 20/10/2026");
    expect(
      firmClock(
        firm({
          plan: plan({ renewsAt: null, endsAt: "2026-10-20T12:00:00Z" }),
          flags: { ...flags, cancelScheduled: true },
        }),
        NOW,
      ),
    ).toBe("cancela em 20/10/2026");
    // A yearly plan paid in instalments does not renew: it ends.
    expect(firmClock(firm({ plan: plan({ renewsAt: null, endsAt: "2027-09-01T12:00:00Z" }) }), NOW)).toBe(
      "termina em 01/09/2027",
    );
    expect(firmClock(firm({ plan: plan({ comped: true, renewsAt: null, provider: null }) }), NOW)).toBe(
      "cortesia, sem cobrança",
    );
    expect(firmClock(firm(), NOW)).toBe("sem cobrança");
  });

  it("finds a firm by its name, its owner, its plan or its campaign", () => {
    const text = firmSearchText(
      firm({ plan: plan(), flags: { ...firm().flags, hasPlan: true }, attribution: { utmCampaign: "lancamento" } }),
    );
    for (const term of [
      "souza advogados",
      "ana souza",
      "ana@example.com",
      "plano escritório",
      "com plano",
      "lancamento",
    ]) {
      expect(text).toContain(term);
    }
    expect(firmSearchText(firm({ owner: null }))).toContain("sem plano");
  });

  it("treats a ban as live only while its end is ahead", () => {
    expect(isBanned(null, NOW)).toBe(false);
    expect(isBanned("2126-01-01T00:00:00Z", NOW)).toBe(true);
    expect(isBanned("2026-01-01T00:00:00Z", NOW)).toBe(false);
  });
});

vi.mock("server-only", () => ({}));

describe("the AI's triage out of the shadow", () => {
  const goal = { windowDays: 90, minCompared: 100, minAgreedPercent: 97, maxMisses: 0 };

  it("lets a category out only with enough comparisons, nearly all agreeing, and no deadline or hearing missed", () => {
    expect(meetsGoal({ compared: 100, agreed: 97, misses: 0 }, goal)).toBe(true);
    expect(meetsGoal({ compared: 99, agreed: 99, misses: 0 }, goal)).toBe(false);
    expect(meetsGoal({ compared: 100, agreed: 96, misses: 0 }, goal)).toBe(false);
    expect(meetsGoal({ compared: 400, agreed: 399, misses: 1 }, goal)).toBe(false);
  });
});

describe("the forensic calendar console", () => {
  it("reads the comarcas a person typed, one each, however they are separated", () => {
    expect(namesOf("Goiânia, Iporá;  Senador Canedo\nGoiânia\n,x")).toEqual(["Goiânia", "Iporá", "Senador Canedo"]);
    expect(namesOf("")).toEqual([]);
  });
});
