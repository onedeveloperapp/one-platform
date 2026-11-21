import { describe, expect, it } from "vitest";

import { keepRules, personalityOutputOf, profileForModel, profileOf } from "@/lib/firm/personality";
import { isPrivateAddress, siteTextOf } from "@/lib/firm/site-text";

const ANSWER = {
  apresentacao: {
    nome: "Souza Advogados",
    sobre: "Cuidamos de problemas com voos — e de família!",
    cidades: ["Goiânia"],
  },
  tratamento: "senhor",
  tom: "formal",
  tamanho: "explicadas",
  areas: [{ area: "Família e sucessões", aceita: "Divórcio consensual", nao_aceita: "Inventário" }, { area: "" }],
  fora_do_horario: "Respondemos no próximo dia útil 😊",
  honorarios: "Os honorários estão no contrato.",
  duvidas: "",
  evitar: ["Não falar de prazos"],
  exemplos: [
    { situacao: "Primeira resposta", mensagem: "Bom dia. Como posso ajudar?" },
    { situacao: "Pedido de documento", mensagem: "O senhor pode enviar a foto do documento?" },
    { situacao: "Quanto custa", mensagem: "Os honorários estão no contrato." },
  ],
};

describe("the firm's profile", () => {
  it("is read from the task's answer, every text kept within the rules for everybody", () => {
    const read = personalityOutputOf(ANSWER);
    expect(read).not.toBeNull();
    expect(read!.profile.apresentacao.sobre).toBe("Cuidamos de problemas com voos, e de família.");
    expect(read!.profile.fora_do_horario).toBe("Respondemos no próximo dia útil");
    expect(read!.profile.tratamento).toBe("senhor");
    expect(read!.profile.areas).toEqual([
      { area: "Família e sucessões", aceita: "Divórcio consensual", nao_aceita: "Inventário" },
    ]);
    expect(read!.examples).toHaveLength(3);
  });

  it("takes the plain default where the answer said none, and no profile with no example", () => {
    const read = profileOf({ tratamento: "tu", tom: "x" });
    expect(read).toMatchObject({ tratamento: "voce", tom: "proximo", tamanho: "curtas" });
    expect(personalityOutputOf({ ...ANSWER, exemplos: [] })).toBeNull();
    expect(personalityOutputOf(null)).toBeNull();
  });

  it("hands the conversation how the firm speaks, and the doubt also its fees and doubts", () => {
    const profile = personalityOutputOf(ANSWER)!.profile;
    expect(Object.keys(profileForModel(profile)).sort()).toEqual(
      ["apresentacao", "evitar", "fora_do_horario", "tamanho", "tom", "tratamento"].sort(),
    );
    expect(profileForModel(profile, true)).toMatchObject({ honorarios: "Os honorários estão no contrato." });
  });

  it("keeps the rules: no dash, no exclamation mark, no emoji", () => {
    expect(keepRules("Olá! Tudo bem — certo? 🎉")).toBe("Olá. Tudo bem, certo?");
  });
});

describe("the firm's site, read once", () => {
  it("is never read at an address of a private, local or reserved network", () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.8",
      "172.20.1.1",
      "192.168.0.10",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "::1",
      "fd00::1",
      "fe80::1",
      "::ffff:10.0.0.1",
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
    for (const address of ["8.8.8.8", "200.160.2.3", "2001:4860:4860::8888"]) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
    expect(isPrivateAddress("not an address")).toBe(true);
  });

  it("keeps only the words a page shows", () => {
    expect(
      siteTextOf(
        "<html><head><style>p{}</style><script>alert(1)</script></head><body><h1>Souza &amp; Lima</h1><!-- x --><p>Atendemos em Goiânia.</p></body></html>",
      ),
    ).toBe("Souza & Lima\nAtendemos em Goiânia.");
  });
});
