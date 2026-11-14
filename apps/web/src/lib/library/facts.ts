import "server-only";

import { momentLabel } from "@/lib/ai/approvals";
import { isModelDocument, isPieceDocument, type ModelDocument, sourceLabel } from "@/lib/cases/drafts";
import { type ImportLimits, importLimitsOf, type LibraryImport, readLibraryImports } from "@/lib/library/import-read";
import { type AttorneyPowers, attorneyPowers } from "@/lib/library/powers";
import {
  citationGap,
  distinctCitations,
  extractCitations,
  isCovered,
  LIBRARY_KINDS,
  type SourceKind,
} from "@flyee/knowledge/citations";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What the screen of the library reads (migrations 0029 and 0045), under the
 * person's own session: the sources a lawyer of the firm checked and the ones
 * the platform checked, the firm's models of pieces and the platform's, which
 * model ONE writes each kind of piece from and which paper it sends clients
 * to sign (0054: a power of attorney, a fee contract), and what each model of a piece cites that
 * neither library answers for yet (read from the model's text by the same
 * reader that reads a draft). A read that fails throws: a screen shows an
 * error, never an empty library.
 */

/** A source of the library, as the screen lists it. */
export type LibrarySource = {
  id: string;
  kind: SourceKind;
  /** How it is written in a piece so that it is read back into this very source. */
  citation: string;
  title: string;
  quote: string | null;
  sourceUrl: string;
  note: string | null;
  status: "verified" | "retired";
  /** Checked by ONE, for every firm (0045): read here, kept by the operator. */
  platform: boolean;
  verifiedBy: string | null;
  /** When it was checked, for the list to order by. */
  verifiedAt: string;
  verifiedLabel: string;
  retiredReason: string | null;
  retiredLabel: string | null;
};

/** A source a model cites that the library does not answer for. */
export type MissingSource = {
  key: string;
  /** The source by its own name, however the model writes it: what the dialog that adds it starts from. */
  label: string;
  /** The words as the model writes it. */
  raw: string;
  /** Why nobody can check it as the model writes it (an article with no norm, a súmula of nobody): the model changes. */
  gap: ReturnType<typeof citationGap>;
  /** The models that cite it. */
  templates: string[];
};

/** A model of the firm, as the screen lists it. */
export type LibraryTemplate = {
  id: string;
  name: string;
  /** What it writes (0054): the piece of a lawsuit, a power of attorney or a fee contract. */
  documentKind: ModelDocument;
  /** The kind of lawsuit a piece is written for; a paper serves every lawsuit. */
  proceedingKind: "juizado" | "comum" | null;
  /** The kind of problem a petition was written for (0244, `cases.incident`); null when it serves every problem. */
  problem: string | null;
  /** The kind of piece a model of the process writes (0244, `piece_kinds`), and its name. */
  pieceKind: string | null;
  pieceKindName: string | null;
  /** The default of its kind: the firm's, or the platform's (0039, 0045). */
  isDefault: boolean;
  /** A model of the platform (0045): read here, copied to be changed, kept by the operator. */
  platform: boolean;
  /** A model of the platform the curator has not reviewed yet. */
  provisional: boolean;
  /** ONE writes the pieces of some kind from it now (`draft_template_for`), or sends it to clients to sign (`paper_template_for`). */
  usedByOne: boolean;
  /** ONE saved it from a document the firm sent, and no person of the firm saved it since (0079): ONE may err. */
  preparedByOne: boolean;
  /** When it last changed, for the list to order by. */
  updatedAt: string;
  updatedLabel: string;
  updatedBy: string | null;
  /** How many distinct sources its text cites, and how many of them the library does not answer for: a paper's none, since no gate reads it. */
  cited: number;
  missing: number;
};

/**
 * The uses ONE writes or sends a model for, in the order "Com que modelo o ONE escreve" shows them (the owner,
 * 2026-11-13: nobody could tell at a glance which model ONE writes each piece and each paper from).
 */
export const MODEL_USES = [
  { key: "piece-juizado", documentKind: "piece", proceedingKind: "juizado" },
  { key: "piece-comum", documentKind: "piece", proceedingKind: "comum" },
  { key: "procuracao", documentKind: "procuracao", proceedingKind: null },
  { key: "contrato", documentKind: "contrato", proceedingKind: null },
  { key: "declaracao_residencia", documentKind: "declaracao_residencia", proceedingKind: null },
  { key: "declaracao_hipossuficiencia", documentKind: "declaracao_hipossuficiencia", proceedingKind: null },
] as const satisfies readonly {
  key: string;
  documentKind: ModelDocument;
  proceedingKind: "juizado" | "comum" | null;
}[];
export type ModelUseKey = (typeof MODEL_USES)[number]["key"];

/** One use and the model ONE takes for it now (as `draft_template_for` and `paper_template_for` decide), or none. */
export type ModelUse = {
  key: ModelUseKey;
  documentKind: ModelDocument;
  proceedingKind: "juizado" | "comum" | null;
  template: { id: string; name: string; platform: boolean } | null;
  /** Of a petition, the firm's models ONE takes first for the cases of a problem (0244), by problem. */
  byProblem: { problem: string; template: { id: string; name: string } }[];
};

/** A kind of piece of the process (0189) and the firm's model ONE writes it from (0244), or none: the platform's. */
export type ProcessPiece = { slug: string; name: string; template: { id: string; name: string } | null };

export type LibraryData = {
  sources: LibrarySource[];
  templates: LibraryTemplate[];
  /** Which model ONE takes for each use now. */
  uses: ModelUse[];
  /** The pieces of the process ONE writes, in their order, each with the firm's model of it (0244). */
  processPieces: ProcessPiece[];
  missing: MissingSource[];
  /** How many models a firm keeps, as the setting says. */
  maxTemplates: number;
  /** What ONE prepares or prepared from a document the firm sent (0067): none for who does not write models. */
  imports: LibraryImport[];
  /** What may be sent for a model, as the setting says. */
  importLimits: ImportLimits;
};

type SourceRow = {
  id: string;
  kind: string;
  key: string;
  citation: string;
  title: string;
  quote: string | null;
  source_url: string;
  note: string | null;
  status: string;
  org_id: string | null;
  verified_by: string | null;
  verified_at: string;
  retired_at: string | null;
  retired_reason: string | null;
};

type TemplateRow = {
  id: string;
  org_id: string | null;
  provisional: boolean | null;
  prepared_by_one: boolean | null;
  name: string;
  document_kind: string | null;
  proceeding_kind: string | null;
  problem?: string | null;
  piece_kind?: string | null;
  is_default: boolean | null;
  body: string;
  updated_by: string | null;
  updated_at: string;
};

type ModelRow = {
  id: string;
  org_id: string | null;
  document_kind?: string | null;
  proceeding_kind: string | null;
  /** Of a petition, the problem it was written for (0244); a row read before said none. */
  problem?: string | null;
  /** Of a model of the process, its kind of piece (0244). */
  piece_kind?: string | null;
  is_default: boolean | null;
};

/** What a row writes: a row read before 0054 said nothing of it, and wrote a piece. */
const documentOf = (row: { document_kind?: string | null }): ModelDocument =>
  isModelDocument(row.document_kind) ? row.document_kind : "piece";

type TeamRow = { user_id: string; display_name: string | null; email: string | null };

const isLibraryKind = (value: unknown): value is SourceKind => (LIBRARY_KINDS as readonly unknown[]).includes(value);

/** How many sources one request reads: under what the API hands back at once. */
const PAGE = 500;
/** How many pages a library is read in at most: a firm's library is thousands of sources, never millions. */
const MOST_PAGES = 40;

/**
 * Every source of the firm and of the platform, read in pages: the API hands back a thousand rows at most, and a
 * library read short would show verified sources as missing.
 */
async function readSources(supabase: SupabaseClient, firmId: string): Promise<SourceRow[]> {
  const rows: SourceRow[] = [];
  for (let page = 0; page < MOST_PAGES; page += 1) {
    const { data, error } = await supabase
      .from("legal_sources")
      .select(
        "id, org_id, kind, key, citation, title, quote, source_url, note, status, verified_by, verified_at, retired_at, retired_reason",
      )
      .or(`org_id.eq.${firmId},org_id.is.null`)
      .order("kind")
      .order("number")
      .order("id")
      .range(page * PAGE, page * PAGE + PAGE - 1);
    if (error) throw new Error("the library could not be read");
    rows.push(...((data ?? []) as SourceRow[]));
    if ((data ?? []).length < PAGE) return rows;
  }
  throw new Error("the library is larger than a screen reads");
}

/**
 * The model ONE writes the petition of a kind of lawsuit from, for a case of a problem, as `draft_template_for`
 * (0045, 0054, 0244) decides it, among the models that write a petition: a firm with petitions that serve the kind
 * and the problem keeps its rule (its default of the problem and the kind, else of the problem, else of the kind,
 * else of both, else its only one, else none), and a firm with none writes from the platform's default. A petition
 * of another problem is never taken.
 */
export function modelForKind(
  rows: readonly ModelRow[],
  firmId: string,
  kind: "juizado" | "comum",
  problem: string | null = null,
): string | null {
  const pieces = rows.filter((t) => documentOf(t) === "piece");
  const firm = pieces.filter(
    (t) =>
      t.org_id === firmId &&
      (t.proceeding_kind === kind || t.proceeding_kind === null) &&
      (!t.problem || t.problem === problem),
  );
  if (firm.length > 0) {
    const of = (process: string | null, matter: string | null) =>
      firm.find((t) => t.is_default === true && t.proceeding_kind === process && (t.problem || null) === matter)?.id;
    return (
      (problem ? (of(kind, problem) ?? of(null, problem)) : undefined) ??
      of(kind, null) ??
      of(null, null) ??
      (firm.length === 1 ? firm[0].id : null)
    );
  }
  const platform = pieces.filter((t) => t.org_id === null && t.is_default === true);
  return (
    platform.find((t) => t.proceeding_kind === kind)?.id ?? platform.find((t) => t.proceeding_kind === null)?.id ?? null
  );
}

/**
 * The firm's model ONE writes a piece of the process of a kind from, in a lawsuit of a kind, as
 * `piece_template_for` (0244) decides it: its default of the piece for the kind of lawsuit, else for both, else its
 * only one that serves the lawsuit, else none (ONE writes it from the platform's model of the piece).
 */
export function pieceModelFor(
  rows: readonly ModelRow[],
  firmId: string,
  piece: string,
  kind: "juizado" | "comum",
): string | null {
  const firm = rows.filter(
    (t) =>
      t.org_id === firmId &&
      documentOf(t) === "peca_processo" &&
      t.piece_kind === piece &&
      (t.proceeding_kind === kind || t.proceeding_kind === null),
  );
  return (
    firm.find((t) => t.is_default === true && t.proceeding_kind === kind)?.id ??
    firm.find((t) => t.is_default === true && t.proceeding_kind === null)?.id ??
    (firm.length === 1 ? firm[0].id : null)
  );
}

/**
 * The model ONE sends clients a paper of from, as `paper_template_for` (0054) decides it: a firm with models of
 * the paper keeps its rule (its default, else its only one, else none); a firm with none sends the platform's
 * power of attorney, and no contract at all (the fees are each firm's).
 */
export function paperModelFor(
  rows: readonly ModelRow[],
  firmId: string,
  kind: "procuracao" | "contrato" | "declaracao_residencia" | "declaracao_hipossuficiencia",
): string | null {
  const firm = rows.filter((t) => t.org_id === firmId && documentOf(t) === kind);
  if (firm.length > 0) {
    return firm.find((t) => t.is_default === true)?.id ?? (firm.length === 1 ? firm[0].id : null);
  }
  // The platform has a power of attorney and the declarations (0123, 0125), never a contract: the fees are each firm's.
  if (kind === "contrato") return null;
  return rows.find((t) => t.org_id === null && documentOf(t) === kind && t.is_default === true)?.id ?? null;
}

/** A paper a client signs, as the firm's setup offers it (0054). */
export type SetupPaper = {
  /** The model ONE sends now: the firm's own, or the platform's power of attorney; null when it sends none. */
  used: LibraryTemplate | null;
  /** The platform's model a firm's own starts from: the power of attorney; none of a contract. */
  platform: LibraryTemplate | null;
  /** The name of the firm's default of it, which a new default takes the place of. */
  firmDefault: string | null;
  /**
   * Of a power of attorney, the special powers its text writes (CPC, art. 105), as ONE read them: null for a contract.
   */
  powers: AttorneyPowers | null;
};

type PaperRow = ModelRow & {
  body?: string | null;
  provisional: boolean | null;
  prepared_by_one: boolean | null;
  name: string;
  updated_at: string;
};

/**
 * The papers a client signs as the firm's setup offers them: which model ONE
 * sends of each (`paperModelFor`, as `paper_template_for` decides it), the
 * platform's model a firm's own starts from, and the firm's default a new one
 * takes the place of. Null when they could not be read: the step says so,
 * never that nothing is sent.
 */
export async function loadSetupPapers(
  supabase: SupabaseClient,
  firmId: string,
  timeZone: string | null | undefined,
): Promise<{ procuracao: SetupPaper; contrato: SetupPaper } | null> {
  const { data, error } = await supabase
    .from("draft_templates")
    .select(
      "id, org_id, provisional, prepared_by_one, name, document_kind, proceeding_kind, is_default, updated_at, body",
    )
    .or(`org_id.eq.${firmId},org_id.is.null`)
    .in("document_kind", ["procuracao", "contrato"])
    .order("name");
  if (error) return null;
  const rows = (data ?? []) as PaperRow[];
  const view = (row: PaperRow, used: boolean): LibraryTemplate => ({
    id: row.id,
    name: row.name,
    documentKind: documentOf(row),
    proceedingKind: null,
    problem: null,
    pieceKind: null,
    pieceKindName: null,
    isDefault: row.is_default === true,
    platform: row.org_id === null,
    provisional: row.org_id === null && row.provisional === true,
    usedByOne: used,
    preparedByOne: row.org_id !== null && row.prepared_by_one === true,
    updatedAt: row.updated_at,
    updatedLabel: momentLabel(row.updated_at, timeZone),
    updatedBy: null,
    cited: 0,
    missing: 0,
  });
  const paper = (kind: "procuracao" | "contrato"): SetupPaper => {
    const usedId = paperModelFor(rows, firmId, kind);
    const used = rows.find((row) => row.id === usedId) ?? null;
    const platform =
      rows.find((row) => row.org_id === null && documentOf(row) === kind && row.is_default === true) ?? null;
    const firmDefault =
      rows.find((row) => row.org_id === firmId && documentOf(row) === kind && row.is_default === true) ?? null;
    return {
      used: used ? view(used, true) : null,
      platform: platform ? view(platform, platform.id === usedId) : null,
      firmDefault: firmDefault?.name ?? null,
      powers: kind === "procuracao" && used ? attorneyPowers(used.body ?? "") : null,
    };
  };
  return { procuracao: paper("procuracao"), contrato: paper("contrato") };
}

export async function loadLibrary(
  supabase: SupabaseClient,
  firmId: string,
  timeZone: string | null | undefined,
): Promise<LibraryData> {
  const [sourceRows, templates, team, settings, importSetting, kinds] = await Promise.all([
    readSources(supabase, firmId),
    supabase
      .from("draft_templates")
      .select(
        "id, org_id, provisional, prepared_by_one, name, document_kind, proceeding_kind, problem, piece_kind, is_default, body, updated_by, updated_at",
      )
      .or(`org_id.eq.${firmId},org_id.is.null`)
      .order("name"),
    supabase.rpc("firm_team", { target_org: firmId }),
    supabase.from("platform_settings").select("value").eq("key", "drafts").maybeSingle(),
    supabase.from("platform_settings").select("value").eq("key", "template_imports").maybeSingle(),
    supabase.from("piece_kinds").select("slug, name").order("position"),
  ]);
  if (templates.error || team.error || kinds.error) throw new Error("the library could not be read");
  const pieceKinds = (kinds.data ?? []) as { slug: string; name: string }[];
  const pieceName = new Map(pieceKinds.map((kind) => [kind.slug, kind.name]));

  const names = new Map(
    ((team.data ?? []) as TeamRow[]).map((person) => [
      person.user_id,
      person.display_name?.trim() || person.email?.split("@")[0] || "",
    ]),
  );
  const imports = await readLibraryImports(supabase, firmId, names, timeZone);
  const verified = new Set(sourceRows.filter((source) => source.status === "verified").map((source) => source.key));

  const templateRows = ((templates.data ?? []) as TemplateRow[])
    // The firm's own first, then the platform's.
    .sort((a, b) => Number(a.org_id === null) - Number(b.org_id === null) || a.name.localeCompare(b.name));
  const usedBy: Record<ModelUseKey, string | null> = {
    "piece-juizado": modelForKind(templateRows, firmId, "juizado"),
    "piece-comum": modelForKind(templateRows, firmId, "comum"),
    procuracao: paperModelFor(templateRows, firmId, "procuracao"),
    contrato: paperModelFor(templateRows, firmId, "contrato"),
    declaracao_residencia: paperModelFor(templateRows, firmId, "declaracao_residencia"),
    declaracao_hipossuficiencia: paperModelFor(templateRows, firmId, "declaracao_hipossuficiencia"),
  };
  // The problems the firm wrote petitions for, and the model ONE takes first for the cases of each (0244).
  const problems = [
    ...new Set(
      templateRows.flatMap((row) =>
        row.org_id === firmId && documentOf(row) === "piece" && row.problem ? [row.problem] : [],
      ),
    ),
  ];
  const byProblem = (kind: "juizado" | "comum") =>
    problems.flatMap((problem) => {
      const row = templateRows.find((template) => template.id === modelForKind(templateRows, firmId, kind, problem));
      // Only a problem with a model of its own: its other cases go to the use's model.
      return row && row.problem === problem ? [{ problem, template: { id: row.id, name: row.name } }] : [];
    });
  const processPieces: ProcessPiece[] = pieceKinds.map((kind) => {
    const id =
      pieceModelFor(templateRows, firmId, kind.slug, "juizado") ??
      pieceModelFor(templateRows, firmId, kind.slug, "comum");
    const row = templateRows.find((template) => template.id === id);
    return { slug: kind.slug, name: kind.name, template: row ? { id: row.id, name: row.name } : null };
  });
  const used = new Set(
    [
      ...Object.values(usedBy),
      ...(["juizado", "comum"] as const).flatMap((kind) => [
        ...byProblem(kind).map((item) => item.template.id),
        ...pieceKinds.map((piece) => pieceModelFor(templateRows, firmId, piece.slug, kind)),
      ]),
    ].filter((id): id is string => id !== null),
  );
  const uses: ModelUse[] = MODEL_USES.map((use) => {
    const row = templateRows.find((template) => template.id === usedBy[use.key]);
    return {
      ...use,
      template: row ? { id: row.id, name: row.name, platform: row.org_id === null } : null,
      byProblem: use.documentKind === "piece" && use.proceedingKind ? byProblem(use.proceedingKind) : [],
    };
  });

  const missing = new Map<string, MissingSource>();
  const templateList: LibraryTemplate[] = templateRows.map((template) => {
    const documentKind = documentOf(template);
    // What a paper cites is no piece's: no gate reads it, and the library is not asked for it.
    const cited = isPieceDocument(documentKind) ? distinctCitations(extractCitations(template.body)) : [];
    const outside = cited.filter((citation) => !isCovered(citation, verified));
    for (const citation of outside) {
      const known = missing.get(citation.key);
      if (known) known.templates.push(template.name);
      else {
        const raw = citation.raw.slice(0, 300);
        missing.set(citation.key, {
          key: citation.key,
          label: sourceLabel(citation, raw),
          raw,
          gap: citationGap(citation),
          templates: [template.name],
        });
      }
    }
    return {
      id: template.id,
      name: template.name,
      documentKind,
      proceedingKind:
        template.proceeding_kind === "juizado" || template.proceeding_kind === "comum"
          ? template.proceeding_kind
          : null,
      problem: documentKind === "piece" ? (template.problem ?? null) : null,
      pieceKind: documentKind === "peca_processo" ? (template.piece_kind ?? null) : null,
      pieceKindName:
        documentKind === "peca_processo" && template.piece_kind ? (pieceName.get(template.piece_kind) ?? null) : null,
      isDefault: template.is_default === true,
      platform: template.org_id === null,
      provisional: template.org_id === null && template.provisional === true,
      usedByOne: used.has(template.id),
      preparedByOne: template.org_id !== null && template.prepared_by_one === true,
      updatedAt: template.updated_at,
      updatedLabel: momentLabel(template.updated_at, timeZone),
      // Who of the platform wrote a model of the platform is the operator's, never the firm's to read.
      updatedBy: template.org_id !== null && template.updated_by ? names.get(template.updated_by) || null : null,
      cited: cited.length,
      missing: outside.length,
    };
  });

  const configured = Number((settings.data?.value as Record<string, unknown> | null | undefined)?.max_templates);
  return {
    sources: sourceRows.flatMap((source) =>
      isLibraryKind(source.kind) &&
      (source.status === "verified" || (source.status === "retired" && source.org_id !== null))
        ? [
            {
              id: source.id,
              kind: source.kind,
              citation: source.citation,
              title: source.title,
              quote: source.quote,
              sourceUrl: source.source_url,
              note: source.note,
              status: source.status,
              platform: source.org_id === null,
              verifiedBy: source.org_id !== null && source.verified_by ? names.get(source.verified_by) || null : null,
              verifiedAt: source.verified_at,
              verifiedLabel: momentLabel(source.verified_at, timeZone),
              retiredReason: source.retired_reason,
              retiredLabel: source.retired_at ? momentLabel(source.retired_at, timeZone) : null,
            } satisfies LibrarySource,
          ]
        : [],
    ),
    templates: templateList,
    uses,
    processPieces,
    missing: [...missing.values()],
    maxTemplates: Number.isFinite(configured) && configured > 0 ? configured : 40,
    imports,
    importLimits: importLimitsOf(importSetting.data?.value),
  };
}
