import "server-only";

import { momentLabel } from "@/lib/ai/approvals";
import { sourceLabel } from "@/lib/cases/drafts";
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
 * What the screen of the library reads (migration 0029), under the person's
 * own session: the sources a lawyer of the firm checked, the firm's models
 * of pieces, and what each model cites that the library does not answer for
 * yet (read from the model's text by the same reader that reads a draft). A
 * read that fails throws: a screen shows an error, never an empty library.
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
  verifiedBy: string | null;
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
  proceedingKind: "juizado" | "comum" | null;
  /** The model ONE writes the pieces of its kind from (0039). */
  isDefault: boolean;
  updatedLabel: string;
  updatedBy: string | null;
  /** How many distinct sources its text cites, and how many of them the library does not answer for. */
  cited: number;
  missing: number;
};

export type LibraryData = {
  sources: LibrarySource[];
  templates: LibraryTemplate[];
  missing: MissingSource[];
  /** How many models a firm keeps, as the setting says. */
  maxTemplates: number;
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
  verified_by: string | null;
  verified_at: string;
  retired_at: string | null;
  retired_reason: string | null;
};

type TemplateRow = {
  id: string;
  name: string;
  proceeding_kind: string | null;
  is_default: boolean | null;
  body: string;
  updated_by: string | null;
  updated_at: string;
};

type TeamRow = { user_id: string; display_name: string | null; email: string | null };

const isLibraryKind = (value: unknown): value is SourceKind => (LIBRARY_KINDS as readonly unknown[]).includes(value);

/** How many sources one request reads: under what the API hands back at once. */
const PAGE = 500;
/** How many pages a library is read in at most: a firm's library is thousands of sources, never millions. */
const MOST_PAGES = 40;

/**
 * Every source of the firm, read in pages: the API hands back a thousand rows at most, and a library read
 * short would show verified sources as missing.
 */
async function readSources(supabase: SupabaseClient, firmId: string): Promise<SourceRow[]> {
  const rows: SourceRow[] = [];
  for (let page = 0; page < MOST_PAGES; page += 1) {
    const { data, error } = await supabase
      .from("legal_sources")
      .select(
        "id, kind, key, citation, title, quote, source_url, note, status, verified_by, verified_at, retired_at, retired_reason",
      )
      .eq("org_id", firmId)
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

export async function loadLibrary(
  supabase: SupabaseClient,
  firmId: string,
  timeZone: string | null | undefined,
): Promise<LibraryData> {
  const [sourceRows, templates, team, settings] = await Promise.all([
    readSources(supabase, firmId),
    supabase
      .from("draft_templates")
      .select("id, name, proceeding_kind, is_default, body, updated_by, updated_at")
      .eq("org_id", firmId)
      .order("name"),
    supabase.rpc("firm_team", { target_org: firmId }),
    supabase.from("platform_settings").select("value").eq("key", "drafts").maybeSingle(),
  ]);
  if (templates.error || team.error) throw new Error("the library could not be read");

  const names = new Map(
    ((team.data ?? []) as TeamRow[]).map((person) => [
      person.user_id,
      person.display_name?.trim() || person.email?.split("@")[0] || "",
    ]),
  );
  const verified = new Set(sourceRows.filter((source) => source.status === "verified").map((source) => source.key));

  const missing = new Map<string, MissingSource>();
  const templateList: LibraryTemplate[] = ((templates.data ?? []) as TemplateRow[]).map((template) => {
    const cited = distinctCitations(extractCitations(template.body));
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
      proceedingKind:
        template.proceeding_kind === "juizado" || template.proceeding_kind === "comum"
          ? template.proceeding_kind
          : null,
      isDefault: template.is_default === true,
      updatedLabel: momentLabel(template.updated_at, timeZone),
      updatedBy: template.updated_by ? names.get(template.updated_by) || null : null,
      cited: cited.length,
      missing: outside.length,
    };
  });

  const configured = Number((settings.data?.value as Record<string, unknown> | null | undefined)?.max_templates);
  return {
    sources: sourceRows.flatMap((source) =>
      isLibraryKind(source.kind) && (source.status === "verified" || source.status === "retired")
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
              verifiedBy: source.verified_by ? names.get(source.verified_by) || null : null,
              verifiedLabel: momentLabel(source.verified_at, timeZone),
              retiredReason: source.retired_reason,
              retiredLabel: source.retired_at ? momentLabel(source.retired_at, timeZone) : null,
            } satisfies LibrarySource,
          ]
        : [],
    ),
    templates: templateList,
    missing: [...missing.values()],
    maxTemplates: Number.isFinite(configured) && configured > 0 ? configured : 40,
  };
}
