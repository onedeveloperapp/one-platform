import { describe, expect, it } from "vitest";

import { firmPaperOf, firmPaperSource, oabOf, sameFirmName } from "@/lib/library/firm-paper";
import type { FirmRecord } from "@/lib/library/imports";

// Every firm, person, address and number here is invented; the CNPJ is one the manuals use as an example.
const PARAGRAPHS = [
  "PROCURAÇÃO",
  "OUTORGANTE: [[NOME]], [[NACIONALIDADE]], inscrito no CPF sob o nº [[CPF]].",
  "OUTORGADOS: LIMA & PRADO SOCIEDADE DE ADVOGADOS, inscrita no CNPJ sob o nº 11.222.333/0001-81 e na OAB/GO sob o nº 4.321, e os advogados Ana Lima, OAB/GO 12.345, e Bruno Prado, OAB/GO 054.321, com escritório na R. das Palmeiras, nº 100, Sala 2, Setor Oeste, Goiânia/GO, CEP 74110-010, telefone (62) 3222-4455, e-mail contato@lima-papel.invalid.",
  "PODERES: os da cláusula ad judicia et extra.",
];

const RECORD: FirmRecord = {
  name: "Lima & Prado",
  cnpj: null,
  society: null,
  lawyers: [{ name: "Ana Lima", oab: "OAB/GO 12345" }],
  address: null,
  postalCode: null,
  email: null,
  phone: null,
};

const said = (over: Record<string, unknown> = {}) => ({
  documento: "procuracao",
  paragrafos_do_escritorio: [3],
  dados_do_escritorio: {
    sociedade: "Lima & Prado Sociedade de Advogados",
    cnpj: "11.222.333/0001-81",
    registro_da_sociedade: "OAB/GO 4.321",
    advogados: [
      { nome: "Ana Lima", oab: "OAB/GO 12.345" },
      { nome: "Bruno Prado", oab: "OAB/GO 054.321" },
    ],
    endereco: {
      logradouro: "Rua das Palmeiras",
      numero: "100",
      complemento: "Sala 2",
      bairro: "Setor Oeste",
      cidade: "Goiânia",
      uf: "GO",
    },
    ...over,
  },
});

describe("the firm's data a paper of the firm writes", () => {
  it("takes each thing the paper writes of the firm, the CEP, the e-mail and the telephone read by rule", () => {
    expect(firmPaperOf(said(), PARAGRAPHS, RECORD, false)).toEqual({
      cnpj: "11222333000181",
      phone: "6232224455",
      email: "contato@lima-papel.invalid",
      society: { uf: "GO", number: "4321" },
      address: {
        postal_code: "74110010",
        street: "Rua das Palmeiras",
        number: "100",
        complement: "Sala 2",
        district: "Setor Oeste",
        city: "Goiânia",
        uf: "GO",
      },
      lawyers: [
        { name: "Ana Lima", uf: "GO", number: "12345" },
        { name: "Bruno Prado", uf: "GO", number: "54321" },
      ],
    });
  });

  it("takes nothing of a paper that names neither the firm's society nor a lawyer of its record, unless the firm said so", () => {
    const stranger: FirmRecord = {
      ...RECORD,
      name: "Rocha Advocacia",
      lawyers: [{ name: "Caio Rocha", oab: "OAB/SP 9999" }],
    };
    expect(firmPaperOf(said(), PARAGRAPHS, stranger, false)).toBeNull();
    expect(firmPaperOf(said(), PARAGRAPHS, stranger, true)?.cnpj).toBe("11222333000181");
    expect(firmPaperOf(said(), PARAGRAPHS, null, true)).toBeNull();
  });

  it("knows the firm by a lawyer of its record when the society's name is another", () => {
    const renamed: FirmRecord = { ...RECORD, name: "Escritório Central" };
    expect(firmPaperOf(said(), PARAGRAPHS, renamed, false)?.society).toEqual({ uf: "GO", number: "4321" });
  });

  it("never takes what the paper does not write: an invented CNPJ, registration, lawyer or street", () => {
    const read = firmPaperOf(
      said({
        cnpj: "11.444.777/0001-61",
        registro_da_sociedade: "OAB/GO 7777",
        advogados: [
          { nome: "Ana Lima", oab: "OAB/GO 12.345" },
          { nome: "Carla Dias", oab: "OAB/GO 8888" },
        ],
        endereco: {
          logradouro: "Avenida Goiás",
          numero: "9",
          complemento: "",
          bairro: "",
          cidade: "Goiânia",
          uf: "GO",
        },
      }),
      PARAGRAPHS,
      RECORD,
      false,
    );
    // The CNPJ the paper writes, read by rule, stands in for the one the model invented.
    expect(read?.cnpj).toBe("11222333000181");
    expect(read?.society).toBeNull();
    expect(read?.lawyers).toEqual([{ name: "Ana Lima", uf: "GO", number: "12345" }]);
    expect(read?.address).toBeNull();
  });

  it("keeps an address the paper writes without its CEP, for the form to ask the CEP alone", () => {
    const withoutCep = PARAGRAPHS.map((paragraph) => paragraph.replace(", CEP 74110-010", ""));
    expect(firmPaperOf(said(), withoutCep, RECORD, false)?.address).toMatchObject({
      postal_code: null,
      street: "Rua das Palmeiras",
      city: "Goiânia",
    });
  });

  it("reads only the paragraphs the marking says hold the firm's data", () => {
    expect(firmPaperOf({ ...said(), paragrafos_do_escritorio: [] }, PARAGRAPHS, RECORD, false)).toBeNull();
    expect(firmPaperOf({ ...said(), paragrafos_do_escritorio: [4] }, PARAGRAPHS, RECORD, false)).toBeNull();
    expect(firmPaperOf("nada", PARAGRAPHS, RECORD, false)).toBeNull();
  });
});

describe("the rules beside it", () => {
  it("tells the same firm by the words of its name", () => {
    expect(sameFirmName("Lima & Prado", "LIMA & PRADO SOCIEDADE DE ADVOGADOS")).toBe(true);
    expect(sameFirmName("Lima Prado Advocacia", "Lima & Prado")).toBe(true);
    expect(sameFirmName("Lima & Prado", "Rocha Advocacia")).toBe(false);
    expect(sameFirmName("Advogados Associados", "Lima & Prado")).toBe(false);
  });

  it("reads a registration at the bar however it is written", () => {
    expect(oabOf("OAB/GO 12.345")).toEqual({ uf: "GO", number: "12345" });
    expect(oabOf("inscrita na OAB/GO sob o nº 054.321")).toEqual({ uf: "GO", number: "54321" });
    expect(oabOf("OAB-SP nº 1")).toEqual({ uf: "SP", number: "1" });
    expect(oabOf("OAB/XX 123")).toBeNull();
    expect(oabOf("sem registro")).toBeNull();
  });

  it("names where the data came from by what the document is", () => {
    expect(firmPaperSource("procuracao")).toBe("procuracao");
    expect(firmPaperSource("peca")).toBe("piece");
    expect(firmPaperSource("peca_do_processo")).toBe("peca_processo");
    expect(firmPaperSource("outro")).toBeNull();
    expect(firmPaperSource(undefined)).toBeNull();
  });
});
