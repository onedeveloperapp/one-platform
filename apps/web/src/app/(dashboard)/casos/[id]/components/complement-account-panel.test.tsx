import type { CaseState } from "../case-types";
import ComplementAccountPanel from "./complement-account-panel";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import { interviewViewOf, openInterviewQuestions } from "@/lib/cases/interview";
import messages from "@flyee/content/messages/pt-BR.json";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// What the client's account left out, answered by the firm with what the client told it (the owner, 2026-11-25).
// Every person and flight here is invented.

vi.mock("server-only", () => ({}));
const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));
type Answer = (caseId: string, question: string, text: string | null) => Promise<{ ok: boolean; code: string }>;
const answerInterviewQuestion = vi.fn<Answer>(async () => ({ ok: true, code: "saved" }));
type Complete = (caseId: string, statementId: string, text: string) => Promise<{ ok: boolean; code: string }>;
const completeStatement = vi.fn<Complete>(async () => ({ ok: true, code: "sent" }));
vi.mock("@/lib/cases/statement-actions", () => ({
  answerInterviewQuestion: (caseId: string, question: string, text: string | null) =>
    answerInterviewQuestion(caseId, question, text),
  completeStatement: (caseId: string, statementId: string, text: string) =>
    completeStatement(caseId, statementId, text),
}));

type Ready = Extract<CaseState, { kind: "ready" }>;
const CASE_ID = "22222222-2222-4222-8222-222222222222";

/** A cancellation's interview, open on its first question, with what the client already answered. */
const interview = interviewViewOf({
  id: "11111111-1111-4111-8111-111111111111",
  case_id: CASE_ID,
  status: "open",
  current_question: "aviso_local",
  asked_at: "2026-11-04T19:00:00Z",
  asks: 1,
  first_name: "Ana",
  in_chat: false,
  incident: "cancellation",
  flight_date: "2026-09-20",
  alert: { kind: "cancelled", delay_minutes: null },
  airline_cause: null,
  scheduled_departure: "2026-09-20T21:30",
  scheduled_arrival: "2026-09-21T00:45",
  actual_arrival: null,
  companions_known: true,
  answers: {
    chegada: { status: "answered", answer: "Chegou no dia 21.", quando: "2026-09-21T09:40", source: "link" },
  },
});
const state = { case: { id: CASE_ID }, interview, statements: [] } as unknown as Ready;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("complementing the client's account", { timeout: 60_000 }, () => {
  it("asks only the questions still open, and saves the ones the firm answered", async () => {
    const open = openInterviewQuestions(state.interview);
    expect(open.length).toBeGreaterThan(1);
    expect(open).not.toContain("chegada");

    const onClose = vi.fn();
    render(
      <NextIntlClientProvider locale="pt-BR" messages={messages}>
        <ComplementAccountPanel state={state} onClose={onClose} />
      </NextIntlClientProvider>,
    );
    const panel = screen.getByRole("dialog");
    // Nothing typed is no answer: the panel says so and saves nothing.
    fireEvent.click(within(panel).getByRole("button", { name: "Salvar respostas" }));
    expect(await within(panel).findByText("Escreva pelo menos uma resposta.")).toBeTruthy();
    expect(answerInterviewQuestion).not.toHaveBeenCalled();

    const fields = within(panel).getAllByRole("textbox");
    expect(fields).toHaveLength(open.length);
    fireEvent.change(fields[0], { target: { value: "Soube no aeroporto, no balcão da companhia." } });
    fireEvent.click(within(panel).getByRole("button", { name: "Salvar respostas" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(answerInterviewQuestion).toHaveBeenCalledTimes(1);
    expect(answerInterviewQuestion).toHaveBeenCalledWith(
      CASE_ID,
      open[0],
      "Soube no aeroporto, no balcão da companhia.",
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("has nothing to ask once the interview is no longer open", () => {
    expect(openInterviewQuestions(interview ? { ...interview, status: "done" } : null)).toEqual([]);
    expect(openInterviewQuestions(null)).toEqual([]);
  });

  // Before the interview (a case opened by hand, the owner's case 19): the questions the account's order of the facts
  // asked, answered together, join that account as the client's answer on the link does (0297).
  it("answers the questions an account asked, joined to that account", async () => {
    const account = {
      id: "33333333-3333-4333-8333-333333333333",
      chronologyStatus: "approved",
      missingTopics: ["assistencia", "gastos"],
      questions: ["A companhia deu alimentação?", "Você teve algum gasto?"],
      clientAdded: null,
      receivedLabel: "25/11/2026 16:41",
    };
    const onClose = vi.fn();
    render(
      <NextIntlClientProvider locale="pt-BR" messages={messages}>
        <ComplementAccountPanel
          state={{ case: { id: CASE_ID }, interview: null, statements: [account] } as unknown as Ready}
          onClose={onClose}
        />
      </NextIntlClientProvider>,
    );
    const panel = screen.getByRole("dialog");
    fireEvent.change(within(panel).getByRole("textbox", { name: "Você teve algum gasto?" }), {
      target: { value: "Gastou R$ 50 com lanche." },
    });
    fireEvent.click(within(panel).getByRole("button", { name: "Salvar respostas" }));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(answerInterviewQuestion).not.toHaveBeenCalled();
    expect(completeStatement).toHaveBeenCalledWith(
      CASE_ID,
      account.id,
      "Você teve algum gasto?\nGastou R$ 50 com lanche.",
    );
  });
});
