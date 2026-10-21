/**
 * Which lawsuits a case becomes, and in which court, by who claims.
 *
 * - A minor (an incapable person) cannot be a party in the small-claims court
 *   (Lei 9.099/1995, art. 8): a minor's claim goes to the civil court (vara
 *   cível), represented by who answers for them.
 * - The small-claims court takes a claim of up to forty minimum wages (art. 3,
 *   I). With several claimants joined by choice, the ceiling is counted for
 *   each one, not for the sum (STJ, Jurisprudência em Teses, edição 89, tese
 *   2): an adult whose own claim exceeds it goes to the civil court too.
 * - A family that flew together sues together. When a minor is among the
 *   claimants, the whole family goes to the civil court in one lawsuit
 *   (decided by the owner on 2026-10-14): courts have taken the split
 *   "adults in the small-claims court, the minor in the civil court" for
 *   abusive fragmentation, with the minor's lawsuit extinguished (TJMT, 5ª
 *   Câmara de Direito Privado, 2026) or the firm fined and reported to the
 *   bar (TJDFT, 2ª Turma Cível, 2026), on the ground that nothing kept the
 *   family from one lawsuit in the civil court. Another chamber of the TJDFT
 *   (7ª Turma Cível, 2025) accepted the split, so it stays possible as the
 *   lawyer's recorded choice (`split`), planned as the first version did.
 *
 * - An adult whose own claim exceeds the ceiling goes to the civil court
 *   alone, as before: the rest of an adult family stays in the small-claims
 *   court, since the law lets that adult stay there too by giving up what
 *   exceeds the ceiling (art. 3, § 3), which is the firm's to weigh.
 *
 * So a family with a minor is one case with one lawsuit in the civil court by
 * default, and two linked lawsuits only when a lawyer chose so. The minimum wage of the year
 * and how many of them make the ceiling are data (`minimum_wages` and the
 * setting `small_claims`), and the choice is the case's (`cases.family_choice`),
 * all handed in by the caller.
 */

export const PROCEEDINGS_RULE_VERSION = "tipo-de-processo-v2";

export type ProceedingKind = "juizado" | "comum";

/** Together: one lawsuit for the family (the default). Split: a lawyer chose the small-claims court for whom may be there. */
export type FamilyChoice = "together" | "split";
export const FAMILY_CHOICES: readonly FamilyChoice[] = ["together", "split"];

export type PlannedClaimant = {
  partyId: string;
  minor: boolean;
  /** What is asked for this claimant, in centavos; null while the firm has not set it. */
  claimCents: number | null;
};

/**
 * Why each claimant is where the plan puts them: an adult in the small-claims court, a minor or an adult above the
 * ceiling in the civil court by their own claim, and an adult in the civil court only because the family goes there.
 */
export type ClaimantReason = "adult" | "minor" | "above_ceiling" | "with_family";

export type PlannedProceeding = {
  kind: ProceedingKind;
  partyIds: string[];
  /** Why each claimant is in it, by party id. */
  reasons: Record<string, ClaimantReason>;
};

/**
 * How the family stands in the plan: `single` when nobody's court depends on the choice (no minor, or nobody but
 * minors), `together` when a minor takes the family to the civil court, and `split` when a lawyer chose two lawsuits.
 */
export type FamilyPlan = "single" | "together" | "split";

export type ProceedingsPlan = {
  proceedings: PlannedProceeding[];
  /**
   * The adults whose claim is not set yet and whose court depends on it: placed in the small-claims court until it
   * is. None when the family goes to the civil court anyway.
   */
  claimUnknown: string[];
  family: FamilyPlan;
  ceilingCents: number;
  rule: typeof PROCEEDINGS_RULE_VERSION;
};

export function smallClaimsCeilingCents(minimumWageCents: number, ceilingInMinimumWages: number): number {
  return Math.round(minimumWageCents * ceilingInMinimumWages);
}

/** Why a claimant can only claim in the civil court, by their own claim; null when the small-claims court may take it. */
const boundBy = (claimant: PlannedClaimant, ceilingCents: number): "minor" | "above_ceiling" | null =>
  claimant.minor
    ? "minor"
    : claimant.claimCents !== null && claimant.claimCents > ceilingCents
      ? "above_ceiling"
      : null;

export function planProceedings(input: {
  claimants: PlannedClaimant[];
  ceilingCents: number;
  /** The case's choice; together when none was recorded. */
  familyChoice?: FamilyChoice;
}): ProceedingsPlan {
  const juizado: PlannedProceeding = { kind: "juizado", partyIds: [], reasons: {} };
  const comum: PlannedProceeding = { kind: "comum", partyIds: [], reasons: {} };
  // Only a minor takes the family along: an adult above the ceiling goes to the civil court alone.
  const minors = input.claimants.filter((claimant) => claimant.minor);
  const free = input.claimants.filter((claimant) => boundBy(claimant, input.ceilingCents) === null);
  const choosing = minors.length > 0 && free.length > 0;
  const together = choosing && input.familyChoice !== "split";
  const claimUnknown: string[] = [];

  for (const claimant of input.claimants) {
    const bind = boundBy(claimant, input.ceilingCents);
    if (bind) {
      comum.partyIds.push(claimant.partyId);
      comum.reasons[claimant.partyId] = bind;
    } else if (together) {
      comum.partyIds.push(claimant.partyId);
      comum.reasons[claimant.partyId] = "with_family";
    } else {
      if (claimant.claimCents === null) claimUnknown.push(claimant.partyId);
      juizado.partyIds.push(claimant.partyId);
      juizado.reasons[claimant.partyId] = "adult";
    }
  }
  return {
    proceedings: [juizado, comum].filter((proceeding) => proceeding.partyIds.length > 0),
    claimUnknown,
    family: !choosing ? "single" : together ? "together" : "split",
    ceilingCents: input.ceilingCents,
    rule: PROCEEDINGS_RULE_VERSION,
  };
}
