// @vitest-environment node
import { describe, expect, it } from "vitest";

import type { AgreementDocument, AgreementPerson } from "@/modules/direito-do-passageiro/agency/agreement";
import {
  documentsStanding,
  documentStanding,
  neededDocuments,
} from "@/modules/direito-do-passageiro/agency/agreement-documents";

const document = (overrides: Partial<AgreementDocument> = {}): AgreementDocument => ({
  id: "d0000000-0000-4000-8000-000000000001",
  kind: "identity",
  tripId: null,
  reading: "done",
  name: "rg.jpg",
  legible: true,
  matches: true,
  ...overrides,
});

const person = (overrides: Partial<AgreementPerson> = {}): AgreementPerson => ({
  id: "p0000000-0000-4000-8000-000000000001",
  fullName: "Mariana Teste",
  isHolder: true,
  minor: false,
  hasPhone: true,
  phoneEnd: "0006",
  documents: [],
  ...overrides,
});

describe("how a document of the link stands", () => {
  it("is being read, serves, or does not serve as it is", () => {
    expect(documentStanding(document({ reading: "pending" }))).toBe("reading");
    expect(documentStanding(document({ reading: "working" }))).toBe("reading");
    expect(documentStanding(document())).toBe("fine");
    // ONE could not read it: it arrived, and a person of the firm looks at it.
    expect(documentStanding(document({ reading: "failed", legible: null, matches: null }))).toBe("fine");
    expect(documentStanding(document({ legible: false }))).toBe("problem");
    expect(documentStanding(document({ matches: false }))).toBe("problem");
    // Read, with nothing said against it.
    expect(documentStanding(document({ legible: null, matches: null }))).toBe("fine");
  });
});

describe("what the firm needs of a person", () => {
  it("is an identity of everybody and a proof of address of the adult the link is for", () => {
    expect(neededDocuments(person()).map((item) => item.kind)).toEqual(["identity", "address_proof"]);
    expect(neededDocuments(person({ isHolder: false, minor: true })).map((item) => item.kind)).toEqual(["identity"]);
  });

  it("stands as the best of what was sent of its kind", () => {
    const [identity, address] = neededDocuments(
      person({
        documents: [
          document({ id: "a", legible: false }),
          document({ id: "b" }),
          document({ id: "c", kind: "address_proof", reading: "working" }),
          document({ id: "d", kind: "boarding_pass", tripId: "t" }),
        ],
      }),
    );
    // A blurred photo beside one that serves asks for nothing.
    expect(identity).toMatchObject({ kind: "identity", standing: "fine" });
    expect(identity?.documents.map((item) => item.id)).toEqual(["a", "b"]);
    expect(address).toMatchObject({ kind: "address_proof", standing: "reading" });
    expect(neededDocuments(person({ documents: [document({ matches: false })] }))[0]?.standing).toBe("problem");
    expect(neededDocuments(person())[0]?.standing).toBe("missing");
  });
});

describe("where the documents of the link stand", () => {
  const fine = [document(), document({ id: "e", kind: "address_proof" })];

  it("is complete once every one the firm needs serves", () => {
    expect(
      documentsStanding([
        person({ documents: fine }),
        person({ id: "child", isHolder: false, minor: true, documents: [document({ id: "f" })] }),
      ]),
    ).toBe("complete");
  });

  it("asks for a look before saying it is being read, and is open while something is still to send", () => {
    expect(documentsStanding([person({ documents: [document({ legible: false }), fine[1]!] })])).toBe("problem");
    expect(documentsStanding([person({ documents: [document({ reading: "pending" }), fine[1]!] })])).toBe("reading");
    expect(documentsStanding([person({ documents: [fine[0]!] })])).toBe("open");
    expect(documentsStanding([])).toBe("open");
  });
});
