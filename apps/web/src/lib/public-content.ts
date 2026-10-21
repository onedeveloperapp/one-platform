import { isPublicLocale, type PublicLocale } from "@/i18n/routing";
import { createClient as createSupabaseClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Anonymous Supabase client for PUBLIC content (help center, blog) —
 * usable from pages, generateMetadata and sitemap.ts, none of which have
 * a user session. RLS only exposes published rows to anon. Returns null
 * when Supabase is not configured so every caller degrades gracefully.
 */
export function createAnonClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createSupabaseClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/*
 * Language rule of the public content (docs/PLANO-IMPLEMENTACAO.md, 7.1): an
 * address in a language serves content written in that language, never a
 * fallback. `/blog` lists the Portuguese posts and `/en/blog` the English
 * ones; a post exists in another language only through its translation, a
 * separate row in the same `translation_group` with its own slug.
 */

/** Slug of each published version of one piece of content, by language. */
export type ContentTranslations = Partial<Record<PublicLocale, string>>;

/**
 * What an address `/<section>/<slug>` in a language resolves to.
 *
 * - `found`: the content, in that language.
 * - `translated`: the slug belongs to another language; this is the slug of
 *   its translation in the requested one (the language switch keeps the slug
 *   when the page declares no translation).
 * - `untranslated`: the slug belongs to another language and has no
 *   translation; the page sends the reader to the section index.
 * - `missing`: no such content.
 */
export type ContentResolution<T> =
  | { kind: "found"; item: T }
  | { kind: "translated"; slug: string }
  | { kind: "untranslated" }
  | { kind: "missing" };

type ContentTable = "help_articles" | "blog_posts";

async function translationsOf(
  supabase: SupabaseClient,
  table: ContentTable,
  group: string,
): Promise<ContentTranslations> {
  const { data } = await supabase
    .from(table)
    .select("locale, slug")
    .eq("translation_group", group)
    .eq("is_published", true);
  const translations: ContentTranslations = {};
  for (const row of data ?? []) {
    if (isPublicLocale(row.locale)) translations[row.locale] = row.slug as string;
  }
  return translations;
}

/** The slug belongs to another language: where does the reader go? */
async function resolveElsewhere(
  supabase: SupabaseClient,
  table: ContentTable,
  locale: string,
  slug: string,
): Promise<ContentResolution<never>> {
  const { data } = await supabase
    .from(table)
    .select("translation_group")
    .eq("slug", slug)
    .eq("is_published", true)
    .neq("locale", locale)
    .limit(1)
    .maybeSingle();
  if (!data) return { kind: "missing" };
  const translations = await translationsOf(supabase, table, data.translation_group as string);
  const target = isPublicLocale(locale) ? translations[locale] : undefined;
  return target ? { kind: "translated", slug: target } : { kind: "untranslated" };
}

/** One sitemap row per published piece of content, with its translations. */
export type SitemapContent = {
  locale: PublicLocale;
  slug: string;
  updatedAt: string;
  translations: ContentTranslations;
};

async function listForSitemap(table: ContentTable): Promise<SitemapContent[]> {
  const supabase = createAnonClient();
  if (!supabase) return [];
  const { data } = await supabase
    .from(table)
    .select("locale, slug, updated_at, translation_group")
    .eq("is_published", true);
  const rows = (data ?? []).filter((row) => isPublicLocale(row.locale));
  const groups = new Map<string, ContentTranslations>();
  for (const row of rows) {
    const group = groups.get(row.translation_group as string) ?? {};
    group[row.locale as PublicLocale] = row.slug as string;
    groups.set(row.translation_group as string, group);
  }
  return rows.map((row) => ({
    locale: row.locale as PublicLocale,
    slug: row.slug as string,
    updatedAt: row.updated_at as string,
    translations: groups.get(row.translation_group as string) ?? {},
  }));
}

// ---------- Help center ----------

export type HelpArticleSummary = {
  slug: string;
  title: string;
  excerpt: string | null;
};

export type HelpCategoryWithArticles = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  articles: HelpArticleSummary[];
};

export type HelpArticleFull = {
  slug: string;
  title: string;
  excerpt: string | null;
  bodyMd: string;
  publishedAt: string | null;
  updatedAt: string;
  categoryName: string;
  related: HelpArticleSummary[];
  translations: ContentTranslations;
};

/** Published help content in one language. */
export async function listHelpContent(locale: string): Promise<HelpCategoryWithArticles[]> {
  const supabase = createAnonClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("help_categories")
    .select("id, slug, name, description, sort, help_articles(slug, title, excerpt, sort, is_published)")
    .eq("locale", locale)
    .eq("is_published", true)
    .order("sort");

  return (data ?? [])
    .map((row) => ({
      id: row.id as string,
      slug: row.slug as string,
      name: row.name as string,
      description: row.description as string | null,
      articles: (
        (row.help_articles as {
          slug: string;
          title: string;
          excerpt: string | null;
          sort: number;
          is_published: boolean;
        }[]) ?? []
      )
        .filter((article) => article.is_published)
        .sort((a, b) => a.sort - b.sort)
        .map(({ slug, title, excerpt }) => ({ slug, title, excerpt })),
    }))
    .filter((category) => category.articles.length > 0);
}

/** One published article in one language, with its siblings and translations. */
export async function getHelpArticle(locale: string, slug: string): Promise<ContentResolution<HelpArticleFull>> {
  const supabase = createAnonClient();
  if (!supabase) return { kind: "missing" };

  const { data: row } = await supabase
    .from("help_articles")
    .select(
      "slug, title, excerpt, body_md, published_at, updated_at, category_id, translation_group, help_categories(name)",
    )
    .eq("locale", locale)
    .eq("slug", slug)
    .eq("is_published", true)
    .maybeSingle();
  if (!row) return resolveElsewhere(supabase, "help_articles", locale, slug);

  const [{ data: siblings }, translations] = await Promise.all([
    supabase
      .from("help_articles")
      .select("slug, title, excerpt")
      .eq("category_id", row.category_id)
      .eq("locale", locale)
      .eq("is_published", true)
      .neq("slug", slug)
      .order("sort")
      .limit(4),
    translationsOf(supabase, "help_articles", row.translation_group as string),
  ]);

  return {
    kind: "found",
    item: {
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt,
      bodyMd: row.body_md,
      publishedAt: row.published_at,
      updatedAt: row.updated_at,
      categoryName: (row.help_categories as unknown as { name: string } | null)?.name ?? "",
      related: siblings ?? [],
      translations,
    },
  };
}

/** Every published article in every language — sitemap entries. */
export const listHelpForSitemap = () => listForSitemap("help_articles");

// ---------- Blog ----------

export type BlogPostSummary = {
  slug: string;
  title: string;
  excerpt: string | null;
  coverUrl: string | null;
  authorName: string | null;
  tags: string[];
  publishedAt: string | null;
};

export type BlogPostFull = BlogPostSummary & {
  id: string;
  bodyMd: string;
  updatedAt: string;
  translations: ContentTranslations;
};

/** Published blog posts in one language, newest first. */
export async function listBlogPosts(locale: string): Promise<BlogPostSummary[]> {
  const supabase = createAnonClient();
  if (!supabase) return [];

  const { data } = await supabase
    .from("blog_posts")
    .select("slug, title, excerpt, cover_url, author_name, tags, published_at")
    .eq("locale", locale)
    .eq("is_published", true)
    .order("published_at", { ascending: false })
    .limit(50);

  return (data ?? []).map((row) => ({
    slug: row.slug,
    title: row.title,
    excerpt: row.excerpt,
    coverUrl: row.cover_url,
    authorName: row.author_name,
    tags: row.tags ?? [],
    publishedAt: row.published_at,
  }));
}

/** One published post in one language, with its translations. */
export async function getBlogPost(locale: string, slug: string): Promise<ContentResolution<BlogPostFull>> {
  const supabase = createAnonClient();
  if (!supabase) return { kind: "missing" };

  const { data: row } = await supabase
    .from("blog_posts")
    .select(
      "id, slug, title, excerpt, body_md, cover_url, author_name, tags, published_at, updated_at, translation_group",
    )
    .eq("locale", locale)
    .eq("slug", slug)
    .eq("is_published", true)
    .maybeSingle();
  if (!row) return resolveElsewhere(supabase, "blog_posts", locale, slug);

  return {
    kind: "found",
    item: {
      id: row.id,
      slug: row.slug,
      title: row.title,
      excerpt: row.excerpt,
      bodyMd: row.body_md,
      coverUrl: row.cover_url,
      authorName: row.author_name,
      tags: row.tags ?? [],
      publishedAt: row.published_at,
      updatedAt: row.updated_at,
      translations: await translationsOf(supabase, "blog_posts", row.translation_group as string),
    },
  };
}

/** Every published post in every language — sitemap entries. */
export const listBlogForSitemap = () => listForSitemap("blog_posts");
