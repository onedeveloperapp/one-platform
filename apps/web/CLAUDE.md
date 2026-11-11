# ONE web (apps/web)

Next.js 15 (App Router) + React 19, the only app of ONE: the firm's area, the operator consoles, checkout, auth and the public site. See the root `CLAUDE.md` and `docs/ONE-PLANO-DESENVOLVIMENTO.md`.

**`apps/web/ARCHITECTURE.md` is the map of how the app works, area by area, with its files, tables, migrations and sweeps.** Read the section of the area before changing it (the stack in full; the gate, the menu and entitlements; the firm, its team and sign-up; the home and the modules; the setups; the owner's rules of screens; cases and the portfolio import; conversations; filing; publications; deadlines; hearings; the library; approvals; the controladoria; the books, the numbers and ONE's work; people and their data; screens, entry by entry; settings and connections; the client's link and verification; the agency module; usage events; the public site; billing and checkout; the team console; AI runs and spend; the vault and files; WhatsApp; account plumbing; messages and background work; the state of 2026-10-09), and update that section in the same change when a mechanism is added or moved. This file keeps the rules every change in `apps/web` obeys, beside the root `CLAUDE.md` and `.claude/rules/*`.

## Stack and conventions

- **UI**: before building a component, look for a MUI v9 or MUI X community (or Lab) equivalent. Import the one icon you render, through `@/icons/nexture/*`; `src/icons/icon-registry.tsx` ships the whole set and is for the menu only.
- **Styling**: MUI theme driven by CSS variables (`hsl(var(--token))`) from `@flyee/design-tokens`. Component overrides live in `src/style/**/*.css` inside CSS layers (`theme, base, mui, components, utilities`). Tailwind 4 for layout utilities, merged with `tailwind-merge`. Run `npm run check:mui-classes` after touching `src/style/**`.
- **Themes**: the palette and the mode are classes on `<html>` that the root layout renders on the server, and a script in `<head>` corrects the mode before the first paint. Never leave them to a client effect: until it ran, the page had no palette.
- **Fonts and shapes**: radius, shadows and the card's hairline are tokens of `packages/design-tokens/css/common.css`; cards and papers are `rounded-xl`; Tailwind's important modifier takes no space (`shadow-sm!`, checked by `check:mui-classes`). Change the faces only when the owner asks.
- **Forms**: Formik + Yup. Semantic data (phone, CPF/CNPJ, CEP, money) uses `components/product/fields/*`, never a raw `TextField`; persist digits, never masks.
- **i18n**: every user-facing string goes through next-intl and the one catalog, `packages/content/messages/pt-BR.json`. `node scripts/prune-messages.mjs --check` fails on unused and missing keys; `src/lib/i18n/messages.test.ts` refuses a blank text.
- **Language of a request**: Portuguese. A public page keeps the locale in its internal URL (`app/[locale]/`); everything else renders in the default locale. No language cookie, no detection, no switch.
- **Path alias and brand**: `@/*` → `./src/*`. Identity comes from `@flyee/content` through `src/brand.ts`; the logo component never redraws its SVGs.
- **Remote data**: `lib/remote-state.ts` (`RemoteState<T>`: idle, loading, success, empty, error). An error is never rendered as empty.

## Logged area (product layer)

- **Screen shape**: `page.tsx` is a server component that reads with the person's session (`lib/member/context.ts`, `getMemberContext()`, cached per request: the session client, the firm with the person's role and function, `isSuperadmin`, currency and `org_entitlements`) and hands a `state` (`ready` | `error` | `unavailable`) to a client view that takes plain props. An error is never rendered as an empty state, and every write goes to the database function that owns the rule.
- **The gate and the menu are guidance, not the fence**: row-level security and `require_aal2()` are. Both are pure and unit-tested (`lib/firm/gate-rules.ts`, `lib/firm/menu.ts`) and get who is looking from the server layout, so the first paint is right. The middleware passes the path in `x-one-path` and stays query-free.
- **Entitlements**: `org_entitlements(org)` is the single answer to what a firm may use. Screens branch on it, never on plan names; limits are data on the plan rows.
- **The firm and its team**: every change is a server action calling the database function that takes the firm; no rule is decided in TypeScript. Colleagues are read through `firm_team()`, never `profiles`; a query on `memberships` always filters by `user_id`. `handle_new_user` creates the profile and nothing else; a campaign attaches to the firm when it is founded, never at sign-up.
- **Modules**: a page under `?modulo=<key>` keeps `modulo` in every link it builds. What only a module has is offered under that module and in its area, never on a page of every module. The core opens a module's component through the registry (`next/dynamic`), never by name; a new module brings its setup in its own folder and touches nothing of the core's; a module not contracted is never set up.
- **The setup checklist**: a step is done when the thing exists in the database (`firm_setup_facts(org)`), never because somebody clicked.
- **The owner's rules of screens** (in full, with ONE's examples, in `.claude/rules/app-ux.md`): the setup never leads away from itself; whatever a later step needs is a step before it, the second factor first; ONE does the work and a person answers only what only they know or decide; a registration starts from documents, and typing is the contingency; a card asks only for what is still owed and says where each thing stands.
- **Searches and court texts**: a search (a name, a CPF, a number) goes in the request, never in the address. A court's text is rendered as plain text, never as markup. Never `select("*")` on `publications`: a list reads `PUBLICATION_LIST_COLUMNS`, and the AI's shadow answer is not a member's to read.
- **Pages by token** (`/convite/[token]`, `/c/[token]`, `/verificar`): no tracker, no referrer. A client's link shows the firm's name only, is never indexed, and writes only through its `client_link_*` functions.
- **Usage events** are events, never content (vocabulary and properties in migration 0007). In the browser, end the PostgREST builder with `.then()`: a bare `void supabase.rpc(...)` never sends the request.
- **No tracker runs inside the logged area**: it shows client names and case numbers. The Pixel and GA4 exist on the public site only.
- Reusable blocks live in `components/product/*` and are listed in `components/product/catalog.json` (injected by the `product-screen-guard` hook). Every zero-data view uses `EmptyState`.

## Public site (marketing layer)

- The layer's own rules are in `.claude/rules/marketing.md` (the primitives, SEO and the sitemap, Markdown content, motion, the declared site events, no loading boundary above a public page; each signed-in area keeps its own boundary in its layout). Display type is `font-display text-display-{2xl,xl,lg,md}`.
- A new public page is declared in `src/i18n/routing.ts`, which also makes it public to the middleware.
- **The loader overlay is for the signed-in areas only** (`isPublicPageRequest()`). What a public page decides in the browser above the fold is decided before the first paint, from `<head>`, never after hydration.
- **Performance of the public site**: what a public page pays on a phone is the shared shell (MUI and its styling engine hydrate on every page, and one stylesheet carries the overrides of every dashboard component). Do not add to that cost: no scripted animation, no client component where a server one does, one icon import per icon.
- Legal pages render the version in force of `consent_terms`, so the page shows exactly the text people accept; the catalog holds no second copy of the terms.
- Every primary CTA follows the launch stage (`lib/launch.ts`): `/espera` in `waitlist`, sign-up in `open`.
- A public form never reveals whether an address was already listed. A token in an e-mail link (`/espera/confirmar`, the unsubscribe link) moves into an httpOnly cookie and the page loads at the clean address; confirming takes a button press, because mail scanners open every link.
- **Tracking**: the Meta Pixel and GA4 run on the public site only, server-rendered behind one opt-out cookie and one notice (`lib/analytics.ts`); conversions go server-side (`lib/meta-capi.ts`, `lib/ga4-mp.ts`); the snippets are written once, in `lib/tracker-snippets.ts`.

## Billing

- The ladder inherited from the previous product (one-time access, USD through Stripe, `@flyee/billing/entitlements`) is not extended; ONE's own subscription replaces it. Provider webhooks are idempotent (`claim_billing_webhook_event`); `billing_past_due_grace_ends()` is the one answer every gate shares; a comped plan goes only through `set_org_plan`; prices on screen go through `formatPrice`, never struck through.
- ONE never moves case money: billing is the firm's own subscription and nothing else.

## Platform admin and account

- **Console shape**: a page reads through `lib/admin/*` inside `loadConsole()` (a failed read is never an empty list) and hands plain props to a client view; a write is a server action that calls `requireSuperadmin()` again, records an audit event and uses the database function that owns the rule wherever one exists. Its copy is hardcoded pt-BR, outside i18n (code comments stay in English); formatting goes through `lib/admin/format.ts`, and a database value becomes a word through `lib/admin/labels.ts`, never shown raw.
- The dossier of a firm (`/admin/escritorios`) shows its ACCOUNT, never what the firm keeps in the product. The Admin menu group renders only for the platform operator.
- **The superadmin flag** changes only through `set_user_superadmin(user, value, note)`: a trigger on `profiles` fences it by who is asking, and self-change is refused.
- **Support impersonation**: the write fence is in the database (`is_impersonated()`); a visit runs on a parallel session cookie; ending it uses `signOut({ scope: "local" })`, never the global default; starting it needs the operator's own session at AAL2 and a reason.
- **Account deletion** keeps its fixed order: re-read the preview, cancel any live provider subscription (a failure deletes nothing), run the RPC in one transaction, then remove storage through `admin_orphaned_account_storage`.
- **AI runs** go through `runFirmTask(request)` of `lib/ai/executor.ts`, never straight to a provider from a page, a route or a job: that call would be neither recorded, priced nor approved. `AI_FAKE_PROVIDER=1` is the fake on a machine with no key. `ai_spend` is written only inside `finish_ai_run`; prices are configuration (`platform_settings`, `ai_prices`).
- **The vault**: `getVault()` is the one way to a firm's vendor token, for jobs and webhooks only, opened once per batch of work with the firm and a purpose (every open is audited). A page never opens a token; a secret never goes into `connections.metadata`.
- **Files**: `startUpload`, `finishUpload` and `downloadUrl` (`lib/files/*`) are the only way to the `firm-files` bucket; the bytes never pass through a route of the app.
- **Issued documents** (`lib/documents/*`): `issueFirmDocument(input, render)` is the one way a document is issued; the renderer prints the verification mark with `stampVerification`. `lib/documents/verification.ts` holds the pure rules of the public page.
- **WhatsApp**: every delivery enters by `handleDelivery(rawBody, signature)` (`lib/whatsapp/inbox.ts`), the webhook and the simulator alike; a person's message goes out in two halves, `sendMessage` then `deliverOutbox`; `providerFor` is the one way to a number's provider. Never call the vendor, or write a `wa_*` table, in another way. Before the backend's half acts for a connection it asks the session the two questions of `lib/whatsapp/session.ts` (not a support visit, the second factor confirmed). The vendor's SDK loads only on `/settings/connections`, after the person asks to connect.
- Notification rows are created server-side with `lib/notifications.ts`.

## Messages: bell, e-mail and scheduled jobs

- **Every message to a person** comes from one copy object per channel: bell texts in `lib/messages/bell-copy.ts` (written by `notifyLocalized`), e-mail copy in `packages/email/src/copy/pt-BR.ts`. Never write a sentence for a person at a call site.
- **A plan is called by `plans.name`**, never by a word in the copy. A date and an amount arrive already formatted for the reader (`lib/messages/format.ts`: the reader's time zone, `America/Sao_Paulo` when unknown).
- **Claim, then send** (root rule 6): where there is no row to mark, the bell's unique `source_key` is the fence and the e-mail goes only with a new bell row. A message may be lost to a failed send, never sent twice; a batch the provider refuses is given back (`settle_newsletter_batch`).
- **Without `RESEND_API_KEY` or Inngest nothing breaks**: senders return `{ sent: false }` with no error, the bell still rings, a job does not claim what exists only as e-mail, and what an action starts runs after its answer.
- **What a reader can stop** (the news, the list) carries `unsubscribeUrl(...)` in the body and as `List-Unsubscribe`; `/api/public/email/unsubscribe` acts on POST only. Receipts and account notices ignore the preference.
- **Sweeps** (`Sweep` of `lib/jobs/schedule.ts`) are declared beside their code and listed in `lib/jobs/registry.ts`: one missing there never runs. A sweep claims each work in the database; one that must never run from two servers at once runs from the clock only; its answer holds counts only.
- **Billing notices** go through `lib/billing-notices.ts` and never throw: by the time one runs the database is already right, and a webhook that failed on a bell would be replayed by the provider and reconcile the whole event again.
- **Auth e-mails** are Supabase's templates (`supabase/templates/*.html`), not the app's.

## Auth

- Supabase through `@flyee/auth` (`client`/`server`/`middleware`/`service`). `src/middleware.ts` refreshes the session and protects everything except the public pages (`matchPublicPath`, from `src/i18n/routing.ts`) and `PUBLIC_PREFIXES`. Without `NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_ANON_KEY` the middleware no-ops and the auth screens show a configuration hint.
- 2FA (TOTP): enrolled at `/settings/security`; the middleware forces the AAL2 step-up at `/auth/two-factor`. M1 makes it mandatory by role.
- Internal redirects go through `lib/safe-next.ts` (`sanitizeInternalNext`), never a raw `next` parameter.

## Commands (run from the monorepo root)

- `npm run dev` — dev server. `npm run build` — production build. `npm run typecheck` — TypeScript 5.8 pinned to this app.
- `npm run test:web` — vitest. `npm run test:e2e` / `npm run test:a11y` — Playwright against a production build (`e2e/baseline.spec.ts`).
- `npm run lint:fix` / `npm run prettier` — lint and formatting.

## Watch out

- `src/style/global.css` imports tokens from `@flyee/design-tokens/css/*`; never recreate tokens locally.
- Deploys go ONLY through GitHub Actions (`.github/workflows/deploy.yml`, manual dispatch); the Vercel Git integration stays disconnected.
- Server-only secrets (`DATABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, provider keys) never reach client components.
- `apps/web/.env.local` is a blank ONE file: fill a key only with an ONE development or sandbox credential (root `CLAUDE.md`, "Safety").
- After deleting a route, remove `apps/web/.next/types` before `npm run typecheck`: the generated route types of the last build still name it.
