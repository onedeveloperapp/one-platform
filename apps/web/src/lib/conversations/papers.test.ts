import { describe, expect, it } from "vitest";

import {
  AWAITING_SIGNATURE,
  dispensablesAsk,
  nextPaperAsk,
  NOT_HAVE_LINE,
  paperAsk,
  papersOwedOf,
  papersToSignOf,
  saysNotHave,
  signatureLinksMessage,
} from "@/lib/conversations/papers";

// Every person here is invented.

const owed = (
  kind: string,
  extra: Partial<{ own: boolean; minor: boolean; name: string; rejected: boolean }> = {},
) => ({
  kind,
  per: "claimant",
  name: extra.name ?? "Nídia Teste",
  own: extra.own ?? true,
  minor: extra.minor ?? false,
  rejected: extra.rejected ?? false,
});

describe("the documents ONE asks in the chat (0230)", () => {
  it("reads the database's answer, and nothing of a conversation with no case", () => {
    expect(
      papersOwedOf({
        ok: true,
        code: "case",
        case_id: "c-1",
        waits_signature: true,
        owed: [{ kind: "address_proof", per: "holder", name: "Nídia Teste", own: true, minor: false, rejected: false }],
        dispensables: [{ kind: "receipt", label: "comprovantes", state: "later" }],
      }),
    ).toEqual({
      caseId: "c-1",
      waitsSignature: true,
      owed: [{ kind: "address_proof", per: "holder", name: "Nídia Teste", own: true, minor: false, rejected: false }],
      dispensables: [{ kind: "receipt", label: "comprovantes", state: "later" }],
    });
    expect(papersOwedOf({ ok: true, code: "no_case" })).toBeNull();
    expect(papersOwedOf(null)).toBeNull();
  });

  it("asks each document by whose it is", () => {
    expect(paperAsk(owed("identity"))).toBe(
      "Agora a foto do seu documento de identidade, RG ou CNH, com a frente e o verso.",
    );
    expect(paperAsk(owed("identity", { own: false, name: "Pedro Teste" }))).toBe(
      "Agora a foto do documento de identidade de Pedro, RG ou CNH, com a frente e o verso.",
    );
    expect(paperAsk(owed("identity", { own: false, name: "Bia Teste", minor: true }))).toBe(
      "Agora a certidão de nascimento ou o RG de Bia.",
    );
    // In the client's own name and recent, never offering one in somebody else's (0237).
    expect(paperAsk(owed("address_proof"))).toBe(
      "Agora um comprovante de endereço no seu nome, dos últimos 3 meses: conta de luz, água, telefone ou internet.",
    );
    expect(paperAsk(owed("address_proof"), 1)).toContain("no seu nome, do último mês:");
    expect(paperAsk(owed("address_proof"))).not.toContain("outra pessoa");
    expect(paperAsk(owed("ticket"))).toBe("Agora o cartão de embarque, o bilhete ou o print da reserva.");
    for (const kind of ["identity", "address_proof", "ticket", "baggage_report", "other"]) {
      expect(paperAsk(owed(kind))).not.toMatch(/[—–!]/);
    }
  });

  it("asks the next one not just refused, then the dispensable ones once, or says the signature comes", () => {
    const base = { caseId: "c-1", waitsSignature: false, dispensables: [] };
    expect(
      nextPaperAsk(
        { ...base, owed: [owed("identity", { rejected: true }), owed("ticket")] },
        { dispensablesAsked: false },
      ),
    ).toBe("Agora o cartão de embarque, o bilhete ou o print da reserva.");
    expect(
      nextPaperAsk({ ...base, owed: [owed("identity", { rejected: true })] }, { dispensablesAsked: false }),
    ).toBeNull();
    expect(nextPaperAsk({ ...base, waitsSignature: true, owed: [] }, { dispensablesAsked: false })).toBe(
      AWAITING_SIGNATURE,
    );
    const dispensables = [
      { kind: "receipt", label: "comprovantes do que você gastou por causa do problema", state: "asked" },
      { kind: "evidence", label: "prints das mensagens da companhia", state: "sent" },
    ];
    const asked = nextPaperAsk({ ...base, owed: [], dispensables }, { dispensablesAsked: false });
    expect(asked).toBe(
      `Se você tiver, mande também: comprovantes do que você gastou por causa do problema. Ajuda a provar o que aconteceu.\n${NOT_HAVE_LINE}`,
    );
    expect(nextPaperAsk({ ...base, owed: [], dispensables }, { dispensablesAsked: true })).toBeNull();
    expect(dispensablesAsk([{ kind: "receipt", label: "x", state: "later" }])).toBeNull();
  });

  it('takes "Não tenho" by its number or its words', () => {
    expect(saysNotHave("1")).toBe(true);
    expect(saysNotHave("Não tenho")).toBe(true);
    expect(saysNotHave("não tenho nenhum")).toBe(true);
    expect(saysNotHave("tenho sim, vou mandar")).toBe(false);
  });
});

describe("the links to sign, in the chat (0231)", () => {
  it("lists each paper with its own link, names the ones signed by gov.br, and says ONE goes on after", () => {
    const papers = papersToSignOf([
      { paper_id: "p-1", kind: "procuracao", method: "zapsign", sign_url: "https://app.zapsign.example/verificar/a" },
      { paper_id: "p-2", kind: "contrato", method: "zapsign", sign_url: "https://app.zapsign.example/verificar/b" },
      { paper_id: "p-3", kind: "contrato", method: "zapsign", sign_url: null },
      { paper_id: "", kind: "contrato", method: "zapsign" },
    ]);
    expect(papers.map((paper) => paper.paperId)).toEqual(["p-1", "p-2", "p-3"]);
    expect(signatureLinksMessage("Nídia Teste", papers)).toBe(
      [
        "Falta só assinar, Nídia. Cada documento tem o seu link, e leva uns 2 minutos no total:",
        "1. Procuração: https://app.zapsign.example/verificar/a",
        "2. Contrato: https://app.zapsign.example/verificar/b",
        "Depois de assinar, eu continuo por aqui.",
      ].join("\n"),
    );
    expect(signatureLinksMessage("Nídia", papers.slice(1, 2))).toBe(
      "Falta só assinar, Nídia. O escritório preparou o contrato, e leva uns 2 minutos: https://app.zapsign.example/verificar/b\nDepois de assinar, eu continuo por aqui.",
    );
    const govbr = signatureLinksMessage(null, [{ paperId: "p-4", kind: "procuracao", method: "govbr", signUrl: null }]);
    expect(govbr).toContain("O escritório preparou este documento, que se assina pelo gov.br: a procuração.");
    expect(govbr).toContain("O documento e os passos estão no link do seu caso.");
    // With the link made for this message (0237).
    expect(
      signatureLinksMessage(
        "Lia",
        [{ paperId: "p-4", kind: "procuracao", method: "govbr", signUrl: null }],
        "https://one.invalid/c/t",
      ),
    ).toContain("O documento e os passos estão neste link: https://one.invalid/c/t");
    expect(
      signatureLinksMessage("Nídia", [{ paperId: "p-5", kind: "contrato", method: "zapsign", signUrl: null }]),
    ).toBeNull();
    for (const text of [signatureLinksMessage("Nídia", papers), govbr]) expect(String(text)).not.toMatch(/[—–!]/);
  });

  it("gives the address of a paper the firm's D4Sign signs as it gives ZapSign's (0253)", () => {
    const papers = papersToSignOf([
      {
        paper_id: "p-6",
        kind: "procuracao",
        method: "d4sign",
        sign_url: "https://sandbox.d4sign.example/embed/viewblob/doc?key_signer=k",
      },
    ]);
    expect(signatureLinksMessage("Nídia", papers)).toBe(
      "Falta só assinar, Nídia. O escritório preparou a procuração, e leva uns 2 minutos: https://sandbox.d4sign.example/embed/viewblob/doc?key_signer=k\nDepois de assinar, eu continuo por aqui.",
    );
    expect(
      signatureLinksMessage("Nídia", [{ paperId: "p-7", kind: "contrato", method: "d4sign", signUrl: null }]),
    ).toBeNull();
  });
});
