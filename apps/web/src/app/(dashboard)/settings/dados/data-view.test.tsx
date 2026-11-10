import DataView, { type DataState } from "./data-view";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CLEAR_COUNT_KEYS, type ClearCounts } from "@/lib/firm/clear-data";
import messages from "@flyee/content/messages/pt-BR.json";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// "Dados do escritório" (migration 0161): what goes and what stays is said before anything is asked, the confirmation
// counts again, asks the second factor in place and the word typed, and what came of it is said in front of the person.

const refresh = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

const actions = vi.hoisted(() => ({ readClearPreview: vi.fn(), clearFirmData: vi.fn() }));
vi.mock("@/lib/firm/clear-data-actions", () => actions);

// The second factor's own flow talks to the auth provider; here it is only where it stands.
vi.mock("@/components/product/second-factor-prompt", () => ({
  default: ({ onConfirmed }: { onConfirmed: () => void }) => (
    <button type="button" onClick={onConfirmed}>
      confirmar segundo fator
    </button>
  ),
}));

const zero = Object.fromEntries(CLEAR_COUNT_KEYS.map((key) => [key, 0])) as ClearCounts;
const some: ClearCounts = { ...zero, cases: 3, people: 4, conversations: 2, agency_passengers: 2 };

const ready = (overrides: Partial<Extract<DataState, { kind: "ready" }>> = {}): DataState => ({
  kind: "ready",
  preview: { ok: true, counts: some, secondFactor: true },
  supportVisit: false,
  factor: "ok",
  ...overrides,
});

function Screen({ state }: { state: DataState }) {
  return (
    <NextIntlClientProvider locale="pt-BR" messages={messages} timeZone="America/Sao_Paulo">
      <DataView state={state} />
    </NextIntlClientProvider>
  );
}

const clearButton = () => screen.getByRole("button", { name: "Apagar casos e clientes" });

beforeEach(() => {
  actions.readClearPreview.mockResolvedValue({ ok: true, counts: some, secondFactor: true });
  actions.clearFirmData.mockResolvedValue({ ok: true, counts: some, files: 5 });
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// The confirmation is a dialog over the page: rendering it takes some seconds on a busy machine.
describe("clearing the firm's cases and clients", { timeout: 30_000 }, () => {
  it("says what goes, counted, and what stays before anything is asked", () => {
    render(<Screen state={ready()} />);
    expect(screen.getByText("O que sai")).toBeTruthy();
    expect(screen.getByText("Passageiros de teste da agência")).toBeTruthy();
    expect(screen.getByText("A biblioteca de modelos e fontes")).toBeTruthy();
    expect(clearButton().hasAttribute("disabled")).toBe(false);
  });

  it("clears only once the word is typed, and says what came of it", async () => {
    render(<Screen state={ready()} />);
    await act(async () => fireEvent.click(clearButton()));
    expect(actions.readClearPreview).toHaveBeenCalledOnce();
    expect(screen.getByText("3 casos, com os processos, documentos, peças e pacotes")).toBeTruthy();
    const confirm = screen.getByRole("button", { name: "Apagar tudo" });
    expect(confirm.hasAttribute("disabled")).toBe(true);
    fireEvent.change(screen.getByLabelText("Para confirmar, digite apagar"), { target: { value: " Apagar " } });
    expect(confirm.hasAttribute("disabled")).toBe(false);
    await act(async () => fireEvent.click(confirm));
    expect(actions.clearFirmData).toHaveBeenCalledWith(" Apagar ");
    expect(screen.getByText("Casos e clientes apagados")).toBeTruthy();
    expect(screen.getByText("3 casos e 4 clientes saíram, com o que havia neles")).toBeTruthy();
  });

  it("keeps the button off while the second factor is owed, and asks it in place", async () => {
    render(<Screen state={ready({ factor: "challenge" })} />);
    await act(async () => fireEvent.click(clearButton()));
    const word = () => screen.getByLabelText("Para confirmar, digite apagar") as HTMLInputElement;
    const confirm = () => screen.getByRole("button", { name: "Apagar tudo" });
    expect(word().disabled).toBe(true);
    expect(confirm().hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "confirmar segundo fator" }));
    expect(word().disabled).toBe(false);
    fireEvent.change(word(), { target: { value: "apagar" } });
    expect(confirm().hasAttribute("disabled")).toBe(false);
  });

  it("says a firm with nothing to clear has nothing, with no button", () => {
    render(<Screen state={ready({ preview: { ok: true, counts: zero, secondFactor: true } })} />);
    expect(screen.getAllByText("Nada para apagar").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Apagar casos e clientes" })).toBeNull();
  });

  it("tells somebody who does not decide for the firm whose it is", () => {
    render(<Screen state={ready({ preview: { ok: false, code: "not_allowed" } })} />);
    expect(screen.getByText(/Só quem decide pelo escritório apaga os casos e clientes/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Apagar casos e clientes" })).toBeNull();
  });

  it("clears nothing in a support visit", () => {
    render(<Screen state={ready({ supportVisit: true })} />);
    expect(screen.getByText("Numa visita de suporte nada do escritório é apagado.")).toBeTruthy();
    expect(clearButton().hasAttribute("disabled")).toBe(true);
  });
});
