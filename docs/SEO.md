# Search direction (committed) — the flyee.club SEO baseline

**This file is the single source of the public site's search direction.** The `marketing-page` skill READS it (the way it reads `docs/DESIGN.md`) when writing titles, descriptions and copy. It records what the codebase already guarantees, how the two languages are addressed, and the target terms each page commits to (written 2026-10-01, phase 7.3 of `docs/PLANO-IMPLEMENTACAO.md`; the terms are hypotheses until Search Console has data).

---

## What the codebase guarantees (do NOT re-implement)

| Concern | Where |
|---|---|
| XML sitemap: every indexed page once per language with its alternates, help and blog posts in the languages they exist in, published catalog modules in the languages their name is written in; rebuilt hourly | `apps/web/src/app/sitemap.ts` |
| robots + sitemap pointer (crawlers kept out of the app and the API) | `apps/web/src/app/robots.ts` |
| `metadataBase` + `%s \| Brand` title template + favicons | `apps/web/src/app/layout.tsx` |
| Canonical of the language being read, hreflang for every language the page exists in plus `x-default` on the Portuguese address, Open Graph URL, locale and the social card | `apps/web/src/lib/seo.ts` (`publicPageMetadata`) |
| Shared social card (the official lockup, 1200×630) | `apps/web/src/app/opengraph-image.tsx`, named again by `publicPageMetadata` because a page that sets `openGraph` drops the image it inherits |
| `Organization` + `WebSite` JSON-LD (site-wide) | `components/marketing/site-json-ld.tsx`, mounted by the `[locale]/(marketing)` layout |
| `BreadcrumbList` JSON-LD on inner pages | `components/marketing/breadcrumb-json-ld.tsx` |
| `FAQPage` JSON-LD (from the FAQ items) | `components/marketing/faq.tsx` |
| `Product`/`Offer` JSON-LD (from real billing plans) | `components/marketing/pricing-section.tsx` |
| One `<h1>` per page | `Hero`, or `SectionHeader as="h1"` / `PricingSection headingAs="h1"` |
| Title, description, canonical and hreflang in `<head>` for every user agent. Next streams metadata into the `<body>` for browsers and for Googlebot by default, where a canonical or hreflang link counts only if the engine renders the page | `apps/web/next.config.mjs` (`htmlLimitedBots: /.*/`) |
| Real status codes: a missing app, help article or post answers 404 (a page in the language of the address that leads back to the site) and a moved address answers a real redirect, never a 200 with `noindex` or a meta refresh. It holds because no loading boundary sits above the public pages | `apps/web/src/app/layout.tsx` (no `<Suspense>` around the children, no `app/loading.tsx`), `apps/web/src/app/not-found.tsx` |

## Languages and addresses

Path-based since phase 7.1 (2026-10-01): Portuguese at the root, English under `/en` with translated slugs (`/planos` ↔ `/en/pricing`, `/como-funciona` ↔ `/en/how-it-works`, `/catalogo` ↔ `/en/catalog`, `/sobre` ↔ `/en/about`). The addresses of every page in both languages are declared in `apps/web/src/i18n/routing.ts`, which is also what makes a page public to the middleware.

- **Each address is canonical to itself.** The English page is never canonicalized to the Portuguese one (that would tell search engines to drop the translation).
- **`x-default`** points at the Portuguese address, the default language.
- **Non-canonical addresses redirect:** `/pt-BR/planos` → `/planos`, `/en/planos` → `/en/pricing`, and an English-only slug typed without the prefix (`/pricing`) → `/en/pricing`.
- **Content that exists in one language has an address in that language only:** a help article or blog post without a translation (linked by `translation_group`), or a catalog module whose name has no English text. Its other-language address leads to the section index instead of serving the wrong language, and the sitemap and hreflang list only the language it exists in.
- **Crawlers are never switched:** the language suggestion on the public site offers the other language to a browser that reads it; it never redirects and never changes what a crawler sees.

## What each page must still do (the on-page layer)

See the `marketing-page` skill's "SEO & discoverability" section — enforced by review: exactly one `<h1>` (the page title), a localized title tag (target term + value, ~60 chars) and a distinct 150–160-char description via `generateMetadata` spreading `publicPageMetadata({ path, locale })`, answer-first copy, the target term in the `<h1>`, title and first sentence, internal links to the money page, and structured data through `<JsonLd>` for any new schema-eligible block.

## Per-page target terms (hypotheses, both languages indexed)

Money page first. Terms are used naturally, never stuffed.

| Page | pt-BR term / intent | English term / intent | Funnel role |
|---|---|---|---|
| `/planos` · `/en/pricing` | "flyee.club preço", "assinatura skills Claude Code" — commercial | "flyee.club pricing", "Claude Code skills subscription" — commercial | **money page**: the ladder and checkout entry |
| `/` · `/en` | "skills para Claude Code", "harness para Claude Code e Codex" + brand; title `flyee.club \| Skills e workflows para Claude Code e Codex` | "Claude Code skills", "AI coding harness" + brand; title `flyee.club \| Skills and workflows for Claude Code and Codex` | brand + top of funnel |
| `/como-funciona` · `/en/how-it-works` | "como instalar skills no Claude Code", "atualizar skills" — informational → commercial | "install Claude Code skills", "update Claude Code skills" | education → plans |
| `/catalogo` · `/en/catalog` | "catálogo de skills para Claude Code", "workflows para Codex" — commercial investigation | "Claude Code skills catalog", "Codex workflows" | catalog → plans |
| `/catalogo/<slug>` · `/en/catalog/<slug>` | the module name + "skill para Claude Code" (long tail) | the module name + "Claude Code skill" | module → plans |
| `/sobre` · `/en/about` | brand + "sobre" — navigational | brand + "about" | trust |
| `/contato` · `/en/contact` | brand + "contato" | brand + "contact" | navigational |
| `/ajuda` · `/en/help` | support long tail (DB-managed articles) | same, in English | support + topic cluster |
| `/blog` · `/en/blog` | topic cluster around Claude Code, Codex and AI changes (DB-managed) | same, in English | authority growth |
| `/espera` · `/en/waitlist` | brand + "lista de espera" | brand + "waitlist" | pre-launch capture |
| `/legal/*` | none — not a ranking target | none | trust / compliance |

**Not indexed** (`noindex`, out of the sitemap, named in its exclusion comment): `/espera/confirmar` (a one-time confirmation link), `/descadastro` (reached only from the unsubscribe link of an e-mail), `/verificar/<module>@<version>` (a checksum lookup reached from the CLI and the module pages) and the campaign pages of `app/[locale]/(funil)/` (`/fundadores`), reached by the link the operator sends. Indexing is decided by each page's `metadata` + `sitemap.ts`, never by the route group.

**Structured data notes:** inner pages emit `BreadcrumbList`; the pricing section emits `Product`/`Offer` from real plans (the list price, never a campaign price); FAQ sections emit `FAQPage`. Never mark up ratings, reviews, member counts or availability that are not published.

## Constraints

- **`NEXT_PUBLIC_SITE_URL`** must be set in production (no trailing slash). Without it the sitemap, robots, the social card and every JSON-LD `@id`/`url` fall back to `http://localhost:3000`.
- **Internal paths are Portuguese** (short, no accents): pages live in folders named after the Portuguese path, and links use them through `LocaleLink`, which writes the address of the language being read.
- **Catalog texts in English are optional in the database** (only the Portuguese name is required), which is why the English catalog lists only modules with English text. Writing both languages in `/admin/catalogo` is what puts a module on both sides.

## Open items

- Search Console for both languages after the first deploy (the property covers `/` and `/en`), then revisit the target terms with real queries.
- Lighthouse ≥ 90 on performance and SEO for `/`, `/en`, `/planos` and `/en/pricing` on the deployed site (phase 7 verification).
- Blog and help clusters grow in the admin consoles (`/admin/blog`, `/admin/help`) — no deploy needed.
