import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { payoutDueOn, splitPayout, spread } from "./payout.ts";

const base = {
  successPercent: 30,
  successMinCents: 0,
  settlementPercent: null,
  settlement: false,
  feesAuthorized: true,
  costsCents: 0,
};

describe("the split of a release", () => {
  it("spreads cents by weights, the cents left to the first", () => {
    assert.deepEqual(spread(100, [1, 1, 1]), [34, 33, 33]);
    assert.deepEqual(spread(1000, [3, 1]), [750, 250]);
  });

  it("keeps the fee with a clause and passes the rest on", () => {
    const payout = splitPayout({ ...base, receivedCents: 1_000_000, claimants: [{ partyId: "a", minor: false, ownCents: null }] });
    assert.equal(payout.feesCents, 300_000);
    assert.equal(payout.payableCents, 700_000);
    assert.deepEqual(payout.shares[0]!.held, []);
  });

  it("holds only the fee in discussion when there is no clause nor authorization", () => {
    const payout = splitPayout({
      ...base,
      feesAuthorized: false,
      receivedCents: 1_000_000,
      claimants: [{ partyId: "a", minor: false, ownCents: null }],
    });
    assert.deepEqual(payout.shares[0]!.held, [{ reason: "no_clause", cents: 300_000 }]);
    assert.equal(payout.shares[0]!.feesCents, 0);
    assert.equal(payout.payableCents, 700_000);
  });

  it("never lets the fee pass what the client receives (art. 50), holding the excess", () => {
    const payout = splitPayout({
      ...base,
      successPercent: 30,
      successMinCents: 400_000,
      costsCents: 100_000,
      receivedCents: 1_000_000,
      claimants: [{ partyId: "a", minor: false, ownCents: null }],
    });
    // After the costs 900,000 is left: the fee is at most 450,000; the minimum asked 400,000, under it.
    assert.equal(payout.shares[0]!.feesCents, 400_000);
    const high = splitPayout({
      ...base,
      successPercent: 60,
      receivedCents: 1_000_000,
      claimants: [{ partyId: "a", minor: false, ownCents: null }],
    });
    assert.equal(high.shares[0]!.feesCents, 500_000);
    assert.deepEqual(high.shares[0]!.held, [{ reason: "cap_art50", cents: 100_000 }]);
    assert.equal(high.payableCents, 400_000);
  });

  it("holds a minor's part whole, with no fee, while the adult's is passed on", () => {
    const payout = splitPayout({
      ...base,
      receivedCents: 2_000_000,
      claimants: [
        { partyId: "mother", minor: false, ownCents: null },
        { partyId: "son", minor: true, ownCents: null },
      ],
    });
    const [mother, son] = payout.shares;
    assert.equal(mother!.payableCents, 700_000);
    assert.deepEqual(son!.held, [{ reason: "minor", cents: 1_000_000 }]);
    assert.equal(son!.feesCents, 0);
    assert.equal(payout.feesCents + payout.costsCents + payout.heldCents + payout.payableCents <= 2_000_000, true);
  });

  it("uses each claimant's own value when the court gave one", () => {
    const payout = splitPayout({
      ...base,
      receivedCents: 900_000,
      claimants: [
        { partyId: "a", minor: false, ownCents: 600_000 },
        { partyId: "b", minor: false, ownCents: 300_000 },
      ],
    });
    assert.deepEqual(payout.shares.map((share) => share.grossCents), [600_000, 300_000]);
  });

  it("is due the business days after the money arrived", () => {
    // Friday the 13th of November 2026: five business days later is Friday the 20th.
    assert.equal(payoutDueOn("2026-11-13", 5), "2026-11-20");
  });
});
