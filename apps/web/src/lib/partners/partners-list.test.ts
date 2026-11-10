import { describe, expect, it } from "vitest";

import type { FirmPartnership, OpenPartnerInvitation } from "@/lib/partners/facts";
import {
  casesGoing,
  firstPartnerView,
  isPartnerView,
  PARTNER_VIEWS,
  partnerCounts,
  partnerRows,
  partnerViewsFor,
} from "@/lib/partners/partners-list";

const facts = (casesGoingCount: number) => ({
  casesGoing: casesGoingCount,
  casesTotal: casesGoingCount + 1,
  awaitingClient: 0,
  readingsToday: null,
  flightReadsToday: null,
  forecast: null,
  passengers: null,
});

const partnership = (patch: Partial<FirmPartnership> & { linkId: string; partner: string }): FirmPartnership => ({
  partnerId: `p-${patch.linkId}`,
  module: "direito-do-passageiro",
  status: "active",
  startedAt: "2026-10-30T10:00:00+00:00",
  endedAt: null,
  endReason: null,
  facts: facts(2),
  ...patch,
});

const partnerships = [
  partnership({ linkId: "a", partner: "Agência Sol Teste" }),
  partnership({
    linkId: "b",
    partner: "Viagens Lúa Teste",
    status: "ended",
    endedAt: "2026-11-02T10:00:00+00:00",
    endReason: "Fim do contrato",
    facts: facts(1),
  }),
];

const invitations: OpenPartnerInvitation[] = [
  {
    id: "i1",
    partnerName: "Turismo Mar Teste",
    email: "mar@one-teste.invalid",
    module: "direito-do-passageiro",
    role: "owner",
    expiresAt: "2026-11-10T10:00:00+00:00",
  },
];

describe("the firm's partners list", () => {
  it("keeps the open invitations for who manages the firm", () => {
    expect(PARTNER_VIEWS.every(isPartnerView)).toBe(true);
    expect(partnerViewsFor(true)).toEqual(["ativas", "encerradas", "convites"]);
    expect(partnerViewsFor(false)).toEqual(["ativas", "encerradas"]);
  });

  it("counts each view as the list shows it, and searches without accents", () => {
    const counts = partnerCounts(partnerships, invitations, "");
    expect(counts).toEqual({ ativas: 1, encerradas: 1, convites: 1 });
    for (const view of PARTNER_VIEWS) {
      const rows = partnerRows(partnerships, invitations, view, "");
      expect(rows.partnerships.length + rows.invitations.length, view).toBe(counts[view]);
    }
    expect(partnerRows(partnerships, invitations, "encerradas", "lua").partnerships).toHaveLength(1);
    expect(partnerRows(partnerships, invitations, "convites", "mar@").invitations).toHaveLength(1);
    expect(partnerCounts(partnerships, invitations, "sol").ativas).toBe(1);
  });

  it("sums the cases going only when every partnership's numbers were read", () => {
    expect(casesGoing(partnerships)).toBe(3);
    expect(casesGoing([...partnerships, partnership({ linkId: "c", partner: "X", facts: null })])).toBeNull();
    expect(casesGoing([])).toBe(0);
  });

  it("opens on the partnerships in force, then on what waits", () => {
    expect(firstPartnerView(partnerships, invitations, true)).toBe("ativas");
    expect(firstPartnerView([partnerships[1]], invitations, true)).toBe("convites");
    expect(firstPartnerView([partnerships[1]], invitations, false)).toBe("encerradas");
    expect(firstPartnerView([], [], true)).toBe("ativas");
  });
});
