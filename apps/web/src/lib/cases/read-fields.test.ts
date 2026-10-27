import { describe, expect, it } from "vitest";

import { beingRead, READ_ITEM_KEY, READ_ITEMS, readFieldsOf, readItems } from "@/lib/cases/read-fields";
import messages from "@flyee/content/messages/pt-BR.json";

const product = messages.product as Record<string, string>;
const MARK = { document: "d-1", kind: "identity" };

describe("what ONE read from a person's documents", () => {
  it("reads the marks the database keeps, and nothing that is not one", () => {
    expect(
      readFieldsOf({
        cpf: MARK,
        birth_date: { document: "d-1", kind: "identity" },
        street: { document: "d-2", kind: "address_proof" },
        // Not a field of a person, or not a mark.
        password: MARK,
        uf: { document: 7 },
      }),
    ).toEqual({ cpf: MARK, birth_date: MARK, street: { document: "d-2", kind: "address_proof" } });
    expect(readFieldsOf(null)).toEqual({});
    expect(readFieldsOf("cpf")).toEqual({});
    expect(readFieldsOf([MARK])).toEqual({});
  });

  it("says them as a person reads them: the address as one item, in the order of the form", () => {
    expect(readItems({ postal_code: MARK, city: MARK, cpf: MARK, full_name: MARK })).toEqual([
      "full_name",
      "cpf",
      "address",
    ]);
    expect(readItems({ nationality: MARK, birth_date: MARK })).toEqual(["birth_date", "nationality"]);
    expect(readItems({})).toEqual([]);
    for (const item of READ_ITEMS) expect(product[READ_ITEM_KEY[item]]).toBeTruthy();
  });

  it("knows when a document of the person that tells their data is still being read", () => {
    const identity = { kind: "identity", party_id: "p-1", status: "received", processing: "working" };
    expect(beingRead(["p-1"], [identity])).toBe(true);
    expect(beingRead(["p-1"], [{ ...identity, processing: "pending" }])).toBe(true);
    // Read already, decided, of somebody else, or a paper that tells no data of a person.
    expect(beingRead(["p-1"], [{ ...identity, processing: "done" }])).toBe(false);
    expect(beingRead(["p-1"], [{ ...identity, status: "accepted" }])).toBe(false);
    expect(beingRead(["p-2"], [identity])).toBe(false);
    expect(beingRead(["p-1"], [{ ...identity, kind: "ticket" }])).toBe(false);
    expect(beingRead(["p-1"], [{ ...identity, kind: "address_proof", processing: "pending" }])).toBe(true);
  });
});
