// @vitest-environment node
import { describe, expect, it } from "vitest";

import { unagreedDepartureLabel, unagreedLineKey, unagreedOf } from "@/modules/direito-do-passageiro/agency/unagreed";

// Every person here is invented.

describe("the passengers who fly soon with no agreement (0094)", () => {
  it("reads the database's answer, leaving out a row that is not one", () => {
    const read = unagreedOf({
      days: 7,
      travelers: [
        { id: "a", full_name: "Lara Teste", departure: "2026-11-06T08:30:00", reagree: null, link_until: null },
        {
          id: "b",
          full_name: "Vera Teste",
          departure: "2026-11-07T14:05:00",
          reagree: "trip_waiting",
          link_until: null,
        },
        {
          id: "c",
          full_name: "Rui Teste",
          departure: "2026-11-08T06:00:00",
          reagree: "invented",
          link_until: "2026-12-01T00:00:00Z",
        },
        { id: "", full_name: "Sem id", departure: "2026-11-08T06:00:00" },
        { id: "e", full_name: "Sem voo", departure: null },
      ],
    });
    expect(read?.days).toBe(7);
    expect(read?.travelers.map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(read?.travelers[1].reagree).toBe("trip_waiting");
    // A reason the screen does not know is no reason: the passenger is owed the link as one who never answered.
    expect(read?.travelers[2].reagree).toBeNull();
  });

  it("is no answer when the database said something else", () => {
    expect(unagreedOf(null)).toBeNull();
    expect(unagreedOf({ travelers: [] })).toBeNull();
    expect(unagreedOf({ days: 7, travelers: "x" })).toBeNull();
  });

  it("says what the agency does next for each passenger, and the day as the agency registered it", () => {
    const [none, waiting, sent] = unagreedOf({
      days: 3,
      travelers: [
        { id: "a", full_name: "Lara Teste", departure: "2026-11-06T08:30:00" },
        { id: "b", full_name: "Vera Teste", departure: "2026-11-07T14:05:00", reagree: "phone_changed" },
        { id: "c", full_name: "Rui Teste", departure: "2026-11-08T06:00:00", link_until: "2026-12-01T00:00:00Z" },
      ],
    })!.travelers;
    expect(unagreedLineKey(none)).toBe("pax-unagreed-line-none");
    expect(unagreedLineKey(waiting)).toBe("pax-unagreed-line-reagree");
    expect(unagreedLineKey(sent)).toBe("pax-unagreed-line-sent");
    expect(unagreedDepartureLabel(none)).toBe("06/11/2026 08:30");
  });
});
