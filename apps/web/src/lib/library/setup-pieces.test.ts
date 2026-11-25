import { describe, expect, it, vi } from "vitest";

import { type PieceRow, setupPiecesOf } from "@/lib/library/facts";
import { papersSavedAt, PIECE_USES, requestSettled } from "@/lib/library/imports";

vi.mock("server-only", () => ({}));

// Every model here is invented.
const FIRM = "f0000000-0000-4000-8000-000000000001";
const OTHER = "f0000000-0000-4000-8000-000000000002";
const KINDS = [
  { slug: "recurso", name: "Recurso inominado" },
  { slug: "replica", name: "Réplica" },
];

const row = (
  id: string,
  org: string | null,
  document: "piece" | "peca_processo",
  fields: Partial<PieceRow> = {},
): PieceRow => ({
  id,
  org_id: org,
  document_kind: document,
  proceeding_kind: null,
  problem: null,
  piece_kind: null,
  is_default: false,
  provisional: false,
  prepared_by_one: false,
  name: id,
  updated_at: "2026-11-25T12:00:00Z",
  ...fields,
});

const platform = [
  row("plataforma-juizado", null, "piece", { proceeding_kind: "juizado", is_default: true }),
  row("plataforma-comum", null, "piece", { proceeding_kind: "comum", is_default: true }),
];

describe("the pieces ONE writes, as the module's setup offers them (2026-11-25)", () => {
  it("writes from the platform's petitions while the firm has none of its own", () => {
    const pieces = setupPiecesOf(platform, KINDS, FIRM, null);
    expect(pieces.petitions.map((petition) => [petition.kind, petition.used?.id, petition.used?.platform])).toEqual([
      ["juizado", "plataforma-juizado", true],
      ["comum", "plataforma-comum", true],
    ]);
    expect(pieces.processOwn).toEqual([]);
    expect(pieces.firmModels).toEqual([]);
    expect(pieces.pieceKinds).toEqual(KINDS);
  });

  it("writes the petition of a kind from the firm's own, and keeps the platform's for the other", () => {
    const pieces = setupPiecesOf(
      [
        ...platform,
        row("escritorio-juizado", FIRM, "piece", {
          proceeding_kind: "juizado",
          is_default: true,
          prepared_by_one: true,
        }),
        // Another firm's petition is never this firm's.
        row("outro-comum", OTHER, "piece", { proceeding_kind: "comum", is_default: true }),
      ],
      KINDS,
      FIRM,
      null,
    );
    const [juizado, comum] = pieces.petitions;
    expect(juizado?.used).toMatchObject({ id: "escritorio-juizado", platform: false, preparedByOne: true });
    // The firm's petition of the juizado serves no lawsuit of the vara cível: ONE writes that one from the platform's.
    expect(comum?.used).toMatchObject({ id: "plataforma-comum", platform: true });
    expect(pieces.firmModels.map((model) => model.id)).toEqual(["escritorio-juizado"]);
  });

  it("lists the firm's petitions by problem apart, and its models of the pieces of the process", () => {
    const pieces = setupPiecesOf(
      [
        ...platform,
        row("geral", FIRM, "piece", { is_default: true }),
        row("atraso", FIRM, "piece", { problem: "delay", is_default: true }),
        row("recurso-do-escritorio", FIRM, "peca_processo", { piece_kind: "recurso", is_default: true }),
        row("plataforma-replica", null, "peca_processo", { piece_kind: "replica", is_default: true }),
      ],
      KINDS,
      FIRM,
      null,
    );
    for (const petition of pieces.petitions) {
      expect(petition.used?.id).toBe("geral");
      expect(petition.byProblem.map((model) => [model.id, model.problem])).toEqual([["atraso", "delay"]]);
    }
    expect(pieces.processOwn.map((model) => [model.id, model.pieceKindName])).toEqual([
      ["recurso-do-escritorio", "Recurso inominado"],
    ]);
  });

  it("hides a failed petition the firm answered with a model saved after it, and nothing of the papers", () => {
    const saved = papersSavedAt(
      [
        { document_kind: "piece", updated_at: "2026-11-25T12:00:00Z" },
        { document_kind: "procuracao", updated_at: "2026-11-25T13:00:00Z" },
      ],
      PIECE_USES,
    );
    expect(saved).toEqual({ piece: Date.parse("2026-11-25T12:00:00Z") });
    expect(
      requestSettled({ status: "failed", expected: "piece", sentAt: "2026-11-25T11:00:00Z" }, saved, PIECE_USES),
    ).toBe(true);
    expect(
      requestSettled({ status: "refused", expected: "piece", sentAt: "2026-11-25T12:30:00Z" }, saved, PIECE_USES),
    ).toBe(false);
    expect(
      requestSettled(
        { status: "failed", expected: "peca_processo", sentAt: "2026-11-25T11:00:00Z" },
        saved,
        PIECE_USES,
      ),
    ).toBe(false);
    // The papers keep their own rule: a petition saved after a failed power of attorney settles nothing.
    expect(requestSettled({ status: "failed", expected: "piece", sentAt: "2026-11-25T11:00:00Z" }, saved)).toBe(false);
  });
});
