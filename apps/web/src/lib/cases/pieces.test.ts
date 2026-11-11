import { describe, expect, it } from "vitest";

import type { CaseDraft } from "@/lib/cases/draft-facts";
import { pieceLine } from "@/lib/cases/pieces";

const piece = (overrides: Partial<NonNullable<CaseDraft["piece"]>> = {}): NonNullable<CaseDraft["piece"]> => ({
  recommendation: "file",
  recommendationReason: null,
  waitsFor: null,
  decision: null,
  decisionReason: null,
  decidedBy: null,
  decidedLabel: null,
  filingStatus: null,
  filingMessage: null,
  filedLabel: null,
  filedHow: null,
  filedProtocol: null,
  receiptFileId: null,
  fromPublication: true,
  ...overrides,
});

const draft = (status: CaseDraft["status"], overrides: Partial<NonNullable<CaseDraft["piece"]>> = {}) =>
  ({ status, pieceKind: "replica", piece: piece(overrides) }) as unknown as CaseDraft;

describe("an intermediate piece's line", () => {
  it("asks for the defence a réplica waits for, and for the review of its text", () => {
    expect(pieceLine(draft("generating", { waitsFor: "defense" }), null)).toMatchObject({
      tone: "attention",
      key: "pieces-line-waits-defense",
    });
    expect(pieceLine(draft("generating"), null).tone).toBe("waiting");
    expect(pieceLine(draft("proposed"), null).key).toBe("pieces-line-review");
  });

  it("asks the lawyer's decision once issued, and ONE files it when nothing keeps it", () => {
    expect(pieceLine(draft("issued"), null).key).toBe("pieces-line-decide");
    expect(pieceLine(draft("issued", { decision: "file", filingStatus: "owed" }), null)).toMatchObject({
      tone: "waiting",
      lawyerFiles: false,
    });
  });

  it("leaves the filing to the lawyer where ONE has no channel, and when its filing came back", () => {
    expect(pieceLine(draft("issued", { decision: "file", filingStatus: "owed" }), "no_channel")).toMatchObject({
      key: "pieces-blocker-no-channel",
      lawyerFiles: true,
    });
    expect(pieceLine(draft("issued", { decision: "file", filingStatus: "unknown" }), null).lawyerFiles).toBe(true);
    expect(pieceLine(draft("issued", { decision: "file", filingStatus: "refused" }), null).tone).toBe("failed");
  });

  it("says a piece filed, by ONE or by the lawyer, and one held", () => {
    expect(
      pieceLine(
        draft("issued", { decision: "file", filingStatus: "filed", filedHow: "one", filedProtocol: "P-1" }),
        null,
      ),
    ).toMatchObject({ tone: "done", key: "pieces-line-filed-one", values: { protocol: "P-1", when: "" } });
    expect(pieceLine(draft("issued", { filedHow: "lawyer" }), null).key).toBe("pieces-line-filed-lawyer");
    expect(pieceLine(draft("cancelled", { decision: "hold", decidedBy: "Ana" }), null)).toMatchObject({
      tone: "info",
      key: "pieces-line-held",
    });
  });
});
