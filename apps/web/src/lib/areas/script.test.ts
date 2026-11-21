import { describe, expect, it } from "vitest";

import { keepCopyRules, keyOf, scriptOf, triageScriptOf } from "@/lib/areas/script";
import {
  areaOfferText,
  exampleConversations,
  refusalText,
  scriptQuestionText,
  typeQuestionText,
} from "@/lib/areas/triage-texts";
import { triageVerdict } from "@flyee/rules/area-triage";

// An invented family area, as the task could answer it.
const ANSWER = {
  tipos: [
    {
      chave: "divorcio",
      nome: "Divórcio consensual",
      documentos: [
        { chave: "rg", nome: "RG ou CNH", tipo: "identity", por: "pessoa", essencial: true },
        { chave: "certidao", nome: "Certidão de casamento", tipo: "qualquer", por: "caso", essencial: true },
        { chave: "certidao", nome: "Matrícula do imóvel", tipo: "other", por: "caso", essencial: false },
      ],
      pecas: ["Petição inicial de divórcio"],
    },
    { chave: "", nome: "Pensão alimentícia", documentos: [], pecas: [] },
  ],
  perguntas: [
    {
      chave: "bens",
      texto: "Há bens a dividir?",
      tipos: ["divorcio", "inexistente"],
      opcoes: [
        { chave: "nao", texto: "Não", criterio: "segue" },
        { chave: "exterior", texto: "Sim, no exterior", criterio: "pessoa" },
      ],
    },
    { chave: "curta", texto: "Ok?", tipos: [], opcoes: [{ chave: "a", texto: "a", criterio: "segue" }] },
    {
      chave: "cidade",
      texto: "Você mora em Goiás?",
      tipos: [],
      opcoes: [
        { chave: "sim", texto: "Sim", criterio: "segue" },
        { chave: "nao", texto: "Não", criterio: "nao_atendemos" },
      ],
    },
  ],
  etapas: [{ chave: "cejusc", nome: "Audiência no CEJUSC", fase: "processo" }],
  tarefas: [{ chave: "calculo", nome: "Cálculo da pensão", quem: "one", fase: "peca", tipos: ["pensao_alimenticia"] }],
  honorarios: "Cobramos 30% do que o cliente receber — sem custo antes!",
  duvidas: "",
  recusa: "",
  tribunais: [{ tribunal: "TJGO", sistema: "Projudi" }],
  sensiveis: [{ dado: "criancas", nome: "Dados dos filhos", guarda_anos: 50 }],
};

describe("scriptOf", () => {
  const script = scriptOf(ANSWER)!;

  it("keeps the shape the database checks, a key for every item and each repeated key made its own", () => {
    expect(script.tipos.map((type) => type.chave)).toEqual(["divorcio", "pensao_alimenticia"]);
    expect(script.tipos[0]!.documentos.map((document) => document.chave)).toEqual(["rg", "certidao", "certidao_2"]);
    // A kind ONE does not read is "other", named by the script.
    expect(script.tipos[0]!.documentos[1]!.tipo).toBe("other");
    expect(script.tipos[0]!.documentos[2]!.essencial).toBe(false);
  });

  it("drops a question with fewer than two options, and a kind of case the script does not have", () => {
    expect(script.perguntas.map((question) => question.chave)).toEqual(["bens", "cidade"]);
    expect(script.perguntas[0]!.tipos).toEqual(["divorcio"]);
  });

  it("leaves ONE's own work out of the work outside the lawsuit, and keeps the time a datum is kept within 30 years", () => {
    expect(script.tarefas[0]!.quem).toBe("escritorio");
    expect(script.tarefas[0]!.tipos).toEqual(["pensao_alimenticia"]);
    expect(script.sensiveis[0]!.guarda_anos).toBe(30);
  });

  it("keeps every text within the rules for everybody", () => {
    expect(script.honorarios).toBe("Cobramos 30% do que o cliente receber, sem custo antes.");
    expect(keepCopyRules("Ótimo! 🎉 Vamos — juntos")).toBe("Ótimo. Vamos, juntos");
  });

  it("is none with no kind of case", () => {
    expect(scriptOf({ ...ANSWER, tipos: [] })).toBeNull();
    expect(scriptOf(null)).toBeNull();
  });

  it("makes a key from a name", () => {
    expect(keyOf("", "Guarda de filhos")).toBe("guarda_de_filhos");
    expect(keyOf("Já-Feito", "x")).toBe("ja_feito");
    expect(keyOf("", "?")).toBe("item_x");
  });
});

describe("the triage's texts", () => {
  const script = scriptOf(ANSWER)!;

  it("numbers the options of each question, and of the kind of case with another subject", () => {
    expect(typeQuestionText(script, "Família")).toContain(
      "1. Divórcio consensual\n2. Pensão alimentícia\n3. Outro assunto",
    );
    expect(scriptQuestionText(script.perguntas[0]!)).toBe(
      "Há bens a dividir?\n1. Não\n2. Sim, no exterior\nResponda com o número.",
    );
  });

  it("says the firm's words on a refusal and on its fees, and ONE's kind refusal where the firm wrote none", () => {
    expect(refusalText(script, "Família")).toContain("não vai poder cuidar deste caso de Família");
    expect(refusalText({ ...script, recusa: "Não cuidamos disso." }, "Família")).toBe("Não cuidamos disso.");
    expect(areaOfferText(script)).toContain("Cobramos 30%");
    expect(areaOfferText(script)).toContain("1. Quero seguir\n2. Tenho dúvidas\n3. Agora não");
  });

  it("writes the conversations of example with the very texts ONE sends, by the firm's table", () => {
    const [goes, ends] = exampleConversations(script, "Família");
    expect(goes!.mensagens.at(-1)!.texto).toBe(areaOfferText(script));
    expect(goes!.mensagens).toContainEqual({ quem: "one", texto: scriptQuestionText(script.perguntas[0]!) });
    // The first question with an answer that ends the triage: here the one a person decides.
    expect(ends!.titulo).toBe("Um caso que uma pessoa decide");
    // And what the table decides for those answers is what the example ends with.
    const verdict = triageVerdict(triageScriptOf(script), {
      type: "divorcio",
      answers: { bens: "exterior", cidade: "sim" },
    });
    expect(verdict.outcome).toBe("person");
  });
});
