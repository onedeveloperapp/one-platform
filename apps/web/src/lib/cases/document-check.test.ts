import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { promptDraftProblem, TASK_OUTPUT_KEYS } from "@/lib/admin/ai";
import {
  checkBriefing,
  decidedOutput,
  DOCUMENT_CHECK_TASK,
  isPassingFailure,
  localMoment,
  processingErrorKey,
  processingPlan,
  readCheckAnswer,
  sameOutput,
} from "@/lib/cases/document-check";
import messages from "@flyee/content/messages/pt-BR.json";

const ROOT = path.resolve(__dirname, "../../../../..");
const MIGRATION = fs.readFileSync(path.join(ROOT, "packages/db/migrations/0024_document_checks.sql"), "utf8");
const product = messages.product as Record<string, string>;

/** The task's schema as migration 0024 seeds it. */
const SEEDED_SCHEMA = (() => {
  const match = /\$schema\$([\s\S]*?)\$schema\$/.exec(MIGRATION);
  if (!match) throw new Error("schema not found in 0024");
  return JSON.parse(match[1]) as { required: string[]; properties: Record<string, unknown> };
})();

const answer = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  decisao: "aceitar",
  motivo: "",
  tipo_identificado: "bilhete",
  legivel: true,
  nome_no_documento: "Maria Teste",
  confere_com_a_pessoa: "sim",
  observacoes: "",
  trechos: [
    {
      voo: "G3 1234",
      origem: "gyn",
      destino: "GRU",
      saida_prevista: "2026-09-20T08:05",
      chegada_prevista: "2026-09-20T09:40",
      reserva: "abc123",
    },
  ],
  ...overrides,
});

describe("what happens to each document", () => {
  it("turns a photo into a PDF and lets the model read it reduced; reads a PDF as it is", () => {
    expect(processingPlan({ mime: "image/jpeg", wantsCheck: true })).toEqual({ normalize: true, check: "image" });
    expect(processingPlan({ mime: "image/heic", wantsCheck: true })).toEqual({ normalize: true, check: "image" });
    expect(processingPlan({ mime: "application/pdf", wantsCheck: true })).toEqual({
      normalize: false,
      check: "document",
    });
  });

  it("asks the AI only for the kinds the setting names, and normalizes the rest all the same", () => {
    expect(processingPlan({ mime: "image/png", wantsCheck: false })).toEqual({ normalize: true, check: null });
    expect(processingPlan({ mime: "application/pdf", wantsCheck: false })).toEqual({ normalize: false, check: null });
    expect(processingPlan({ mime: "video/mp4", wantsCheck: true })).toEqual({ normalize: false, check: null });
    expect(processingPlan({ mime: null, wantsCheck: true })).toEqual({ normalize: false, check: null });
  });
});

describe("what the model is told", () => {
  it("names the document, whose it is and the trip, in plain Portuguese and without a dash", () => {
    const text = checkBriefing({
      kind: "identity",
      personName: "Maria Teste",
      incident: "delay",
      airline: "Gol",
      flightDate: "2026-09-20",
    });
    expect(text).toContain("documento de identidade com foto");
    expect(text).toContain("Maria Teste");
    expect(text).toContain("atraso de voo, companhia Gol, voo em 20/09/2026");
    expect(text).not.toMatch(/[—–]/);
  });

  it("says when the document is the case's and the trip is not known yet", () => {
    const text = checkBriefing({ kind: "receipt", personName: null, incident: null, airline: null, flightDate: null });
    expect(text).toContain("não se aplica");
    expect(text).toContain("sem dados da viagem");
    expect(
      checkBriefing({ kind: "desconhecido", personName: null, incident: null, airline: null, flightDate: null }),
    ).toContain("outro documento do caso");
  });

  it("says what the rule measured of the photo, when it measured one, and never judges it", () => {
    const base = { kind: "identity", personName: "Maria Teste", incident: null, airline: null, flightDate: null };
    // Nothing measured (a PDF, a photo of what happened): nothing is said of a measure.
    expect(checkBriefing(base)).not.toContain("Medida da foto");
    expect(checkBriefing({ ...base, quality: null })).not.toContain("Medida da foto");
    // Measured with nothing against it.
    expect(checkBriefing({ ...base, quality: { problems: [], insisted: false } })).toContain(
      "Medida da foto: nada apontado em tamanho, nitidez e luz.",
    );
    // What keeps it from being read, in the rule's order, and that the client sent it all the same.
    const poor = checkBriefing({ ...base, quality: { problems: ["blurry", "too_dark"], insisted: true } });
    expect(poor).toContain("Medida da foto: tremida ou sem foco; escura.");
    expect(poor).toContain("O cliente foi avisado disso e enviou a foto assim mesmo.");
    expect(checkBriefing({ ...base, quality: { problems: ["too_small"], insisted: false } })).not.toContain(
      "assim mesmo",
    );
    // Before the request itself, which stays the last line.
    expect(poor.split(String.fromCharCode(10)).at(-1)).toBe("Confira o arquivo anexo e responda com o objeto pedido.");
    expect(poor).not.toMatch(/[—–!]/);
    // The instructions of the task say what the measure is.
    expect(MIGRATION).toContain("Quando o texto trouxer a medida da foto");
  });
});

describe("the answer", () => {
  it("asks the model for exactly the fields the code reads, and the console keeps them", () => {
    expect([...SEEDED_SCHEMA.required].sort()).toEqual([...TASK_OUTPUT_KEYS[DOCUMENT_CHECK_TASK]].sort());
    expect(Object.keys(SEEDED_SCHEMA.properties).sort()).toEqual([...TASK_OUTPUT_KEYS[DOCUMENT_CHECK_TASK]].sort());
  });

  it("is read back for the screens, and anything else is not an answer", () => {
    const read = readCheckAnswer(answer());
    expect(read?.decision).toBe("aceitar");
    expect(read?.legs).toEqual([
      {
        flight: "G3 1234",
        origin: "GYN",
        destination: "GRU",
        departure: "2026-09-20T08:05",
        arrival: "2026-09-20T09:40",
        booking: "ABC123",
      },
    ]);
    expect(readCheckAnswer(answer({ decisao: "talvez" }))).toBeNull();
    expect(readCheckAnswer(null)).toBeNull();
    expect(readCheckAnswer(answer({ confere_com_a_pessoa: "x", trechos: "nenhum" }))).toMatchObject({
      matches: "sem_nome",
      legs: [],
    });
  });

  it("becomes what the person decided, with the same fields, and is a correction only when it differs", () => {
    const model = answer();
    const kept = decidedOutput(model, { accept: true, keepLegs: true });
    expect(sameOutput(kept, model)).toBe(true);

    const withoutLegs = decidedOutput(model, { accept: true, keepLegs: false });
    expect(withoutLegs.trechos).toEqual([]);
    expect(sameOutput(withoutLegs, model)).toBe(false);

    const refused = decidedOutput(model, { accept: false, reason: "  A foto ficou escura.  " });
    expect(refused).toMatchObject({ decisao: "recusar", motivo: "A foto ficou escura.", trechos: model.trechos });
    expect(Object.keys(refused).sort()).toEqual(Object.keys(model).sort());

    // Agreeing with a refusal of a ticket is no correction, legs and all.
    const suggestedRefusal = answer({ decisao: "recusar", motivo: "Ilegível." });
    expect(sameOutput(decidedOutput(suggestedRefusal, { accept: false, reason: "Ilegível." }), suggestedRefusal)).toBe(
      true,
    );
    // Key order is not a difference.
    expect(sameOutput({ a: 1, b: [{ c: 1, d: 2 }] }, { b: [{ d: 2, c: 1 }], a: 1 })).toBe(true);
  });

  it("writes a moment as the ticket prints it", () => {
    expect(localMoment("2026-09-20T08:05")).toBe("20/09/2026 08:05");
    expect(localMoment("amanhã cedo")).toBe("amanhã cedo");
  });

  it("tries again only what may pass by itself", () => {
    expect(isPassingFailure("provider_unavailable")).toBe(true);
    expect(isPassingFailure("check_running")).toBe(true);
    expect(isPassingFailure("image_unreadable")).toBe(false);
    expect(isPassingFailure("provider_not_configured")).toBe(false);
    expect(isPassingFailure("output_truncated")).toBe(false);
  });

  it("has words for why a document was not checked", () => {
    for (const code of ["file_unreadable", "image_unreadable", "provider_not_configured", "anything_else", null]) {
      expect(product[processingErrorKey(code)], String(code)).toBeTruthy();
    }
  });
});

describe("the next version of a task's instructions", () => {
  const draft = {
    task: DOCUMENT_CHECK_TASK,
    provider: "anthropic",
    model: "claude-sonnet-5-5",
    effort: "low",
    systemPrompt: "Você confere arquivos de clientes e responde só com o objeto pedido.",
    outputSchema: JSON.stringify(SEEDED_SCHEMA),
    maxTokens: 4096,
    note: "Pede o localizador também no cartão de embarque.",
  };

  it("may be published when it keeps what the code reads and says why it changes", () => {
    expect(promptDraftProblem(draft)).toBeNull();
  });

  it("is refused field by field, before anything is sent", () => {
    expect(promptDraftProblem({ ...draft, provider: "outro" })?.field).toBe("provider");
    expect(promptDraftProblem({ ...draft, model: "" })?.field).toBe("model");
    expect(promptDraftProblem({ ...draft, effort: "extremo" })?.field).toBe("effort");
    expect(promptDraftProblem({ ...draft, maxTokens: 10 })?.field).toBe("maxTokens");
    expect(promptDraftProblem({ ...draft, systemPrompt: "curto" })?.field).toBe("systemPrompt");
    expect(promptDraftProblem({ ...draft, outputSchema: "{" })?.field).toBe("outputSchema");
    expect(promptDraftProblem({ ...draft, outputSchema: "[]" })?.field).toBe("outputSchema");
    expect(promptDraftProblem({ ...draft, note: "curta" })?.field).toBe("note");
  });

  it("never drops a field the code of the task reads", () => {
    const schema = structuredClone(SEEDED_SCHEMA);
    schema.required = schema.required.filter((key) => key !== "trechos");
    const problem = promptDraftProblem({ ...draft, outputSchema: JSON.stringify(schema) });
    expect(problem?.field).toBe("outputSchema");
    expect(problem?.message).toContain("trechos");
    // A task the code reads nothing of particular from only needs an object.
    expect(
      promptDraftProblem({
        ...draft,
        task: "outra.tarefa",
        outputSchema: JSON.stringify({ type: "object", properties: {} }),
      }),
    ).toBeNull();
  });
});
