import type { CaseState } from "../case-types";
import FilingCard from "./filing-card";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "@flyee/content/messages/pt-BR.json";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";

// The card "Protocolo" in the order of the owner's canvas of 2026-11-24 ("Cartões do caso, antes e depois"): what
// holds the package first, its state never "Pronto para protocolar" while something holds it, the files and the ficha
// after, and what is rare in the lawsuit's "⋯". Every name and number here is invented.

vi.mock("server-only", () => ({}));
vi.mock("@/lib/cases/filing-actions", () => ({
  attachFilingReceipt: vi.fn(),
  cancelFilingPackage: vi.fn(),
  openFilingFile: vi.fn(),
  openFilingReceipt: vi.fn(),
  requestFilingByOne: vi.fn(),
  requestFilingPackage: vi.fn(),
  requestPackageSignature: vi.fn(),
  retryFilingByOne: vi.fn(),
}));
vi.mock("@/lib/cases/actions", () => ({ openCaseFile: vi.fn(async () => ({ ok: false, code: "unavailable" })) }));
vi.mock("@/lib/cases/prefill-browser", () => ({ sendForReading: vi.fn(), dropUnsaved: vi.fn() }));
vi.mock("@/lib/filing-ways/actions", () => ({ readMyFilingWays: vi.fn(async () => null) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

type Ready = Extract<CaseState, { kind: "ready" }>;

const PROCEEDING = {
  id: "p0000000-0000-4000-8000-000000000001",
  kind: "juizado",
  court: "TJSP",
  comarca: "São Paulo",
  unit: null,
  unitByOne: false,
  unitTable: null,
  system: "eproc",
  cnj: null,
  forumBasis: "domicile",
  forumReason: null,
  forumCity: null,
  comarcaChecked: true,
  status: "planned",
  filedAt: null,
  systemByOne: true,
  systemApproval: { by: null, at: "2026-11-20T12:00:00Z" },
  systemRefusal: null,
  createdByOne: true,
  parties: [],
  lawyers: [],
};

const PETITION = "d0000000-0000-4000-8000-000000000001";
const IDENTITY = "d0000000-0000-4000-8000-000000000002";

/** The court's screen of the eproc of TJSP, which refuses a claimant with no e-mail and mobile (0283). */
const sheetOf = (email: string | null) => ({
  packageId: "k0000000-0000-4000-8000-000000000001",
  kind: "juizado",
  court: "TJSP",
  courtState: "SP",
  system: "eproc",
  screen: {
    key: "eproc-tjsp",
    name: "eproc do TJSP",
    host: "eproc1g.tjsp.jus.br",
    loginKind: "password_app",
    asksContact: true,
  },
  comarca: "São Paulo",
  unit: null,
  incident: "delay",
  valueCents: null,
  codes: { class: 436, subject: 7780, moral: 10433 },
  claimants: [
    {
      partyId: "a0000000-0000-4000-8000-000000000001",
      name: "Marina Alves Pereira",
      cpf: "52998224725",
      birthDate: "1988-03-14",
      street: "Rua das Flores",
      number: "100",
      complement: null,
      district: "Centro",
      city: "São Paulo",
      state: "SP",
      zip: "01001000",
      email,
      phone: "11987654321",
      freeJustice: null,
      guardian: null,
    },
  ],
  defendant: {
    name: "Linhas Aéreas Exemplo S.A.",
    cnpj: "11444777000161",
    address: "Avenida Exemplo, 1, São Paulo, SP",
  },
  lawyers: [],
});

const filingOf = (email: string | null) => ({
  id: "k0000000-0000-4000-8000-000000000001",
  proceedingId: PROCEEDING.id,
  court: "TJSP",
  system: "eproc",
  kind: "juizado",
  status: "ready",
  petitionDocumentId: PETITION,
  documentIds: [IDENTITY],
  limitBytes: 11 * 1024 * 1024,
  limitConfirmed: false,
  petitionLimitBytes: null,
  problems: [],
  error: null,
  requestedLabel: "24/11/2026",
  requestedAt: "2026-11-24T12:00:00Z",
  slow: false,
  items: [
    {
      id: "i1",
      position: 1,
      name: "01-peticao-inicial.pdf",
      bytes: 120_000,
      pages: 4,
      documentId: PETITION,
      part: 1,
      parts: 1,
      signed: false,
    },
    {
      id: "i2",
      position: 2,
      name: "02-documento-de-identidade-marina-alves-pereira.pdf",
      bytes: 3_200_000,
      pages: 1,
      documentId: IDENTITY,
      part: 1,
      parts: 1,
      signed: false,
    },
  ],
  receipt: null,
  blocker: null,
  signature: { takesSigned: false, status: null },
  byOne: null,
  sheet: sheetOf(email),
});

const stateOf = (email: string | null, approvedAuto: boolean, filing: Record<string, unknown> = {}) =>
  ({
    kind: "ready",
    today: "2026-11-24",
    case: { id: "c0000000-0000-4000-8000-000000000001", status: "drafting", createdAt: "2026-11-20T20:21:16Z" },
    proceedings: [PROCEEDING],
    filings: [{ ...filingOf(email), ...filing }],
    documents: [
      {
        id: PETITION,
        kind: "petition",
        partyId: null,
        status: "accepted",
        rejectedReason: null,
        source: "firm",
        fileId: "f0000000-0000-4000-8000-000000000001",
        name: "peticao.pdf",
        createdAt: "2026-11-23T21:15:15Z",
        envelopeId: null,
        pdf: true,
        normalizedFileId: null,
      },
      {
        id: IDENTITY,
        kind: "identity",
        partyId: "a0000000-0000-4000-8000-000000000001",
        status: "accepted",
        rejectedReason: null,
        source: "client",
        fileId: "f0000000-0000-4000-8000-000000000002",
        name: "identidade.jpg",
        createdAt: "2026-11-22T10:00:00Z",
        envelopeId: null,
        pdf: false,
        normalizedFileId: "f0000000-0000-4000-8000-000000000003",
      },
    ],
    parties: [],
    courtSystems: [],
    signatureAhead: [],
    pieces: { drafts: approvedAuto ? [{ id: "r1", documentId: PETITION, approvedAuto: true }] : [] },
    team: [],
    managesFirm: true,
    lawyer: true,
    partner: true,
    supportVisit: false,
  }) as unknown as Ready;

afterEach(cleanup);

const draw = (state: Ready) => {
  render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <FilingCard state={state} writable onChanged={() => {}} />
    </NextIntlClientProvider>,
  );
  // The card opens on its head when something there asks the firm.
  const head = screen.queryByRole("button", { name: /Protocolo/ });
  if (head && head.getAttribute("aria-expanded") === "false") fireEvent.click(head);
};

describe("the card Protocolo, in the order of the owner's canvas (2026-11-24)", () => {
  it("says a package the court's screen cannot take yet is held, and what holds it first", { timeout: 60_000 }, () => {
    draw(stateOf(null, true));
    // Never "Pronto para protocolar" while the e-mail the court's screen asks is missing.
    expect(screen.queryByText("Pronto para protocolar")).toBeNull();
    expect(screen.getAllByText("Com impedimento").length).toBeGreaterThan(0);
    // What holds it, with its way to where it is completed, and the petition ONE approved alone, to read.
    expect(screen.getByText(/Falta no caso o e-mail de Marina Alves Pereira/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "Completar em Pessoas" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ler a petição" })).toBeTruthy();
    // The files, by what each is, under the package's own heading.
    expect(screen.getByRole("heading", { name: "Pacote · 2 arquivos" })).toBeTruthy();
    expect(screen.getByText("Documento de identidade")).toBeTruthy();
    // The ficha's step that lacks the value says which; the missing line is not said again inside the ficha.
    expect(screen.getByText("Falta o e-mail")).toBeTruthy();
    expect(screen.getAllByText(/Falta no caso o e-mail/).length).toBe(1);
  });

  it("never hands ONE's batch a package the court's screen cannot take yet (0288)", { timeout: 60_000 }, () => {
    const viewer = "u0000000-0000-4000-8000-000000000001";
    // Ana files on the eproc by ONE's browser: a package nothing holds waits for her batch on /protocolo.
    const byOne = (blocker: string) => ({
      byOne: {
        channel: null,
        blocker,
        mode: "auto",
        submission: null,
        screen: {
          key: "eproc-tjsp",
          name: "eproc do TJSP",
          ways: ["browser", "extension"],
          firmWay: "browser",
          lawyers: [{ userId: viewer, way: "browser" }],
          viewerId: viewer,
        },
      },
    });
    draw(stateOf("marina@exemplo.com.br", false, byOne("no_channel")));
    expect(screen.getByText(/num lote que você aprova em Protocolo/)).toBeTruthy();
    cleanup();
    // The e-mail the eproc asks is missing: what holds it is said, and no batch is offered for it.
    draw(stateOf(null, false, { ...byOne("contact_missing"), held: "contact_missing" }));
    expect(screen.queryByText(/num lote que você aprova em Protocolo/)).toBeNull();
    expect(screen.queryByText(/falta a liberação do tribunal/)).toBeNull();
    expect(screen.getByText(/Falta no caso o e-mail de Marina Alves Pereira/)).toBeTruthy();
  });

  it("keeps building again and cancelling in the lawsuit's menu", { timeout: 60_000 }, () => {
    draw(stateOf("marina@exemplo.com.br", false));
    expect(screen.getAllByText("Pronto para protocolar").length).toBeGreaterThan(0);
    expect(screen.queryByText("Com impedimento")).toBeNull();
    expect(screen.queryByRole("button", { name: "Montar de novo" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Mais ações do pacote: Juizado especial cível" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getByText("Montar de novo")).toBeTruthy();
    expect(within(menu).getByText("Cancelar pacote")).toBeTruthy();
  });
});
