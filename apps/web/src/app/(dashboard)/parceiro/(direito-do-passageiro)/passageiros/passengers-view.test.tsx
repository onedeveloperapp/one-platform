import PassengersView, { type PassengersData } from "./passengers-view";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import { listPassengers } from "@/modules/direito-do-passageiro/agency/actions";
import type { PaxPage, PaxRow } from "@/modules/direito-do-passageiro/agency/passengers";
import messages from "@flyee/content/messages/pt-BR.json";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("server-only", () => ({}));
vi.mock("@/modules/direito-do-passageiro/agency/actions", () => ({ listPassengers: vi.fn() }));
vi.mock("./components/new-passenger-dialog", () => ({ default: () => null }));
vi.mock("./components/clause-dialog", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

afterEach(cleanup);

/** Invented passengers of an invented agency. */
const row = (n: number): PaxRow => ({
  id: `f0000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  fullName: `Passageiro ${n} Teste`,
  cpf: null,
  birthDate: "1985-01-01",
  phone: null,
  guardianId: null,
  minor: false,
  consent: null,
  reagree: null,
  nextDeparture: null,
  handedOver: false,
  stage: "contact",
  kinds: [],
  reading: false,
});
const pageOf = (from: number, count: number, total: number): PaxPage => ({
  rows: Array.from({ length: count }, (_, index) => row(from + index + 1)),
  total,
});

const data = (page: PaxPage): PassengersData => ({
  firm: "Lima Advocacia",
  manager: true,
  overview: null,
  page,
  clause: { version: 1, body: "Cláusula de teste." },
  clauseRead: true,
});

const draw = (page: PaxPage) =>
  render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <PassengersView data={data(page)} />
    </NextIntlClientProvider>,
  );

describe("the agency's passengers, a page at a time", () => {
  it("a search starts at its first page, never at the page the agency was on", async () => {
    const asked = vi.mocked(listPassengers);
    asked.mockImplementation(async (query) => ({
      ok: true,
      code: "read",
      page: query.search ? pageOf(0, 3, 3) : pageOf(query.offset, 25, 60),
    }));
    draw(pageOf(0, 25, 60));
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() => expect(asked).toHaveBeenLastCalledWith({ filter: "all", search: "", offset: 25 }));
    fireEvent.change(screen.getByLabelText("Buscar por nome ou CPF"), { target: { value: "Passageiro" } });
    await waitFor(() => expect(asked).toHaveBeenLastCalledWith({ filter: "all", search: "Passageiro", offset: 0 }));
    await waitFor(() => expect(screen.getByText("Passageiro 3 Teste")).toBeTruthy());
    expect(screen.queryByText("Nenhum passageiro aqui")).toBeNull();
  });

  it("a page past the end of a list that got shorter is its last page, never an empty one", async () => {
    const asked = vi.mocked(listPassengers);
    asked.mockImplementation(async (query) => ({
      ok: true,
      code: "read",
      // Between the two reads the list went from 60 to 20: the second page has nothing any longer.
      page: query.offset >= 20 ? { rows: [], total: 20 } : pageOf(0, 20, 20),
    }));
    draw(pageOf(0, 25, 60));
    fireEvent.click(screen.getByRole("button", { name: "Próxima" }));
    await waitFor(() => expect(asked).toHaveBeenLastCalledWith({ filter: "all", search: "", offset: 0 }));
    await waitFor(() => expect(screen.getByText("Passageiro 20 Teste")).toBeTruthy());
    expect(screen.queryByText("Nenhum passageiro aqui")).toBeNull();
  });
});
