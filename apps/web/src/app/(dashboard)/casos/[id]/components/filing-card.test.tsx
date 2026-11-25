import type { CaseState } from "../case-types";
import FilingCard from "./filing-card";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import messages from "@flyee/content/messages/pt-BR.json";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

// The receipt of a lawsuit filed before its case was in ONE (0286), as the lawyer attaches it on the case's card
// "Protocolo": the receipt read, its day before the case was opened, "Confirmar e anexar" asks first whether the lawsuit
// was filed before, and confirming attaches it with that word. Every number and name here is invented.

vi.mock("server-only", () => ({}));

/** What the card hands the server action, and what it answers. */
type Attach = (input: Record<string, unknown>) => Promise<{ ok: boolean; code: string; history?: boolean }>;
const attachFilingReceipt = vi.fn<Attach>(async () => ({ ok: true, code: "filed", history: true }));
vi.mock("@/lib/cases/filing-actions", () => ({
  attachFilingReceipt: (input: Record<string, unknown>) => attachFilingReceipt(input),
  cancelFilingPackage: vi.fn(),
  openFilingFile: vi.fn(),
  openFilingReceipt: vi.fn(),
  requestFilingByOne: vi.fn(),
  requestFilingPackage: vi.fn(),
  requestPackageSignature: vi.fn(),
  retryFilingByOne: vi.fn(),
}));
vi.mock("@/lib/cases/prefill-browser", () => ({
  sendForReading: vi.fn(async () => ({
    ok: true,
    fileId: "f0000000-0000-4000-8000-000000000001",
    output: {
      confere_tipo: "sim",
      legivel: true,
      numero_processo: "1000286-84.2099.8.26.0100",
      data_protocolo: "2026-10-01",
      tribunal: "TJSP",
      sistema: "eproc",
      orgao: "1º Juizado Especial Cível",
      classe: "",
      observacoes: "",
    },
  })),
  dropUnsaved: vi.fn(),
}));
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

const FILING = {
  id: "k0000000-0000-4000-8000-000000000001",
  proceedingId: PROCEEDING.id,
  court: "TJSP",
  system: "eproc",
  kind: "juizado",
  status: "ready",
  petitionDocumentId: "d0000000-0000-4000-8000-000000000001",
  documentIds: [],
  limitBytes: null,
  limitConfirmed: true,
  petitionLimitBytes: null,
  problems: [],
  error: null,
  requestedLabel: "20/11/2026",
  requestedAt: "2026-11-20T12:00:00Z",
  slow: false,
  items: [],
  receipt: null,
  blocker: null,
  signature: { takesSigned: false, status: null },
  byOne: null,
  sheet: null,
};

const state = {
  kind: "ready",
  today: "2026-11-24",
  case: { id: "c0000000-0000-4000-8000-000000000001", status: "drafting", createdAt: "2026-11-20T20:21:16.585+00:00" },
  proceedings: [PROCEEDING],
  filings: [FILING],
  documents: [
    {
      id: "d0000000-0000-4000-8000-000000000001",
      kind: "petition",
      partyId: null,
      status: "accepted",
      rejectedReason: null,
      source: "firm",
      fileId: "f0000000-0000-4000-8000-000000000009",
      name: "peticao.pdf",
      createdAt: "2026-11-23T21:15:15Z",
      envelopeId: null,
      pdf: true,
    },
  ],
  parties: [],
  courtSystems: [],
  signatureAhead: [],
  pieces: { drafts: [] },
  team: [],
  managesFirm: true,
  lawyer: true,
  partner: true,
  supportVisit: false,
} as unknown as Ready;

afterEach(() => {
  cleanup();
  attachFilingReceipt.mockClear();
});

const draw = () =>
  render(
    <NextIntlClientProvider locale="pt-BR" messages={messages}>
      <FilingCard state={state} writable onChanged={() => {}} />
    </NextIntlClientProvider>,
  );

/** The receipt sent and read: its day before the case was opened, and the line that says so. */
async function readReceipt() {
  draw();
  // The card opens on its head.
  const head = screen.queryByRole("button", { name: /Protocolo/ });
  if (head && head.getAttribute("aria-expanded") === "false") fireEvent.click(head);
  const slot = document.querySelector<HTMLInputElement>('input[type="file"]');
  expect(slot).not.toBeNull();
  await act(async () => {
    fireEvent.change(slot as HTMLInputElement, {
      target: { files: [new File(["%PDF-1.4"], "recibo.pdf", { type: "application/pdf" })] },
    });
  });
  await screen.findByText(/anterior à abertura do caso no ONE/, undefined, { timeout: 15_000 });
  // Read is not attached: the card says what is still owed, with its button (the owner stopped at "Lido", 2026-11-24).
  expect(screen.getByText(/O recibo ainda não está anexado/)).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Confirmar e anexar" }));
  const dialog = await screen.findByRole("dialog", undefined, { timeout: 15_000 });
  expect(within(dialog).getByText("A ação já tinha sido protocolada?")).toBeTruthy();
  await act(async () => {
    fireEvent.click(within(dialog).getByRole("button", { name: "Confirmar e anexar" }));
  });
}

describe("the receipt of a lawsuit filed before its case was in ONE (0286)", () => {
  it("asks whether the lawsuit was filed before, and attaches it with that word", { timeout: 60_000 }, async () => {
    await readReceipt();
    await waitFor(() => expect(attachFilingReceipt).toHaveBeenCalledTimes(1));
    expect(attachFilingReceipt.mock.calls[0][0]).toMatchObject({ filedOn: "2026-10-01", beforeOne: true });
    await waitFor(() => expect(screen.queryByText("A ação já tinha sido protocolada?")).toBeNull());
  });

  it("keeps the question open with why, when the receipt was not attached", { timeout: 60_000 }, async () => {
    // The owner's test of 2026-11-24: the card did not change and nothing said why.
    attachFilingReceipt.mockResolvedValueOnce({ ok: false, code: "filed_before_trip" });
    await readReceipt();
    // Said in the question, which stays open, and beside the button, where it stays once the question is closed.
    const dialog = await screen.findByRole("dialog", undefined, { timeout: 15_000 });
    await within(dialog).findByText(
      "O dia do protocolo é anterior ao voo do caso. Confira o dia no recibo.",
      undefined,
      {
        timeout: 15_000,
      },
    );
    expect(within(dialog).getByText("A ação já tinha sido protocolada?")).toBeTruthy();
  });
});
