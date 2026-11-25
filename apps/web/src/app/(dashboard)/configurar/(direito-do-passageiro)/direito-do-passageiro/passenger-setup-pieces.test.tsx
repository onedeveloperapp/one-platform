import PassengerPieces from "./passenger-setup-pieces";
import { NextIntlClientProvider } from "next-intl";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { LibraryTemplate, SetupPieces } from "@/lib/library/facts";
import type { PieceImport } from "@/lib/library/import-read";
import messages from "@flyee/content/messages/pt-BR.json";
import { cleanup, render, screen } from "@testing-library/react";

// The step "Peças" of the passenger module's setup (2026-11-25): each petition and the pieces of the process say the
// model ONE writes from now, with the one button to send the firm's own, and what ONE does with each document sent
// here is a line of its own. Every model and file here is invented.

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/library/actions", () => ({ readDraftTemplate: vi.fn() }));
vi.mock("@/lib/library/import-actions", () => ({ watchModelImports: vi.fn(async () => ({ ok: true, pending: [] })) }));
vi.mock("@/components/product/word-download-button", () => ({ default: () => null }));
vi.mock("../../../biblioteca/import-panel", () => ({ refusalWords: () => "O documento não é uma petição inicial." }));
vi.mock("../../../biblioteca/template-panel", () => ({ default: () => null, defaultSlot: () => "any" }));

afterEach(cleanup);

const model = (id: string, fields: Partial<LibraryTemplate> = {}): LibraryTemplate => ({
  id,
  name: id,
  documentKind: "piece",
  proceedingKind: null,
  problem: null,
  pieceKind: null,
  pieceKindName: null,
  isDefault: true,
  platform: false,
  provisional: false,
  usedByOne: true,
  preparedByOne: false,
  updatedAt: "2026-11-25T12:00:00Z",
  updatedLabel: "25/11 às 09:00",
  updatedBy: null,
  cited: 0,
  missing: 0,
  ...fields,
});

const KINDS = [
  { slug: "recurso", name: "Recurso inominado" },
  { slug: "replica", name: "Réplica" },
];

const platformOnly: SetupPieces = {
  petitions: [
    { kind: "juizado", used: model("Inicial do juizado da plataforma", { platform: true }), byProblem: [] },
    { kind: "comum", used: model("Inicial da vara cível da plataforma", { platform: true }), byProblem: [] },
  ],
  pieceKinds: KINDS,
  processOwn: [],
  firmModels: [],
};

function draw(input: { pieces: SetupPieces | null; imports?: PieceImport[]; writes?: boolean }) {
  return render(
    <NextIntlClientProvider locale="pt-BR" messages={messages} timeZone="America/Sao_Paulo">
      <PassengerPieces
        pieces={input.pieces}
        imports={input.imports ?? []}
        writes={input.writes ?? true}
        blocked={false}
        onRetry={vi.fn()}
      />
    </NextIntlClientProvider>,
  );
}

describe("the pieces ONE writes, in the passenger module's setup", () => {
  it("says ONE writes from the platform's models, and offers to send the firm's own", () => {
    draw({ pieces: platformOnly });
    expect(screen.getByText("Inicial do juizado")).toBeTruthy();
    expect(screen.getByText("Inicial da vara cível")).toBeTruthy();
    expect(screen.getAllByText("Pelo modelo da plataforma")).toHaveLength(2);
    expect(screen.getAllByRole("button", { name: "Enviar a do escritório" })).toHaveLength(2);
    expect(screen.getByText("Todas pelos modelos da plataforma")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enviar uma do escritório" })).toBeTruthy();
  });

  it("says a petition is the firm's, made by ONE, and the pieces of the process it has", () => {
    draw({
      pieces: {
        ...platformOnly,
        petitions: [
          { kind: "juizado", used: model("Inicial do escritório", { preparedByOne: true }), byProblem: [] },
          platformOnly.petitions[1]!,
        ],
        processOwn: [
          model("Recurso do escritório", {
            documentKind: "peca_processo",
            pieceKind: "recurso",
            pieceKindName: "Recurso inominado",
          }),
        ],
      },
    });
    expect(screen.getByText("Modelo do escritório, feito pelo ONE")).toBeTruthy();
    expect(screen.getByText("Inicial do escritório")).toBeTruthy();
    expect(screen.getByText("1 de 2 com modelo do escritório")).toBeTruthy();
    expect(screen.getAllByRole("button", { name: "Enviar outra" })).toHaveLength(2);
  });

  it("lists what ONE does with each document sent, the one at work and the one refused", () => {
    draw({
      pieces: platformOnly,
      imports: [
        { id: "i1", fileName: "inicial.docx", status: "marking", failure: null, refusal: null, expected: "piece" },
        {
          id: "i2",
          fileName: "contestacao.pdf",
          status: "refused",
          failure: null,
          refusal: null,
          expected: "piece",
        },
      ],
    });
    expect(screen.getByText("Enviadas ao ONE (2)")).toBeTruthy();
    expect(screen.getByText("O ONE está preparando o modelo a partir de inicial.docx.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Acompanhar" })).toBeTruthy();
    expect(screen.getByText("O documento não é uma petição inicial.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Enviar outro" })).toBeTruthy();
  });

  it("sends nothing for who does not write the models, and says a failed read as a failure", () => {
    draw({ pieces: null, writes: false });
    expect(screen.getByText("Os modelos são escritos por um sócio ou um advogado do escritório.")).toBeTruthy();
    expect(screen.getByText("Não foi possível ler os modelos das peças agora.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Enviar a do escritório" })).toBeNull();
  });
});
