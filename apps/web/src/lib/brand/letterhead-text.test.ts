import { describe, expect, it } from "vitest";

import { officeOfLetterhead } from "@/lib/brand/letterhead-text";

describe("what the letterhead says of the firm", () => {
  it("reads the CNPJ by its digits, the e-mail, the phone and the whole address", () => {
    expect(
      officeOfLetterhead([
        "Souza & Lima Advogados",
        "Rua das Flores, 100, Sala 2, Setor Oeste, Goiânia - GO, CEP 74115-060",
        "(62) 3333-4444 · contato@souza.invalid · CNPJ 11.444.777/0001-61",
      ]),
    ).toEqual({
      cnpj: "11444777000161",
      email: "contato@souza.invalid",
      phone: "6233334444",
      address: {
        postal_code: "74115060",
        street: "Rua das Flores",
        number: "100",
        complement: "Sala 2",
        district: "Setor Oeste",
        city: "Goiânia",
        uf: "GO",
      },
    });
  });

  it("reads an address whose number has a sign, and a city written with a slash", () => {
    expect(officeOfLetterhead(["Av. Paulista, nº 1000 | Bela Vista | São Paulo/SP | 01310-100"]).address).toEqual({
      postal_code: "01310100",
      street: "Av. Paulista",
      number: "1000",
      district: "Bela Vista",
      city: "São Paulo",
      uf: "SP",
    });
  });

  it("leaves out what it cannot check, and an address it cannot read whole", () => {
    // A CNPJ whose digits do not check, and an address with no CEP.
    expect(officeOfLetterhead(["CNPJ 11.444.777/0001-62", "Rua das Flores, 100, Goiânia - GO"])).toEqual({});
    expect(officeOfLetterhead(["Souza Advogados"])).toEqual({});
  });
});
