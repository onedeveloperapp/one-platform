import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { internalDeadline } from "./deadlines.ts";

describe("the internal deadline", () => {
  it("is the court's business days before the deadline, weekends and skipped days left out", () => {
    // Due on a Friday: two business days before is the Wednesday.
    assert.equal(internalDeadline({ dueOn: "2026-11-13", startsOn: "2026-11-02", skipped: [] }, 2), "2026-11-11");
    // Due on a Monday: the weekend does not count.
    assert.equal(internalDeadline({ dueOn: "2026-11-16", startsOn: "2026-11-02", skipped: [] }, 2), "2026-11-12");
    // A day the count skipped (a court's holiday) does not count either.
    assert.equal(
      internalDeadline(
        { dueOn: "2026-11-13", startsOn: "2026-11-02", skipped: [{ from: "2026-11-12", to: "2026-11-12", reason: "closed", label: "Feriado" }] },
        2,
      ),
      "2026-11-10",
    );
  });

  it("never falls before the first day of the term, and zero days is none", () => {
    assert.equal(internalDeadline({ dueOn: "2026-11-04", startsOn: "2026-11-03", skipped: [] }, 5), "2026-11-03");
    assert.equal(internalDeadline({ dueOn: "2026-11-13", startsOn: "2026-11-02", skipped: [] }, 0), null);
  });

  it("counts the days of a suspension of the terms, which is no closure, and leaves out the national holidays", () => {
    // Due on 2027-01-22 (Friday): the 21st and the 20th count, the suspension of the terms being no closure.
    assert.equal(internalDeadline({ dueOn: "2027-01-22", startsOn: "2026-12-10", skipped: [] }, 2), "2027-01-20");
    // Due on 2026-11-23 (Monday): the 20th (Friday) is a national holiday, so two days before is the 18th.
    assert.equal(internalDeadline({ dueOn: "2026-11-23", startsOn: "2026-11-02", skipped: [] }, 2), "2026-11-18");
  });
});
