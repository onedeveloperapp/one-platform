/**
 * How the money a court released for a lawsuit is split among its claimants when it falls in the firm's account, and
 * what of it the firm keeps, passes on or holds (phase 10 of the plan of the controladoria and the finance). Pure.
 *
 * - Each claimant's part is their own value when the court gave one per claimant, else an equal part; cents left by a
 *   division go to the first claimants.
 * - The success fee is the case's share of what arrived (a settlement's share for a settlement), never under its
 *   minimum, spread over the claimants by their parts; it is kept by the firm only with a clause of the signed contract
 *   or a signed authorization (Código de Ética e Disciplina da OAB, art. 48, § 2º): without one it is held as the part
 *   in discussion, and the rest of the client's part is passed on as usual.
 * - The costs the firm advanced are kept only where the contract says it advances them, with their receipt (§ 3º).
 * - The fee never exceeds what the client receives (art. 50): above half of what is left after the costs, the excess is
 *   held for a partner to decide.
 * - The success fee of the lawsuit's sucumbência is the lawyer's (Estatuto da Advocacia, art. 23) and never enters here.
 * - A minor's part never becomes an ordinary transfer: it is held whole, with no fee taken by ONE, until the judge says
 *   how it is paid.
 */

export const PAYOUT_RULE_VERSION = "repasse-v1";

export type PayoutClaimant = {
  partyId: string;
  minor: boolean;
  /** The claimant's own value in the court's order, in cents; null when the order gave none per claimant. */
  ownCents: number | null;
};

export type PayoutInput = {
  receivedCents: number;
  claimants: PayoutClaimant[];
  successPercent: number;
  successMinCents: number;
  settlementPercent: number | null;
  settlement: boolean;
  /** A clause of the signed contract, or a signed authorization, lets the firm keep its fee from the client's money. */
  feesAuthorized: boolean;
  /** The costs the firm advanced and the contract lets it keep, with their receipt, in cents. */
  costsCents: number;
};

export type HoldReason = "no_clause" | "cap_art50" | "minor";

export type PayoutShare = {
  partyId: string;
  minor: boolean;
  grossCents: number;
  /** The fee the firm keeps from this part. */
  feesCents: number;
  /** The costs the firm keeps from this part. */
  costsCents: number;
  /** What is held, and why. */
  held: { reason: HoldReason; cents: number }[];
  /** What the firm passes on to the claimant now. */
  payableCents: number;
};

export type Payout = {
  rule: typeof PAYOUT_RULE_VERSION;
  shares: PayoutShare[];
  feesCents: number;
  costsCents: number;
  heldCents: number;
  payableCents: number;
};

const cents = (value: number): number => (Number.isFinite(value) ? Math.max(Math.trunc(value), 0) : 0);

/** Spreads a whole in cents by weights, the cents left going to the first. */
export function spread(total: number, weights: readonly number[]): number[] {
  const whole = cents(total);
  const sum = weights.reduce((acc, weight) => acc + Math.max(weight, 0), 0);
  if (weights.length === 0) return [];
  const base = weights.map((weight) => (sum > 0 ? Math.floor((whole * Math.max(weight, 0)) / sum) : Math.floor(whole / weights.length)));
  let left = whole - base.reduce((acc, part) => acc + part, 0);
  for (let index = 0; left > 0; index = (index + 1) % base.length, left -= 1) base[index]! += 1;
  return base;
}

export function splitPayout(input: PayoutInput): Payout {
  const received = cents(input.receivedCents);
  const claimants = input.claimants.filter((claimant) => claimant.partyId !== "");
  const own = claimants.every((claimant) => claimant.ownCents !== null && claimant.ownCents > 0);
  const gross = spread(
    received,
    claimants.map((claimant) => (own ? (claimant.ownCents ?? 0) : 1)),
  );
  const percent =
    input.settlement && input.settlementPercent !== null ? input.settlementPercent : Math.max(input.successPercent, 0);
  const totalFees = percent > 0 ? Math.max(Math.round((received * percent) / 100), cents(input.successMinCents)) : 0;
  const feeParts = spread(Math.min(totalFees, received), gross);
  // The costs are charged to the adults' parts only: a minor's part is not touched by ONE.
  const adultsGross = claimants.map((claimant, index) => (claimant.minor ? 0 : gross[index]!));
  const costParts = spread(cents(input.costsCents), adultsGross.some((part) => part > 0) ? adultsGross : gross.map(() => 0));

  const shares = claimants.map((claimant, index): PayoutShare => {
    const grossCents = gross[index]!;
    if (claimant.minor) {
      return { partyId: claimant.partyId, minor: true, grossCents, feesCents: 0, costsCents: 0, held: [{ reason: "minor", cents: grossCents }], payableCents: 0 };
    }
    const costsCents = Math.min(costParts[index] ?? 0, grossCents);
    const fee = Math.min(feeParts[index] ?? 0, grossCents - costsCents);
    const cap = Math.floor((grossCents - costsCents) / 2);
    const held: PayoutShare["held"] = [];
    let feesCents = fee;
    if (!input.feesAuthorized && fee > 0) {
      held.push({ reason: "no_clause", cents: fee });
      feesCents = 0;
    } else if (fee > cap) {
      held.push({ reason: "cap_art50", cents: fee - cap });
      feesCents = cap;
    }
    const heldCents = held.reduce((acc, item) => acc + item.cents, 0);
    return {
      partyId: claimant.partyId,
      minor: false,
      grossCents,
      feesCents,
      costsCents,
      held,
      payableCents: grossCents - costsCents - feesCents - heldCents,
    };
  });
  const sum = (pick: (share: PayoutShare) => number) => shares.reduce((acc, share) => acc + pick(share), 0);
  return {
    rule: PAYOUT_RULE_VERSION,
    shares,
    feesCents: sum((share) => share.feesCents),
    costsCents: sum((share) => share.costsCents),
    heldCents: sum((share) => share.held.reduce((acc, item) => acc + item.cents, 0)),
    payableCents: sum((share) => share.payableCents),
  };
}

/** The day a transfer is due: the given business days after the money arrived (weekends left out). */
export function payoutDueOn(receivedOn: string, businessDays: number): string {
  const [year, month, day] = receivedOn.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  let left = Math.max(Math.trunc(businessDays), 0);
  while (left > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const weekday = date.getUTCDay();
    if (weekday !== 0 && weekday !== 6) left -= 1;
  }
  return date.toISOString().slice(0, 10);
}
