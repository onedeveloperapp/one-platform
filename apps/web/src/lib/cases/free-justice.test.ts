import { describe, expect, it } from "vitest";

import { clientFreeJusticeOf, freeJusticeErrorKey, freeJusticeOf, freeJusticeStanding } from "@/lib/cases/free-justice";
import messages from "@flyee/content/messages/pt-BR.json";

const product = messages.product as Record<string, string>;

describe("free justice in the civil court", () => {
  it("says where each claimant stands, by their answer and the declaration of who answers for them", () => {
    expect(freeJusticeStanding({ answererId: null, asks: null, paper: null })).toBe("no_guardian");
    expect(freeJusticeStanding({ answererId: "p", asks: null, paper: null })).toBe("waiting");
    expect(freeJusticeStanding({ answererId: "p", asks: false, paper: "signed" })).toBe("declined");
    expect(freeJusticeStanding({ answererId: "p", asks: true, paper: null })).toBe("issuing");
    expect(freeJusticeStanding({ answererId: "p", asks: true, paper: "pending" })).toBe("signing");
    // An envelope that ended is ONE's to issue again.
    expect(freeJusticeStanding({ answererId: "p", asks: true, paper: "refused" })).toBe("issuing");
    expect(freeJusticeStanding({ answererId: "p", asks: true, paper: "signed" })).toBe("signed");
  });

  it("reads what the case and the link answered, leaving out what is not a claimant", () => {
    expect(freeJusticeOf({ ok: false })).toBeNull();
    expect(
      freeJusticeOf({
        ok: true,
        needs: [
          {
            party_id: "a",
            name: "Rui Teste",
            minor: false,
            answerer_id: "r",
            answerer_name: "Rui Teste",
            asks: true,
            source: "client",
            paper: "pending",
            income: true,
          },
          { party_id: "b", name: "Pedro Teste", minor: true, answerer_id: "r", answerer_name: "Rui Teste", asks: null },
          { party_id: "c" },
        ],
      })?.map((need) => [need.name, need.minor, need.standing, need.income]),
    ).toEqual([
      ["Rui Teste", false, "signing", true],
      ["Pedro Teste", true, "waiting", false],
    ]);
    expect(
      clientFreeJusticeOf({
        ok: true,
        items: [{ party_id: "a", name: "Rui Teste", minor: false, asks: false }, { name: "sem parte" }],
        issued: false,
        income: true,
        own_party: "a",
      }),
    ).toEqual({
      items: [{ partyId: "a", name: "Rui Teste", minor: false, asks: false, recordedAt: null }],
      issued: false,
      income: true,
      ownParty: "a",
    });
    expect(clientFreeJusticeOf(null)).toBeNull();
  });

  it("has words for every refusal", () => {
    for (const code of [
      "how_required",
      "answer_changed",
      "party_not_found",
      "not_asked",
      "no_guardian",
      "too_many",
      "link_not_open",
      "x",
    ]) {
      expect(product[freeJusticeErrorKey(code)], code).toBeTruthy();
    }
  });
});
