import type { StateTone } from "@/components/product/state-line";
import type { CaseDraft } from "@/lib/cases/draft-facts";

/**
 * The pure rules of an intermediate piece's line on the case (migration 0189): where it stands in one sentence, in
 * the tone of whose turn it is, and whether the lawyer files it in the court's system (the contingency where ONE has
 * no channel, or its filing came back).
 */

/** What keeps ONE from filing a piece itself, in the words of the line: the lawyer files it then. */
export const PIECE_BLOCKER_KEY: Record<string, string> = {
  no_channel: "pieces-blocker-no-channel",
  fixed_ip: "pieces-blocker-fixed-ip",
  code_missing: "pieces-blocker-code-missing",
  signature_needed: "pieces-blocker-signature",
};

export type PieceLine = {
  tone: StateTone;
  key: string;
  values?: Record<string, string>;
  /** The lawyer files it in the court's system and says so here. */
  lawyerFiles: boolean;
};

export function pieceLine(draft: CaseDraft, blocker: string | null | undefined): PieceLine {
  const piece = draft.piece;
  const line = (tone: StateTone, key: string, values?: Record<string, string>, lawyerFiles = false): PieceLine => ({
    tone,
    key,
    ...(values ? { values } : {}),
    lawyerFiles,
  });
  if (piece?.filedHow) {
    return line("done", piece.filedHow === "one" ? "pieces-line-filed-one" : "pieces-line-filed-lawyer", {
      protocol: piece.filedProtocol ?? "",
      when: piece.filedLabel ?? "",
    });
  }
  if (piece?.decision === "hold") return line("info", "pieces-line-held", { who: piece.decidedBy ?? "" });
  switch (draft.status) {
    case "generating":
      return piece?.waitsFor === "defense"
        ? line("attention", "pieces-line-waits-defense")
        : line("waiting", "pieces-line-writing");
    case "failed":
      return line("failed", "pieces-line-failed");
    case "proposed":
      return line("attention", "pieces-line-review");
    case "approved":
      return line("waiting", "pieces-line-issuing");
    case "rejected":
      return line("info", "pieces-line-rejected");
    case "cancelled":
      return line("info", "pieces-line-cancelled");
    default:
      break;
  }
  // Issued: the decision, then the filing.
  if (!piece || piece.decision === null) return line("attention", "pieces-line-decide");
  switch (piece.filingStatus) {
    case "sent":
      return line("waiting", "pieces-line-sending");
    case "refused":
      return line("failed", "pieces-line-refused", undefined, true);
    case "failed":
      return line("failed", "pieces-line-filing-failed", undefined, true);
    case "unknown":
      return line("attention", "pieces-line-unknown", undefined, true);
    case "filed":
      return line("done", "pieces-line-filed-one", {
        protocol: piece.filedProtocol ?? "",
        when: piece.filedLabel ?? "",
      });
    default:
      break;
  }
  if (blocker && PIECE_BLOCKER_KEY[blocker]) return line("attention", PIECE_BLOCKER_KEY[blocker], undefined, true);
  return line("waiting", "pieces-line-one-files");
}
