// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  EMPTY_OFFICE,
  officeAddressGiven,
  officeOf,
  officePayload,
  officeProblem,
  officeReadOf,
} from "@/lib/firm/office";

// Every address here is invented.

const office = {
  ...EMPTY_OFFICE,
  postalCode: "74000-000",
  street: "Rua das Flores",
  number: "10",
  city: "Goiânia",
  uf: "go",
  email: "contato@souza.invalid",
};

describe("where the firm is, as the power of attorney says it (0217)", () => {
  it("reads what the database answers, with empty fields where it has none", () => {
    expect(officeOf({ office_postal_code: "74000000", office_uf: "GO", oab_society_number: "1234" })).toMatchObject({
      postalCode: "74000000",
      uf: "GO",
      societyNumber: "1234",
      street: "",
    });
    expect(officeOf(null)).toEqual(EMPTY_OFFICE);
  });

  it("has the address with the CEP, the street, the city and the state", () => {
    expect(officeAddressGiven(office)).toBe(true);
    expect(officeAddressGiven({ ...office, city: " " })).toBe(false);
    expect(officeAddressGiven(EMPTY_OFFICE)).toBe(false);
  });

  it("saves the address whole or empty, the registration whole or none, and a valid e-mail", () => {
    expect(officeProblem(office)).toBeNull();
    expect(officeProblem(EMPTY_OFFICE)).toBeNull();
    expect(officeProblem({ ...office, street: "" })).toBe("address");
    expect(officeProblem({ ...office, societyUf: "GO" })).toBe("society");
    expect(officeProblem({ ...office, societyUf: "GO", societyNumber: "1.234" })).toBeNull();
    expect(officeProblem({ ...office, email: "contato" })).toBe("email");
  });

  it("sends digits for the CEP and the registration, and the state in capitals", () => {
    expect(officePayload({ ...office, societyUf: "go", societyNumber: "1.234" })).toMatchObject({
      postal_code: "74000000",
      uf: "GO",
      society_uf: "GO",
      society_number: "1234",
    });
  });
});

describe("what ONE read of the firm from its documents (0271)", () => {
  it("reads what was written and from where, and an address read without its CEP", () => {
    expect(
      officeOf({
        office_read: { source: "procuracao", fields: ["address", "cnpj", "other"], ref: "x" },
        office_lawyers: [
          { name: "Bruno Prado", uf: "GO", number: "54321" },
          { name: "", uf: "GO", number: "1" },
          { name: "Sem Estado", uf: "go", number: "2" },
        ],
      }),
    ).toMatchObject({
      read: { source: "procuracao", fields: ["address", "cnpj"], left: null },
      lawyers: [{ name: "Bruno Prado", uf: "GO", number: "54321" }],
    });
    expect(
      officeReadOf({
        source: "procuracao",
        fields: [],
        left: { street: "Rua do Comércio", city: "Anápolis", uf: "GO" },
      }),
    ).toEqual({
      source: "procuracao",
      fields: [],
      left: { street: "Rua do Comércio", number: "", complement: "", district: "", city: "Anápolis", uf: "GO" },
    });
    expect(officeReadOf({ source: "procuracao", fields: [] })).toBeNull();
    expect(officeReadOf(null)).toBeNull();
  });

  it("shows the firm's CNPJ, never a partner's CPF the billing profile may hold", () => {
    expect(officeOf({ billing_cpf_cnpj: "11222333000181" }).cnpj).toBe("11222333000181");
    expect(officeOf({ billing_cpf_cnpj: "52998224725" }).cnpj).toBe("");
  });

  it("sends the lawyers of the papers the firm keeps by state and number", () => {
    expect(officePayload({ ...office, lawyers: [{ name: "Bruno Prado", uf: "GO", number: "54321" }] }).lawyers).toEqual(
      [{ uf: "GO", number: "54321" }],
    );
    expect(officePayload(office).lawyers).toEqual([]);
  });
});
