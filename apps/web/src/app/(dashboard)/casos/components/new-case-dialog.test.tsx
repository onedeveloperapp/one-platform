import NewCaseDialog from "./new-case-dialog";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "@flyee/content/messages/pt-BR.json";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// A case opened by hand (0292): of an area of the firm, with the kind its script lists and nothing of a flight; and
// from a person's page, the case theirs and nothing of them asked again. Its documents: the identity, the proof of
// address and the trip's (0293: a day printed without its year is asked, never supposed). Every name and id here is
// invented.

vi.mock("server-only", () => ({}));

type Created = { ok: true; code: string; caseId: string; seq: number; partyId: string | null };
const created: Created = {
  ok: true,
  code: "created",
  caseId: "c0000000-0000-4000-8000-000000000001",
  seq: 7,
  partyId: null,
};
type Open = (input: Record<string, unknown>) => Promise<Created>;
const createCase = vi.fn<Open>(async () => created);
const createAreaCase = vi.fn<Open>(async () => created);
vi.mock("@/lib/cases/actions", () => ({
  createCase: (input: Record<string, unknown>) => createCase(input),
  createAreaCase: (input: Record<string, unknown>) => createAreaCase(input),
  finishCaseUpload: (input: Record<string, unknown>) => finishCaseUpload(input),
}));
type Join = (input: Record<string, unknown>) => Promise<{ ok: boolean; code: string }>;
const finishCaseUpload = vi.fn<Join>(async () => ({ ok: true, code: "saved" }));
type Read = (file: File, slot: string) => Promise<{ ok: true; fileId: string; output: unknown }>;
const sendForReading = vi.fn<Read>();
type Keep = (file: File) => Promise<{ ok: true; fileId: string }>;
const sendForKeeping = vi.fn<Keep>(async () => ({ ok: true, fileId: "f0000000-0000-4000-8000-000000000009" }));
vi.mock("@/lib/cases/prefill-browser", () => ({
  sendForReading: (file: File, slot: string) => sendForReading(file, slot),
  sendForKeeping: (file: File) => sendForKeeping(file),
  dropUnsaved: vi.fn(),
}));

/** What ONE reads of each document the panel sends. */
const READINGS: Record<string, unknown> = {
  address_proof: {
    confere_tipo: "sim",
    legivel: true,
    tipo_identificado: "conta de luz",
    dados_lidos: { cep: "74000000", logradouro: "Rua Um", numero: "10", bairro: "Centro", cidade: "Goiânia", uf: "GO" },
    trechos: [],
  },
  // Azul's boarding pass, a screenshot of its app: the day and the month, never the year.
  ticket: {
    confere_tipo: "sim",
    legivel: true,
    tipo_identificado: "cartão de embarque",
    dados_lidos: {},
    trechos: [{ voo: "AD 4530", origem: "VCP", destino: "JTC", saida_prevista: "", dia_mes_saida: "22/10" }],
  },
};

function send(dialog: HTMLElement, title: string) {
  const slot = within(dialog).getByRole("listitem", { name: title });
  const input = slot.querySelector('input[type="file"]') as HTMLInputElement;
  fireEvent.change(input, { target: { files: [new File(["x"], "documento.png", { type: "image/png" })] } });
}

const FAMILY = {
  id: "a0000000-0000-4000-8000-000000000001",
  name: "Família e sucessões",
  types: [
    { key: "divorcio", name: "Divórcio consensual" },
    { key: "guarda", name: "Guarda dos filhos" },
  ],
};
const RITA = { id: "b0000000-0000-4000-8000-000000000001", name: "Rita Moraes Lima" };

function open(props: Partial<Parameters<typeof NewCaseDialog>[0]> = {}) {
  const onCreated = vi.fn();
  render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <NewCaseDialog airlines={[]} onClose={vi.fn()} onCreated={onCreated} {...props} />
    </NextIntlClientProvider>,
  );
  return { dialog: screen.getByRole("dialog"), onCreated };
}

function choose(label: RegExp, option: string) {
  fireEvent.mouseDown(screen.getByRole("combobox", { name: label }));
  fireEvent.click(within(screen.getByRole("listbox")).getByRole("option", { name: option }));
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.useRealTimers();
});

// The first render of a dialog pays MUI's warm-up, which a slow machine takes past the default five seconds.
describe("a case opened by hand", { timeout: 60_000 }, () => {
  it("of an area of the firm: the identity and the proof of address, the kind of case, and no flight", async () => {
    const { dialog, onCreated } = open({ areas: [FAMILY] });
    // The firm has the module and an area: the panel asks first what the case is of.
    expect(within(dialog).queryByText("Documento da viagem")).toBeNull();
    choose(/De que é o caso/, "Família e sucessões");
    expect(within(dialog).getByText("Identidade do cliente")).toBeTruthy();
    expect(within(dialog).getByText("Comprovante de endereço")).toBeTruthy();
    expect(within(dialog).queryByText("Documento da viagem")).toBeNull();

    fireEvent.click(within(dialog).getByRole("button", { name: "Preencher à mão" }));
    expect(within(dialog).queryByRole("combobox", { name: /Companhia aérea/ })).toBeNull();
    choose(/Tipo de caso/, "Guarda dos filhos");
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Nome/ }), { target: { value: "Lara Gomes Dias" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Abrir caso" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created.caseId));
    expect(createCase).not.toHaveBeenCalled();
    expect(createAreaCase).toHaveBeenCalledWith(
      expect.objectContaining({ areaId: FAMILY.id, caseType: "guarda", personId: null }),
    );
    expect(createAreaCase.mock.calls[0][0].client).toMatchObject({ full_name: "Lara Gomes Dias" });
  });

  it("asks the kind of case before opening it", async () => {
    const { dialog } = open({ areas: [FAMILY] });
    choose(/De que é o caso/, "Família e sucessões");
    fireEvent.click(within(dialog).getByRole("button", { name: "Preencher à mão" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Abrir caso" }));
    expect(await within(dialog).findByText("Escolha o tipo de caso.")).toBeTruthy();
    expect(createAreaCase).not.toHaveBeenCalled();
  });

  it("from a person's page: the trip's document only, and the client is that person", async () => {
    const { dialog, onCreated } = open({ person: RITA });
    // Only the module: nothing to choose, and the person's identity is not asked again.
    expect(within(dialog).queryByRole("combobox", { name: /De que é o caso/ })).toBeNull();
    expect(within(dialog).queryByText("Identidade do cliente")).toBeNull();
    expect(within(dialog).queryByText("Comprovante de endereço")).toBeNull();
    expect(within(dialog).getByText("Documento da viagem")).toBeTruthy();

    fireEvent.click(within(dialog).getByRole("button", { name: "Preencher à mão" }));
    expect(within(dialog).getByText(/O caso fica com Rita Moraes Lima/)).toBeTruthy();
    expect(within(dialog).queryByRole("textbox", { name: /Nome/ })).toBeNull();
    choose(/O que aconteceu/, "Atraso de voo");
    fireEvent.click(within(dialog).getByRole("button", { name: "Abrir caso" }));

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created.caseId));
    expect(createCase).toHaveBeenCalledWith(
      expect.objectContaining({ incident: "delay", personId: RITA.id, client: {} }),
    );
  });

  it("from a person's page, of an area: straight to the kind of case", async () => {
    const { dialog } = open({ person: RITA, areas: [FAMILY] });
    choose(/De que é o caso/, "Família e sucessões");
    // No document to send: the panel is the form.
    expect(within(dialog).queryByRole("button", { name: "Preencher à mão" })).toBeNull();
    choose(/Tipo de caso/, "Divórcio consensual");
    fireEvent.click(within(dialog).getByRole("button", { name: "Abrir caso" }));
    await waitFor(() =>
      expect(createAreaCase).toHaveBeenCalledWith(
        expect.objectContaining({ areaId: FAMILY.id, caseType: "divorcio", personId: RITA.id, client: {} }),
      ),
    );
  });

  it("reads the address from the proof, joins it to the client, and asks the day a ticket prints without its year", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-25T15:00:00Z"));
    sendForReading.mockImplementation(async (_file, slot) => ({
      ok: true,
      fileId: `f0000000-0000-4000-8000-00000000000${slot === "ticket" ? 2 : 1}`,
      output: READINGS[slot],
    }));
    const { dialog, onCreated } = open({ airlines: [{ iata: "AD", name: "Azul" }] });
    send(dialog, "Comprovante de endereço");
    send(dialog, "Documento da viagem");
    await waitFor(() => expect(within(dialog).getAllByText("Lido")).toHaveLength(2));
    fireEvent.click(within(dialog).getByRole("button", { name: "Conferir os dados" }));

    // The address read, for the person to confirm.
    expect((within(dialog).getByRole("textbox", { name: /Cidade/ }) as HTMLInputElement).value).toBe("Goiânia");
    // The day without its year: asked among this year and the one before, never supposed.
    expect(within(dialog).getByText("O bilhete traz o dia 22/10 sem o ano. Qual é o dia do voo?")).toBeTruthy();
    choose(/O que aconteceu/, "Atraso de voo");
    fireEvent.change(within(dialog).getByRole("textbox", { name: /Nome/ }), { target: { value: "Lara Gomes Dias" } });
    fireEvent.click(within(dialog).getByRole("button", { name: "Abrir caso" }));
    expect(await within(dialog).findByText("Escolha o dia do voo.")).toBeTruthy();
    expect(createCase).not.toHaveBeenCalled();

    expect(within(dialog).getByRole("radio", { name: "22/10/2026" })).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("radio", { name: "22/10/2025" }));
    fireEvent.click(within(dialog).getByRole("button", { name: "Abrir caso" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created.caseId));
    expect(createCase).toHaveBeenCalledWith(expect.objectContaining({ flightDate: "2025-10-22", airline: "AD" }));
    expect(createCase.mock.calls[0][0].client).toMatchObject({ city: "Goiânia", uf: "GO", postal_code: "74000000" });
    expect(finishCaseUpload.mock.calls.map(([input]) => input.kind)).toEqual(["address_proof", "ticket"]);
  });

  // 0294: a bill in somebody else's name asks what shows the client's link to its holder, kept for ONE to check.
  it("asks the document of the link when the proof of address is in somebody else's name", async () => {
    sendForReading.mockImplementation(async (_file, slot) => ({
      ok: true,
      fileId: "f0000000-0000-4000-8000-000000000001",
      output:
        slot === "identity"
          ? {
              confere_tipo: "sim",
              legivel: true,
              tipo_identificado: "RG",
              dados_lidos: { nome_completo: "Lia Teste", cpf: "52998224725" },
              trechos: [],
            }
          : { ...(READINGS.address_proof as object), nome_no_documento: "MARIA SOUZA TESTE" },
    }));
    const { dialog, onCreated } = open({ areas: [FAMILY] });
    choose(/De que é o caso/, "Família e sucessões");
    send(dialog, "Identidade do cliente");
    await waitFor(() => expect(within(dialog).getAllByText("Lido")).toHaveLength(1));
    expect(within(dialog).queryByText("Documento do vínculo")).toBeNull();
    send(dialog, "Comprovante de endereço");
    expect(await within(dialog).findByText("Documento do vínculo")).toBeTruthy();
    expect(within(dialog).getByText(/O comprovante está em nome de MARIA SOUZA TESTE/)).toBeTruthy();
    send(dialog, "Documento do vínculo");
    await waitFor(() => expect(sendForKeeping).toHaveBeenCalled());

    fireEvent.click(within(dialog).getByRole("button", { name: "Conferir os dados" }));
    choose(/Tipo de caso/, "Divórcio consensual");
    fireEvent.click(within(dialog).getByRole("button", { name: "Abrir caso" }));
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(created.caseId));
    expect(finishCaseUpload.mock.calls.map(([input]) => input.kind)).toEqual([
      "identity",
      "address_proof",
      "residence_link",
    ]);
  });
});
