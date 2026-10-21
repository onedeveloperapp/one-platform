import { createAnonClient } from "@/lib/public-content";

/** The documents the public legal pages render, by consent term slug. */
export type LegalSlug = "terms" | "privacy" | "cookies";

export type LegalTerm = {
  title: string;
  bodyMd: string;
  version: number;
  /** When this version was published. */
  publishedAt: string;
};

/**
 * The text in force of a legal document, in the language of the page
 * (`consent_terms`, versioned, migration 0001; v1 seeded in 0018).
 *
 * The page renders exactly the text a person accepts at sign-up and in the
 * CLI consent screen: there is no second copy of the terms in the message
 * catalogs. Returns null when the text cannot be read (no Supabase, an error,
 * no active version in that language); the page then says so plainly instead
 * of showing anything else as if it were the terms.
 */
export async function getLegalTerm(slug: LegalSlug, locale: string): Promise<LegalTerm | null> {
  const supabase = createAnonClient();
  if (!supabase) return null;
  const { data, error } = await supabase
    .from("consent_terms")
    .select("title, body_md, version, created_at")
    .eq("slug", slug)
    .eq("locale", locale)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data) return null;
  return {
    title: data.title as string,
    bodyMd: data.body_md as string,
    version: data.version as number,
    publishedAt: data.created_at as string,
  };
}
