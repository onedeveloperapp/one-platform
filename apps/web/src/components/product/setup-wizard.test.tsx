import SetupWizard, { type WizardStep } from "./setup-wizard";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

// The owner, 2026-11-24: a "Salvar" beside "Continuar" let the person go on without saving, the steps were known only
// as "Passo 6 de 10", and leaving a step lost what was typed. "Continuar" saves the step and goes on, the list names
// every step, and going forward by the list saves first.

vi.setConfig({ testTimeout: 30_000 });

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${Object.values(values).join("|")}` : key,
}));
vi.mock("@/icons/nexture/ni-arrow-right", () => ({ default: () => null }));
vi.mock("@/icons/nexture/ni-check", () => ({ default: () => null }));

afterEach(cleanup);

function Flow({ steps }: { steps: WizardStep[] }) {
  const [index, setIndex] = useState(0);
  return <SetupWizard steps={steps} index={index} onIndexChange={setIndex} onComplete={() => undefined} />;
}

const named = (overrides: Partial<WizardStep>[] = []): WizardStep[] =>
  ["Segurança", "O escritório", "Canais"].map((label, i) => ({
    label,
    title: `Título ${label}`,
    content: <p>{`conteúdo ${label}`}</p>,
    ...overrides[i],
  }));

describe("SetupWizard with named steps", () => {
  it("lists every step by its name, marks the one open and what is done", () => {
    render(<Flow steps={named([{ done: true }])} />);
    const list = screen.getByRole("navigation", { name: "wizard-steps-label" });
    expect(list.textContent).toContain("Segurança");
    expect(list.textContent).toContain("O escritório");
    expect(list.textContent).toContain("Canais");
    expect(screen.getByRole("button", { name: /Segurança/ }).getAttribute("aria-current")).toBe("step");
    // On a narrow screen the next step is named over the card.
    expect(screen.getByText("wizard-step-next:1|3|O escritório")).toBeTruthy();
  });

  it("saves the step before going on by the list, and stays when it could not", async () => {
    const leave = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<Flow steps={named([{ onLeave: leave }])} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Canais/ }));
    });
    expect(leave).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("heading", { name: "Título Segurança" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Canais/ }));
    });
    expect(leave).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("heading", { name: "Título Canais" })).toBeTruthy();
  });

  it("goes back by the list without saving", async () => {
    const leave = vi.fn().mockResolvedValue(true);
    render(<Flow steps={named([{}, {}, { onLeave: leave }])} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Canais/ }));
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Segurança/ }));
    });
    expect(leave).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Título Segurança" })).toBeTruthy();
  });

  it("goes on with Continuar only once the step saved", async () => {
    const save = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    render(<Flow steps={named([{ onPrimary: save }])} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "continue" }));
    });
    expect(screen.getByRole("heading", { name: "Título Segurança" })).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "continue" }));
    });
    expect(screen.getByRole("heading", { name: "Título O escritório" })).toBeTruthy();
  });

  it("keeps the plain card when the steps have no names", () => {
    render(
      <Flow
        steps={[
          { title: "Um", content: <p>um</p> },
          { title: "Dois", content: <p>dois</p> },
        ]}
      />,
    );
    expect(screen.queryByRole("navigation")).toBeNull();
    expect(screen.getByText("wizardStep:1|2")).toBeTruthy();
  });
});
