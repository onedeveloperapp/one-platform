import "server-only";

import { momentLabel } from "@/lib/ai/approvals";
import { type CitedSource, type DraftStatus, isDraftStatus, sourceOfRow } from "@/lib/cases/drafts";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What the case screen reads of the pieces of a case and of its dossiers
 * (migration 0029), under the person's own session: the drafts of each
 * lawsuit, the latest text of the ones still to be worked on, what that text
 * cites and whether the firm's verified library answers for each source (as
 * the database itself reads it, `case_draft_sources`: the screen shows what
 * the gate reads, whatever the size of the library), the firm's most alike
 * pieces, the models a draft may be asked from, and the dossiers issued. A
 * read that fails throws: a screen shows an error, never a case with no
 * piece.
 */

/** A draft of a lawsuit, as the case shows it. */
export type CaseDraft = {
  id: string;
  proceedingId: string;
  templateName: string;
  status: DraftStatus;
  /** What the backend still owes it. */
  work: "generate" | "revise" | "check" | "issue" | null;
  /** A work owed for long enough that a job should have done it by now. */
  slow: boolean;
  version: number;
  /** The citations of the latest version were read. */
  checked: boolean;
  /** The latest text, while the draft is still to be edited or approved. */
  body: string | null;
  /** The AI's text (its first, or one it rewrote) still waits in the firm's queue: approving the draft decides it. */
  aiWaits: boolean;
  /**
   * The text of the AI's that waits: the version it is, and whether the AI rewrote it as a lawyer asked (turned
   * down, a rewriting leaves the text there was before it; a first text turned down is a draft rejected).
   */
  aiAnswer: { version: number; rewriting: boolean } | null;
  /**
   * What the AI said a lawyer should check or complete, of the latest text of its own the draft carries (for
   * a rewriting, what it changed too): kept beside that version, with the words each mark stood for put back.
   */
  notes: string[];
  /**
   * The text was sent back to the AI: what the lawyer asked to change, who asked and when. `failed` once the
   * rewriting could not be made, and the request waits for a person to put it back to work or to give it up.
   */
  revision: { note: string; by: string | null; atLabel: string | null; failed: boolean } | null;
  /** How many more times the text may be sent back to the AI. */
  revisionsLeft: number;
  /** Who wrote the latest text, and what it answers when the AI rewrote it as a lawyer asked. */
  latest: {
    author: "ai" | "template" | "person";
    /** What the AI was asked to change, and by whom. */
    note: string | null;
    askedBy: string | null;
    /** The version it was written on. */
    basedOn: number | null;
    /** The text before a rewriting, put back by who turned the rewriting down. */
    restored: boolean;
    /** The text of the version it was written on, when the AI rewrote it: what the change is read against. */
    before: string | null;
  } | null;
  /** The sources the latest text cites, the ones outside the verified library first. */
  sources: CitedSource[];
  /** The firm's most alike pieces of other cases, as measured when the text was last read. */
  alike: { draftId: string; caseId: string; caseSeq: number | null; percent: number }[];
  approvedLabel: string | null;
  approvedBy: string | null;
  /** Approved by ONE, where the firm lets it (0016, `piece_text`). */
  approvedAuto: boolean;
  /** The petition its approved text became, once issued. */
  documentId: string | null;
  requestedLabel: string;
  requestedBy: string | null;
  /** Asked for by ONE itself, where the firm lets it (0039, `start_piece`). */
  requestedAuto: boolean;
  /**
   * What ONE is doing with a text it carries (0099, 0100): `asking` the client what it lacks, or `rewriting` it with
   * the client's answers; null when it waits for a lawyer as before.
   */
  oneRedo: "asking" | "rewriting" | null;
  /** When it last changed: the day a draft given up was given up. */
  updatedLabel: string;
  /** The kind of piece: `inicial`, or an intermediate piece of a lawsuit the court has (0189). */
  pieceKind: string;
  /** What an intermediate piece carries besides its text (0189): ONE's recommendation, the decision, its filing. */
  piece: {
    recommendation: "file" | "hold" | null;
    recommendationReason: string | null;
    waitsFor: "defense" | null;
    decision: "file" | "hold" | null;
    decisionReason: string | null;
    decidedBy: string | null;
    decidedLabel: string | null;
    filingStatus: "owed" | "sent" | "filed" | "refused" | "failed" | "unknown" | null;
    filingMessage: string | null;
    filedLabel: string | null;
    filedHow: "one" | "lawyer" | null;
    filedProtocol: string | null;
    receiptFileId: string | null;
    fromPublication: boolean;
  } | null;
};

/** A model of the firm a draft may be asked from. */
export type TemplateChoice = { id: string; name: string; proceedingKind: "juizado" | "comum" | null };

/** A dossier of the case, as issued. */
export type CaseDossier = {
  id: string;
  status: "requested" | "issued" | "failed";
  verifyCode: string | null;
  issuedLabel: string | null;
  requestedLabel: string;
  /** When it was asked for, in milliseconds: one asked for long ago and never finished is not on its way. */
  requestedAt: number;
  /** What it holds, by counts. */
  summary: Record<string, number>;
};

export type CasePieces = {
  /** Every draft of the case, the latest first. */
  drafts: CaseDraft[];
  /** The kinds of intermediate piece a person may ask for (0189), in order. */
  pieceKinds: { slug: string; name: string }[];
  /** What keeps ONE from filing each intermediate piece issued, by its id (null: ONE files it). */
  pieceFilings: Record<string, string | null>;
  templates: TemplateChoice[];
  /** From how alike on (in a hundred) the screen calls attention to a piece. */
  alikeAttention: number;
  /** The longest text the AI rewrites whole, in characters: a longer one is changed by hand, said before anybody asks. */
  maxRevisionChars: number;
  dossiers: CaseDossier[];
};

type DraftRow = {
  id: string;
  piece_kind: string | null;
  recommendation: string | null;
  recommendation_reason: string | null;
  waits_for: string | null;
  decision: string | null;
  decision_reason: string | null;
  decided_by: string | null;
  decided_at: string | null;
  filing_status: string | null;
  filing_message: string | null;
  filed_at: string | null;
  filed_how: string | null;
  filed_protocol: string | null;
  receipt_file_id: string | null;
  publication_id: string | null;
  proceeding_id: string;
  template_name: string;
  status: string;
  work: string | null;
  run_id: string | null;
  version: number;
  checked_version: number | null;
  revision_note: string | null;
  revision_by: string | null;
  revision_at: string | null;
  revisions: number;
  alike: unknown;
  approved_at: string | null;
  approved_auto: boolean | null;
  document_id: string | null;
  approved_by: string | null;
  requested_by: string | null;
  requested_auto: boolean | null;
  requested_at: string;
  updated_at: string;
};

const DRAFT_COLUMNS =
  "id, piece_kind, recommendation, recommendation_reason, waits_for, decision, decision_reason, decided_by, decided_at, filing_status, filing_message, filed_at, filed_how, filed_protocol, receipt_file_id, publication_id, proceeding_id, template_name, status, work, run_id, version, checked_version, revision_note, revision_by, revision_at, revisions, alike, approved_at, approved_by, approved_auto, document_id, requested_by, requested_auto, requested_at, updated_at";

/** How long a work may be owed before the screen says a job is late. */
const SLOW_MINUTES = 8;
/** From how alike on the screen calls attention, when the setting does not say. */
const ALIKE_ATTENTION = 80;
/** How many times a text may be sent back to the AI, when the setting does not say. */
const MAX_REVISIONS = 8;
/** The longest text the AI rewrites whole, when the setting does not say; and the least the database takes the setting for. */
const MAX_REVISION_CHARS = 24_000;
const MIN_REVISION_CHARS = 200;

type VersionRow = {
  draft_id: string;
  version: number;
  body: string | null;
  author: string | null;
  based_on: number | null;
  note: string | null;
  asked_by: string | null;
  restored: boolean | null;
};

function alikeOf(kept: unknown): { draft: string; case: string; percent: number }[] {
  if (!Array.isArray(kept)) return [];
  return kept.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const { draft, case: caseId, percent } = item as Record<string, unknown>;
    return typeof draft === "string" && typeof caseId === "string" && typeof percent === "number"
      ? [{ draft, case: caseId, percent }]
      : [];
  });
}

export async function loadCasePieces(
  supabase: SupabaseClient,
  firmId: string,
  caseId: string,
  names: ReadonlyMap<string, string>,
  timeZone: string | null | undefined,
): Promise<CasePieces> {
  const [drafts, templates, dossiers, settings] = await Promise.all([
    supabase
      .from("case_drafts")
      .select(DRAFT_COLUMNS)
      .eq("org_id", firmId)
      .eq("case_id", caseId)
      .order("requested_at", { ascending: false })
      .limit(40),
    // The firm's models and the platform's (0045): a piece may be asked from either.
    supabase
      .from("draft_templates")
      .select("id, name, proceeding_kind")
      .or(`org_id.eq.${firmId},org_id.is.null`)
      .order("name"),
    supabase
      .from("dossiers")
      .select("id, status, summary, requested_at, issued_at, issued_documents(verify_code)")
      .eq("org_id", firmId)
      .eq("case_id", caseId)
      .order("requested_at", { ascending: false })
      .limit(10),
    supabase.from("platform_settings").select("value").eq("key", "drafts").maybeSingle(),
  ]);
  if (drafts.error || templates.error || dossiers.error) throw new Error("pieces could not be read");
  // The kinds of intermediate piece, and what keeps ONE from filing each issued one (0189): a read that fails says
  // nothing of them, and the case reads as before.
  const [kinds, filings] = await Promise.all([
    supabase.from("piece_kinds").select("slug, name").order("position"),
    supabase.rpc("case_piece_filings", { target_case: caseId }),
  ]);

  const rows = (drafts.data ?? []) as DraftRow[];
  // One draft in course per lawsuit, so the ones that wait for a lawyer are a few at most.
  const open = rows.filter((row) => row.status === "proposed");
  const runIds = [...new Set(rows.flatMap((row) => (row.run_id ? [row.run_id] : [])))];
  const alikeCases = [...new Set(rows.flatMap((row) => alikeOf(row.alike).map((item) => item.case)))];

  const [bodies, sources, waiting, cases, written, oneRedo] = await Promise.all([
    Promise.all(
      open.map((row) =>
        supabase
          .from("case_draft_versions")
          .select("draft_id, version, body, author, based_on, note, asked_by, restored")
          .eq("org_id", firmId)
          .eq("draft_id", row.id)
          .eq("version", row.version)
          .maybeSingle(),
      ),
    ),
    // What each of them cites, as the gate of the approval reads it: each source once, and whether the
    // library answers for it today. The database answers nothing while the latest version was not read.
    Promise.all(
      open.map(async (row) => ({
        draftId: row.id,
        ...(await supabase.rpc("case_draft_sources", { target_draft: row.id })),
      })),
    ),
    runIds.length > 0
      ? supabase.from("approvals").select("run_id").eq("org_id", firmId).eq("status", "pending").in("run_id", runIds)
      : { data: [], error: null },
    alikeCases.length > 0
      ? supabase.from("cases").select("id, seq").eq("org_id", firmId).in("id", alikeCases)
      : { data: [], error: null },
    // The version each of those runs wrote, whether it was a rewriting (written on another version), and
    // what the AI said a lawyer should look at in it.
    runIds.length > 0
      ? supabase
          .from("case_draft_versions")
          .select("run_id, version, based_on, notes")
          .eq("org_id", firmId)
          .in("run_id", runIds)
      : { data: [], error: null },
    // What ONE is doing with the texts it carries: asking the client what they lack, or writing them again (0100).
    // A read that fails says nothing of it, and the pieces read as before.
    open.length > 0 ? supabase.rpc("case_drafts_one_redo", { target_case: caseId }) : { data: {}, error: null },
  ]);
  const redoOf = new Map<string, "asking" | "rewriting">(
    !oneRedo.error && oneRedo.data && typeof oneRedo.data === "object"
      ? Object.entries(oneRedo.data as Record<string, unknown>).flatMap(([id, state]) =>
          state === "asking" || state === "rewriting" ? [[id, state] as const] : [],
        )
      : [],
  );
  if (
    bodies.some((body) => body.error) ||
    sources.some((read) => read.error) ||
    waiting.error ||
    cases.error ||
    written.error
  ) {
    throw new Error("drafts could not be read");
  }

  const latestOf = new Map(
    bodies.flatMap((body) => (body.data ? [[String(body.data.draft_id), body.data as VersionRow] as const] : [])),
  );
  // The text a rewriting was written on: what the lawyer reads the change against. Only for a latest text
  // the AI rewrote, so a piece nobody sent back reads nothing more.
  const rewritten = [...latestOf.values()].filter((version) => version.author === "ai" && version.based_on !== null);
  const befores = await Promise.all(
    rewritten.map((version) =>
      supabase
        .from("case_draft_versions")
        .select("draft_id, body")
        .eq("org_id", firmId)
        .eq("draft_id", version.draft_id)
        .eq("version", version.based_on as number)
        .maybeSingle(),
    ),
  );
  if (befores.some((before) => before.error)) throw new Error("drafts could not be read");
  const beforeOf = new Map(
    befores.flatMap((before) =>
      before.data ? [[String(before.data.draft_id), String(before.data.body ?? "")] as const] : [],
    ),
  );
  const sourcesOf = new Map(
    sources.map((read) => [
      read.draftId,
      ((read.data ?? []) as Record<string, unknown>[]).flatMap((row) => {
        const source = sourceOfRow(row);
        return source ? [source] : [];
      }),
    ]),
  );
  const waits = new Set(((waiting.data ?? []) as { run_id: string }[]).map((approval) => approval.run_id));
  const seqOf = new Map(((cases.data ?? []) as { id: string; seq: number }[]).map((found) => [found.id, found.seq]));
  const writtenBy = new Map(
    (
      (written.data ?? []) as { run_id: string | null; version: number; based_on: number | null; notes: unknown }[]
    ).flatMap((row) =>
      row.run_id
        ? [
            [
              row.run_id,
              {
                version: Number(row.version),
                rewriting: row.based_on !== null,
                notes: Array.isArray(row.notes)
                  ? row.notes.filter((note): note is string => typeof note === "string")
                  : [],
              },
            ] as const,
          ]
        : [],
    ),
  );

  const setting = settings.data?.value as Record<string, unknown> | null | undefined;
  const configured = Number(setting?.similar_attention_percent);
  // A setting that is no number is no setting, as the database reads it: never a zero.
  const numberOf = (value: unknown): number | null =>
    typeof value === "number" && Number.isFinite(value) ? value : null;
  const allowed = numberOf(setting?.max_revisions);
  const mostRevisions = allowed !== null && allowed >= 0 ? allowed : MAX_REVISIONS;
  const longest = numberOf(setting?.max_revision_chars);
  const now = Date.now();
  type DossierRow = {
    id: string;
    status: string;
    summary: unknown;
    requested_at: string;
    issued_at: string | null;
    issued_documents: { verify_code: string } | { verify_code: string }[] | null;
  };

  return {
    pieceKinds: kinds.error ? [] : ((kinds.data ?? []) as { slug: string; name: string }[]),
    pieceFilings:
      !filings.error && filings.data && typeof filings.data === "object" && !Array.isArray(filings.data)
        ? Object.fromEntries(
            Object.entries(filings.data as Record<string, unknown>).map(([id, blocker]) => [
              id,
              typeof blocker === "string" ? blocker : null,
            ]),
          )
        : {},
    drafts: rows.flatMap((row) => {
      if (!isDraftStatus(row.status)) return [];
      const checked = row.checked_version !== null && row.checked_version === row.version;
      const latest = row.status === "proposed" ? (latestOf.get(row.id) ?? null) : null;
      const author = latest?.author;
      return [
        {
          id: row.id,
          proceedingId: row.proceeding_id,
          templateName: row.template_name,
          status: row.status,
          work:
            row.work === "generate" || row.work === "revise" || row.work === "check" || row.work === "issue"
              ? row.work
              : null,
          slow: row.work !== null && now - new Date(row.updated_at).getTime() > SLOW_MINUTES * 60_000,
          version: row.version,
          checked,
          body: latest ? String(latest.body ?? "") : null,
          aiWaits: row.run_id !== null && waits.has(row.run_id),
          aiAnswer: ((answer) => (answer ? { version: answer.version, rewriting: answer.rewriting } : null))(
            row.run_id !== null && waits.has(row.run_id) ? writtenBy.get(row.run_id) : undefined,
          ),
          notes: row.run_id ? (writtenBy.get(row.run_id)?.notes ?? []) : [],
          revision:
            row.status === "proposed" && row.revision_note
              ? {
                  note: row.revision_note,
                  by: row.revision_by ? names.get(row.revision_by) || null : null,
                  atLabel: row.revision_at ? momentLabel(row.revision_at, timeZone) : null,
                  failed: row.work !== "revise",
                }
              : null,
          revisionsLeft: Math.max(0, mostRevisions - Number(row.revisions ?? 0)),
          latest:
            latest && (author === "ai" || author === "template" || author === "person")
              ? {
                  author,
                  note: latest.note ?? null,
                  askedBy: latest.asked_by ? names.get(latest.asked_by) || null : null,
                  basedOn: latest.based_on ?? null,
                  restored: Boolean(latest.restored),
                  before: author === "ai" && latest.based_on !== null ? (beforeOf.get(row.id) ?? null) : null,
                }
              : null,
          sources: row.status === "proposed" && checked ? (sourcesOf.get(row.id) ?? []) : [],
          alike: alikeOf(row.alike).map((item) => ({
            draftId: item.draft,
            caseId: item.case,
            caseSeq: seqOf.get(item.case) ?? null,
            percent: item.percent,
          })),
          approvedLabel: row.approved_at ? momentLabel(row.approved_at, timeZone) : null,
          approvedBy: row.approved_by ? names.get(row.approved_by) || null : null,
          approvedAuto: row.approved_auto === true,
          documentId: row.document_id ?? null,
          requestedLabel: momentLabel(row.requested_at, timeZone),
          requestedBy: row.requested_by ? names.get(row.requested_by) || null : null,
          requestedAuto: row.requested_auto === true,
          oneRedo: row.status === "proposed" ? (redoOf.get(row.id) ?? null) : null,
          updatedLabel: momentLabel(row.updated_at, timeZone),
          pieceKind: row.piece_kind ?? "inicial",
          piece:
            (row.piece_kind ?? "inicial") === "inicial"
              ? null
              : {
                  recommendation:
                    row.recommendation === "file" || row.recommendation === "hold" ? row.recommendation : null,
                  recommendationReason: row.recommendation_reason,
                  waitsFor: row.waits_for === "defense" ? "defense" : null,
                  decision: row.decision === "file" || row.decision === "hold" ? row.decision : null,
                  decisionReason: row.decision_reason,
                  decidedBy: row.decided_by ? names.get(row.decided_by) || null : null,
                  decidedLabel: row.decided_at ? momentLabel(row.decided_at, timeZone) : null,
                  filingStatus:
                    row.filing_status === "owed" ||
                    row.filing_status === "sent" ||
                    row.filing_status === "filed" ||
                    row.filing_status === "refused" ||
                    row.filing_status === "failed" ||
                    row.filing_status === "unknown"
                      ? row.filing_status
                      : null,
                  filingMessage: row.filing_message,
                  filedLabel: row.filed_at ? momentLabel(row.filed_at, timeZone) : null,
                  filedHow: row.filed_how === "one" || row.filed_how === "lawyer" ? row.filed_how : null,
                  filedProtocol: row.filed_protocol,
                  receiptFileId: row.receipt_file_id,
                  fromPublication: row.publication_id !== null,
                },
        } satisfies CaseDraft,
      ];
    }),
    templates: ((templates.data ?? []) as { id: string; name: string; proceeding_kind: string | null }[]).map(
      (template) => ({
        id: template.id,
        name: template.name,
        proceedingKind:
          template.proceeding_kind === "juizado" || template.proceeding_kind === "comum"
            ? template.proceeding_kind
            : null,
      }),
    ),
    alikeAttention: Number.isFinite(configured) && configured > 0 ? configured : ALIKE_ATTENTION,
    maxRevisionChars: Math.max(longest ?? MAX_REVISION_CHARS, MIN_REVISION_CHARS),
    dossiers: ((dossiers.data ?? []) as unknown as DossierRow[]).flatMap((row) => {
      if (row.status !== "requested" && row.status !== "issued" && row.status !== "failed") return [];
      const issued = Array.isArray(row.issued_documents) ? row.issued_documents[0] : row.issued_documents;
      const summary =
        typeof row.summary === "object" && row.summary !== null && !Array.isArray(row.summary)
          ? Object.fromEntries(
              Object.entries(row.summary as Record<string, unknown>).filter(
                (entry): entry is [string, number] => typeof entry[1] === "number",
              ),
            )
          : {};
      return [
        {
          id: row.id,
          status: row.status,
          verifyCode: issued?.verify_code ?? null,
          issuedLabel: row.issued_at ? momentLabel(row.issued_at, timeZone) : null,
          requestedLabel: momentLabel(row.requested_at, timeZone),
          requestedAt: new Date(row.requested_at).getTime() || 0,
          summary,
        } satisfies CaseDossier,
      ];
    }),
  };
}
