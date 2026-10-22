import "server-only";

import { LIBRARY_KINDS, type SourceKind } from "@flyee/knowledge/citations";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What the operator's console of the platform's content reads (migration
 * 0045): the models and the sources with no firm, every one of them, retired
 * sources included. A read that fails throws: the console shows an error,
 * never an empty list.
 */

export type PlatformTemplate = {
  id: string;
  name: string;
  proceedingKind: "juizado" | "comum" | null;
  isDefault: boolean;
  provisional: boolean;
  body: string;
  updatedAt: string;
};

export type PlatformSource = {
  id: string;
  kind: SourceKind;
  issuer: string;
  number: string;
  article: string | null;
  citation: string;
  title: string;
  quote: string | null;
  sourceUrl: string;
  note: string | null;
  status: "verified" | "retired";
  verifiedAt: string;
  retiredReason: string | null;
};

export type PlatformContent = { templates: PlatformTemplate[]; sources: PlatformSource[] };

const isKind = (value: unknown): value is SourceKind => (LIBRARY_KINDS as readonly unknown[]).includes(value);

export async function loadPlatformContent(supabase: SupabaseClient): Promise<PlatformContent> {
  const [templates, sources] = await Promise.all([
    supabase
      .from("draft_templates")
      .select("id, name, proceeding_kind, is_default, provisional, body, updated_at")
      .is("org_id", null)
      .order("name"),
    supabase
      .from("legal_sources")
      .select(
        "id, kind, issuer, number, article, citation, title, quote, source_url, note, status, verified_at, retired_reason",
      )
      .is("org_id", null)
      .order("kind")
      .order("number")
      .order("article"),
  ]);
  if (templates.error || sources.error) throw new Error("the platform's content could not be read");

  return {
    templates: (
      (templates.data ?? []) as {
        id: string;
        name: string;
        proceeding_kind: string | null;
        is_default: boolean | null;
        provisional: boolean | null;
        body: string;
        updated_at: string;
      }[]
    ).map((row) => ({
      id: row.id,
      name: row.name,
      proceedingKind: row.proceeding_kind === "juizado" || row.proceeding_kind === "comum" ? row.proceeding_kind : null,
      isDefault: row.is_default === true,
      provisional: row.provisional === true,
      body: row.body,
      updatedAt: row.updated_at,
    })),
    sources: (
      (sources.data ?? []) as {
        id: string;
        kind: string;
        issuer: string;
        number: string;
        article: string | null;
        citation: string;
        title: string;
        quote: string | null;
        source_url: string;
        note: string | null;
        status: string;
        verified_at: string;
        retired_reason: string | null;
      }[]
    ).flatMap((row) =>
      isKind(row.kind) && (row.status === "verified" || row.status === "retired")
        ? [
            {
              id: row.id,
              kind: row.kind,
              issuer: row.issuer,
              number: row.number,
              article: row.article,
              citation: row.citation,
              title: row.title,
              quote: row.quote,
              sourceUrl: row.source_url,
              note: row.note,
              status: row.status,
              verifiedAt: row.verified_at,
              retiredReason: row.retired_reason,
            },
          ]
        : [],
    ),
  };
}
