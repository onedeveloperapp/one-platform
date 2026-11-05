// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  askMessage,
  interviewDoneMessage,
  interviewReadingOf,
  interviewRows,
  interviewViewOf,
  pendingQuestions,
  questionText,
  resumeWhat,
} from "@/lib/cases/interview";
import { INTERVIEW_QUESTIONS, type InterviewFacts } from "@flyee/rules/interview";

// Every person and flight here is invented.

const facts = (overrides: Partial<InterviewFacts> = {}): InterviewFacts => ({
  incident: "cancellation",
  alert: null,
  airlineCause: null,
  scheduledDeparture: "2026-09-20T21:30",
  scheduledArrival: "2026-09-21T00:45",
  actualArrival: null,
  companionsKnown: false,
  answers: {},
  ...overrides,
});

const row = {
  id: "11111111-1111-4111-8111-111111111111",
  case_id: "22222222-2222-4222-8222-222222222222",
  status: "open",
  current_question: "aviso_local",
  asked_at: "2026-11-04T19:00:00Z",
  asks: 1,
  first_name: "Ana",
  in_chat: true,
  incident: "cancellation",
  flight_date: "2026-09-20",
  alert: { kind: "cancelled", delay_minutes: null },
  airline_cause: null,
  scheduled_departure: "2026-09-20T21:30",
  scheduled_arrival: "2026-09-21T00:45",
  actual_arrival: null,
  companions_known: true,
  answers: {
    motivo: { status: "unknown", answer: null, words: "não sei", sim_nao: null, quando: null, source: "chat" },
    chegada: { status: "answered", answer: "Chegou no dia 21.", quando: "2026-09-21T09:40", source: "link" },
    compra: { status: "answered", answer: "Pagou R$ 2.000.", source: "chat" },
  },
};

describe("the interview as the app reads it (0095)", () => {
  it("reads the database's answer, leaving out what is not a question of the interview", () => {
    const view = interviewViewOf(row);
    expect(view?.status).toBe("open");
    expect(view?.currentQuestion).toBe("aviso_local");
    expect(view?.inChat).toBe(true);
    expect(view?.facts.alert).toEqual({ kind: "cancelled", delayMinutes: null });
    expect(view?.facts.companionsKnown).toBe(true);
    expect(Object.keys(view?.answers ?? {}).sort()).toEqual(["chegada", "motivo"]);
    expect(view?.facts.answers.chegada).toEqual({ status: "answered", yesNo: null, moment: "2026-09-21T09:40" });
    expect(interviewViewOf({ ...row, status: "lost" })).toBeNull();
  });

  it("asks only what the piece lacks, saying why first, once (0099)", () => {
    const view = interviewViewOf({ ...row, scope: ["gastos", "solucao", "compra"], current_question: null });
    expect(view?.facts.only).toEqual(["gastos", "solucao"]);
    expect(interviewViewOf(row)?.facts.only).toBeNull();
    const scoped = facts({ only: ["solucao", "gastos"] });
    expect(askMessage("solucao", scoped, "ask")).toBe(
      "Para terminar a sua ação, o escritório precisa de mais 2 respostas. Pergunta 1 de 2: O que a companhia ofereceu no lugar do voo: outro voo, o reembolso ou outro transporte? E você aceitou?",
    );
    expect(askMessage("chegada", facts({ only: ["chegada"] }), "ask")).toMatch(
      /^Para terminar a sua ação, o escritório precisa de mais uma resposta\. Pergunta 1 de 1:/,
    );
    const second = facts({ only: ["solucao", "gastos"], answers: { solucao: { status: "answered" } } });
    expect(askMessage("gastos", second, "ask")).toMatch(/^Pergunta 2 de 2: /);
    expect(askMessage("solucao", scoped, "ask")).not.toMatch(/[—–!]/);
    expect(resumeWhat(scoped)).toBe("2 respostas");
    expect(pendingQuestions(scoped, "solucao")).toEqual(["gastos"]);
  });

  it("asks each question in plain words, with no dash, exclamation or the purchase", () => {
    for (const question of INTERVIEW_QUESTIONS) {
      const said = questionText(question, facts());
      expect(said, question).not.toMatch(/[—–!]/);
      expect(said, question).not.toMatch(/compr(a|ou)|quanto pagou/i);
    }
    expect(questionText("aviso_local", facts())).toBe("Quando você soube do cancelamento, já estava no aeroporto?");
    expect(questionText("aviso_local", facts({ incident: "delay" }))).toContain("soube do atraso");
    // The assistance asked is what the wait was owed.
    expect(questionText("assistencia", facts({ actualArrival: "2026-09-21T03:00" }))).toBe(
      "Enquanto esperava, a companhia deu alimentação?",
    );
    expect(questionText("assistencia", facts())).toBe(
      "Enquanto esperava, a companhia deu alimentação, hotel e transporte até o hotel e de volta ao aeroporto?",
    );
  });

  it("says where a question is among the ones asked, and asks again with what it takes", () => {
    expect(askMessage("aviso_local", facts(), "ask")).toBe(
      "Pergunta 1 de 10: Quando você soube do cancelamento, já estava no aeroporto?",
    );
    expect(askMessage("aviso_local", facts(), "again")).toBe(
      "Não entendi a sua resposta. Quando você soube do cancelamento, já estava no aeroporto? Responda sim ou não. Se não lembrar, é só dizer que não lembra.",
    );
    expect(askMessage("chegada", facts(), "remind", "Ana")).toBe(
      "Ana, o escritório ainda precisa desta resposta para preparar a sua ação. Em que dia e a que horas você chegou de fato ao destino?",
    );
    expect(askMessage("chegada", facts(), "back")).toMatch(/^Voltando à pergunta 1 de 10: Em que dia/);
    for (const mode of ["ask", "again", "remind", "back"] as const) {
      expect(askMessage("motivo", facts(), mode, "Ana")).not.toMatch(/[—–!]/);
    }
    expect(interviewDoneMessage("Ana")).not.toMatch(/[—–!]/);
    expect(resumeWhat(facts())).toBe("10 respostas");
    expect(
      resumeWhat(
        facts({
          companionsKnown: true,
          answers: Object.fromEntries(
            INTERVIEW_QUESTIONS.filter((question) => question !== "bagagem").map((question) => [
              question,
              { status: "answered" as const },
            ]),
          ),
        }),
      ),
    ).toBe("uma resposta");
  });

  it("reads what the AI said of an answer, and nothing that is not its shape", () => {
    expect(
      interviewReadingOf({
        situacao: "respondida",
        resposta: "Já estava no aeroporto.",
        sim_nao: "sim",
        quando: "",
        outras: [
          { pergunta: "chegada", resposta: "Chegou às 9h40 do dia 21.", sim_nao: "nenhum", quando: "2026-09-21T09:40" },
          { pergunta: "compra", resposta: "Pagou R$ 2.000.", sim_nao: "nenhum", quando: "" },
          { pergunta: "motivo", resposta: "", sim_nao: "nenhum", quando: "" },
        ],
      }),
    ).toEqual({
      situation: "respondida",
      answer: "Já estava no aeroporto.",
      yesNo: "sim",
      when: null,
      others: [{ question: "chegada", answer: "Chegou às 9h40 do dia 21.", yesNo: null, when: "2026-09-21T09:40" }],
    });
    expect(interviewReadingOf({ situacao: "inventada" })).toBeNull();
    expect(interviewReadingOf(null)).toBeNull();
  });

  it("lists each question of the problem with where it stands, and why one was left out", () => {
    const view = interviewViewOf(row)!;
    const rows = interviewRows(view);
    expect(rows.map((item) => [item.question, item.state])).toEqual([
      ["aviso_local", "asked"],
      ["aviso_quando", "next"],
      ["motivo", "unknown"],
      ["solucao", "next"],
      ["chegada", "answered"],
      ["assistencia", "next"],
      ["gastos", "next"],
      ["consequencias", "next"],
      ["acompanhantes", "skipped"],
      ["bagagem", "next"],
    ]);
    expect(rows.find((item) => item.question === "acompanhantes")?.reason).toBe("companions_on_record");
  });
});
