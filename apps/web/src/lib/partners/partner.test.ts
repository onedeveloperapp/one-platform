import { describe, expect, it } from "vitest";

import {
  isPartnerManager,
  memberPartnerOf,
  PARTNER_ROLE_KEY,
  PARTNER_ROLES,
  partnerErrorKey,
  partnerModules,
  partnerSetupPending,
  partnershipFactsOf,
  partnershipPassengersOf,
} from "@/lib/partners/partner";
import messages from "@flyee/content/messages/pt-BR.json";

const product = messages.product as Record<string, string>;

describe("the partner of the person looking", () => {
  it("reads my_partner, keeping the active partnerships it can name", () => {
    const partner = memberPartnerOf({
      id: "p1",
      name: "Viagens Sol",
      kind: "agency",
      role: "admin",
      links: [
        { id: "l1", org_id: "o1", firm: "Souza Advogados", module: "direito-do-passageiro", started_at: "2026-10-29" },
        { id: "l2", org_id: null, firm: "Sem id", module: "direito-do-passageiro" },
      ],
    });
    expect(partner).toEqual({
      id: "p1",
      name: "Viagens Sol",
      kind: "agency",
      role: "admin",
      // An answer of before 0080, which does not say, is a setup never answered.
      setupAnswered: false,
      links: [
        { id: "l1", orgId: "o1", firm: "Souza Advogados", module: "direito-do-passageiro", startedAt: "2026-10-29" },
      ],
    });
    expect(partnerModules(partner)).toEqual(["direito-do-passageiro"]);
  });

  it("answers null for somebody in no partner, or an answer that is not one", () => {
    expect(memberPartnerOf(null)).toBeNull();
    expect(memberPartnerOf([])).toBeNull();
    expect(memberPartnerOf({ id: "p1", name: "X", role: "chefe" })).toBeNull();
    expect(partnerModules(null)).toEqual([]);
  });

  it("opens the setup for who manages a partner that never answered it, and for nobody else", () => {
    const answer = { id: "p1", name: "Viagens Sol", kind: "agency", links: [] };
    expect(partnerSetupPending(memberPartnerOf({ ...answer, role: "owner", setup_answered: false }))).toBe(true);
    expect(partnerSetupPending(memberPartnerOf({ ...answer, role: "admin", setup_answered: false }))).toBe(true);
    expect(partnerSetupPending(memberPartnerOf({ ...answer, role: "owner", setup_answered: true }))).toBe(false);
    // A member has nothing of the agency's setup to answer.
    expect(partnerSetupPending(memberPartnerOf({ ...answer, role: "member", setup_answered: false }))).toBe(false);
    expect(partnerSetupPending(null)).toBe(false);
  });

  it("knows who manages the partner", () => {
    expect(isPartnerManager("owner")).toBe(true);
    expect(isPartnerManager("admin")).toBe(true);
    expect(isPartnerManager("member")).toBe(false);
    expect(isPartnerManager(null)).toBe(false);
  });

  it("has words for every role and every refusal", () => {
    for (const role of PARTNER_ROLES) expect(product[PARTNER_ROLE_KEY[role]]).toBeTruthy();
    const codes = [
      "second_factor_required",
      "not_allowed_in_support_session",
      "not_authorized",
      "not_allowed",
      "invalid_email",
      "invalid_partner_name",
      "already_member",
      "invite_rate_limited",
      "module_not_enabled",
      "no_partnership",
      "only_owner_invites_admin",
      "reason_required",
      "owner_stays",
      "already_in_a_firm",
      "already_in_a_partner",
      "already_partnered",
      "expired",
      "revoked",
      "already_accepted",
      "email_not_confirmed",
      "not_found",
      "whatever",
    ];
    for (const code of codes) expect(product[partnerErrorKey(code)]).toBeTruthy();
  });
});

describe("what the firm has of its partnerships", () => {
  const answer = {
    manager: true,
    readings_daily: 300,
    flight_reads_today: 6,
    flight_reads_share: 150,
    partnerships: [
      {
        link_id: "link-sol",
        cases_going: 2,
        cases_total: 3,
        awaiting_client: 1,
        readings_today: 7,
        flight_reads_today: 4,
        forecast: {
          agreed: 5,
          agreed_since: "2099-10-02",
          agreed_weeks: [
            { week: "2099-10-19", agreed: 1 },
            { week: "2099-10-26", agreed: 4 },
            { week: "not a week", agreed: 9 },
          ],
          followed: 3,
          alerted: 1,
          days: [
            { day: "2099-11-01", trips: 2 },
            { day: "2099-11-02", trips: 0 },
          ],
          in_air: 1,
          arrived_today: 2,
        },
      },
      { link_id: "link-lua", cases_going: 0, cases_total: 0, awaiting_client: 0, readings_today: 0 },
      { cases_going: 9 },
    ],
  };

  it("reads each partnership's cases and costs, and the firm's costs of the day", () => {
    const facts = partnershipFactsOf(answer);
    expect(facts?.byLink.get("link-sol")).toEqual({
      casesGoing: 2,
      casesTotal: 3,
      awaitingClient: 1,
      readingsToday: 7,
      flightReadsToday: 4,
      forecast: {
        agreed: 5,
        agreedSince: "2099-10-02",
        agreedWeeks: [
          { week: "2099-10-19", agreed: 1 },
          { week: "2099-10-26", agreed: 4 },
        ],
        followed: 3,
        alerted: 1,
        days: [
          { day: "2099-11-01", trips: 2 },
          { day: "2099-11-02", trips: 0 },
        ],
        inAir: 1,
        arrivedToday: 2,
      },
      passengers: null,
    });
    // A partnership whose answer carries no forecast has none, never zeros said as numbers.
    expect(facts?.byLink.get("link-lua")?.forecast).toBeNull();
    expect(facts?.byLink.get("link-lua")?.flightReadsToday).toBeNull();
    expect(facts?.byLink.size).toBe(2);
    expect(facts?.costs).toEqual({ readingsDaily: 300, flightReadsToday: 6, flightReadsShare: 150 });
  });

  it("has no costs for who does not manage the firm, and is null for what is not an answer", () => {
    const member = partnershipFactsOf({ ...answer, manager: false, readings_daily: null });
    expect(member?.costs).toBeNull();
    expect(member?.byLink.get("link-sol")?.casesGoing).toBe(2);
    expect(partnershipFactsOf(null)).toBeNull();
    expect(partnershipFactsOf({ partnerships: "x" })).toBeNull();
  });
});

describe("the agency's passengers by the firm's numbers", () => {
  it("reads the four counts, and none from an answer that has none", () => {
    expect(partnershipPassengersOf({ registered: 12, unagreed: 3, leads: 7, converted: 2 })).toEqual({
      registered: 12,
      unagreed: 3,
      leads: 7,
      converted: 2,
    });
    expect(partnershipPassengersOf({ registered: 4 })).toEqual({ registered: 4, unagreed: 0, leads: 0, converted: 0 });
    expect(partnershipPassengersOf(null)).toBeNull();
    expect(partnershipPassengersOf({ leads: 2 })).toBeNull();
  });
});
