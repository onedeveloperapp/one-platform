import type { CaseFiling } from "../case-types";

/**
 * What the card of the filing reads of ONE filing a package itself (migrations 0101 and 0264), apart from the card
 * so its tests read it without the screen: whether the lawyer's own steps step back, and whether only the receipt is
 * left to attach. Pure.
 */

/** Filed by a lawyer's batch on the court's screen (0264), by ONE's browser or the lawyer's extension. */
export const onScreen = (channel: string | undefined): boolean => channel === "browser" || channel === "extension";

/** Whether ONE files this package now (or is about to): the lawyer's own steps step back meanwhile. */
export function oneFilesIt(filing: CaseFiling | null): boolean {
  const byOne = filing?.byOne;
  if (!filing || !byOne || filing.status !== "ready") return false;
  const sub = byOne.submission;
  // A batch of a lawyer files it on the court's screen: their own steps step back while it is in course.
  if (sub && onScreen(sub.channel)) {
    return sub.status === "owed" || sub.status === "claimed" || sub.status === "confirming" || sub.status === "sending";
  }
  if (!byOne.channel) return false;
  if (sub) return sub.status === "owed" || sub.status === "claimed" || sub.status === "sending";
  return byOne.blocker === null || byOne.blocker === "not_signed";
}

/** The court received the lawsuit from ONE, and gave no number a lawyer could take from it: the receipt goes by hand. */
export const filedWithoutNumber = (filing: CaseFiling | null): boolean =>
  filing?.status === "ready" && filing.byOne?.submission?.status === "filed";
