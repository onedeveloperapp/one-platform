# Tracking & conversions (Meta Pixel + GA4 + CAPI)

Measurement for ads and analytics on flyee.club (phase 7.3 of
`docs/PLANO-IMPLEMENTACAO.md`, 2026-10-01). The club handles no health or
otherwise sensitive data, so the posture is the ordinary one for a paid tool:
the Meta Pixel and GA4 load by default on the public site AND in the member
area, every visitor can refuse them, and the money events (sign-up, checkout,
purchase) also go server-side. The CLI never talks to an ad tool: it sends only
product events to the platform (`/api/cli/events`, `docs/CLI-CONTRACT.md`).

## Where things live

| Concern | File |
|---|---|
| Pixel + GA4 snippets, written once | `apps/web/src/lib/tracker-snippets.ts` |
| Public site: SSR base scripts, opt-out | `apps/web/src/components/consent/marketing-trackers.tsx` (marketing and funnel layouts) |
| Public site: SPA PageView | `apps/web/src/components/consent/marketing-analytics.tsx` |
| Member area: scripts after load + SPA PageView, never on `/admin` | `apps/web/src/components/consent/dashboard-trackers.tsx` (dashboard layout) |
| Browser event helpers (`track`, `trackPageView`, opt-out, `CONSENT_VERSION`) | `apps/web/src/lib/analytics.ts` |
| One-shot event from a server page (`ViewContent`) | `apps/web/src/components/consent/track-event.tsx` |
| Cookie notice (opt-out; renders only when a tracker is configured) | `apps/web/src/components/consent/cookie-consent.tsx` (all three layouts) |
| Server-side Meta Conversions API | `apps/web/src/lib/meta-capi.ts` (+ `meta-capi-context.ts`) |
| Server-side GA4 Measurement Protocol | `apps/web/src/lib/ga4-mp.ts` |
| First-party visits per page and entry door (no cookie) | `apps/web/src/lib/site-views.ts`, called by the middleware |

## Consent — opt-out model

**Public site.** The base scripts are rendered on the server by the marketing
and funnel layouts, so they are in the first HTML and fire for every visitor.
The cookie notice informs and offers "Recusar análises": the refusal sets the
`analyticsOptOut` cookie, the server skips the scripts from the next load on,
`lib/analytics.ts` stops emitting events and sets GA4's `ga-disable-*`
kill-switch at once. With no id configured nothing loads and the notice never
renders.

**Member area.** The same snippets, under the same cookie, injected once the
page is interactive (the dashboard layout is a client component, and nothing
there needs to be in the first HTML). The snippet's own first PageView counts
the page it loaded on; every later move inside the app is one SPA PageView.
The admin consoles (`/admin/**`) never load them: the operator's visits are not
marketing data, and their addresses stay out of ad tools. A member who opens
an admin page first and then the app loads the trackers on the app page.

**The texts that must stay in sync with the code**, changed in the same commit
whenever the posture changes, with `CONSENT_VERSION` bumped so the notice comes
back:

- the cookie notice (`cookie-consent-description`, both catalogs);
- the privacy policy and the cookie policy, published as versioned
  `consent_terms` rows (a published text never changes: a new version is
  inserted and the old one switched off).

`CONSENT_VERSION` is **4** since the member area joined (2026-10-01); the
privacy policy and the cookie policy went to **version 2** in the same change
(migration `0022_tracking_terms`). **Version 3** (migration `0027_legal_texts_v3`,
2026-10-06) adds the segment cookie and the click measurement to the cookie
policy and the name FlyeeClub to the privacy policy; nothing in it needs
consent, so `CONSENT_VERSION` stays at 4. Version 3 is what `/legal/privacidade`
and `/legal/cookies` render. A new cookie or a new kind of measurement is a new
version of the cookie policy, in the same change.

### Server-side conversions and the opt-out

Server-side conversions (CAPI / GA4 Measurement Protocol) fire regardless of
the browser opt-out. They are first-party measurement of the account holder's
own transactions (e-mail hashed, workspace id, IP/UA, purchase value), they do
not depend on the cookies the visitor refused, and their basis is legitimate
interest, which the cookie notice and the cookie policy ("Medição no servidor")
state. Starting to honour the opt-out there, or adding a server event that is
not an account holder's transaction, means editing those texts in the same
commit and bumping `CONSENT_VERSION`.

## Event map

**Browser (Pixel + GA4, opt-out)**

| Event | Where it fires |
|---|---|
| `PageView` | every public page (SSR snippet + `MarketingAnalytics`) and every member page outside `/admin` (`DashboardTrackers`) |
| `ViewContent` | `/planos` (`content_category: "pricing"`) and the open founders offer `/fundadores` (`content_category: "offer"`), through `TrackEvent` |

**Site events (GA4 custom events + Meta custom events, opt-out)**

The vocabulary of the home brief, sent through `trackSiteEvent`
(`lib/site-events.ts`) to the trackers above, never to a third one. Every
event carries `locale` and, when the visitor declared one, `segment`; the
campaign (`utm_*`, `origem`) is GA4's own session attribution from the landing
URL and is not repeated per event. A click is DECLARED on the element
(`data-track="<event>"` plus `data-track-<prop>` attributes, or
`trackAttributes()` for a link built in code) and reported by the one listener
in `MarketingAnalytics`, so a server component declares an event without
client code; a section view is declared with `track="<key>"` on `Section` (and
the components that wrap one), reported once per load when half of it is on
screen.

| Event | Props | Where it fires today |
|---|---|---|
| `section_view` | `section` | the home's sections: `hero`, `store`, `howItWorks`, `whyStore`, `pricing`, `requirements`, `faq`, `finalCta` |
| `cta_click` | `cta_id`: `nav`, `hero`, `plan_access`, `plan_full`, `final`, `footer` | the header, the hero, each pricing card, the final CTA, the footer |
| `quiz_click` | `location` | the hero's secondary button ("O FlyeeClub é pra mim?") |
| `segment_click` | `segment`, `location` | the waitlist's segment select (`waitlist`); the hero links and the "Para quem é" cards when the home carries them |
| `store_filter` | `category` (`all` when cleared) | the store grid's category chips |
| `app_card_click` | `app` | an app card's link on the home |
| `locked_click` | `item` | the locked "Pedir um app" card (`request`) |
| `see_all_apps_click` | — | the "Ver todos os apps" links of the home |
| `faq_open` | `question_id` (the item's id, else its position) | opening a question in any `Faq` |
| `contact_click` | `location` | the footer's contact link |
| `app_install_click`, `app_command_copy`, `compat_click` | `app` / — | reserved for the store cards and the compatibility block of the rebuilt home |

**Server (Meta Conversions API)**

| Event | Where it fires | event_id | Match keys |
|---|---|---|---|
| `CompleteRegistration` | `auth/callback/route.ts` (new account only) | user id | email, user id, `_fbp`/`_fbc`, IP/UA |
| `InitiateCheckout` | `settings/billing/actions.ts` (the checkout actions) | idempotency key | email, workspace id, `_fbp`/`_fbc`, IP/UA |
| `Purchase` | `api/webhooks/[provider]` → `payment_succeeded` (once per paid invoice) | `<provider>:<invoice>` | workspace id, value, + email/`_fbp`/`_fbc`/IP/UA from `meta_attribution` |
| `Subscribe` | same webhook, only a subscription's FIRST paid invoice | `subscribe:<subscription>` | workspace id, value, + `meta_attribution` keys |

`event_id` is stable per event, so a browser event of the same name
deduplicates against the server one, and renewals count as distinct purchases.
`Subscribe` fires once per subscription so the ad tools can optimize for new
paying members, while `Purchase` counts every paid invoice.

**Server (GA4 Measurement Protocol, same call sites)**

| Meta event | GA4 event | params |
|---|---|---|
| `CompleteRegistration` | `sign_up` | `method` |
| `InitiateCheckout` | `begin_checkout` | `currency`, `value` |
| `Purchase` | `purchase` | `currency`, `value`, `transaction_id` |
| `Subscribe` | `subscribe` | `currency`, `value` |

Each GA4 event is stitched to the visitor's web session through the `_ga`
cookie `client_id`. No `client_id`, no GA4 event: required by the protocol, and
correct consent behaviour (the `_ga` cookie only exists for a visitor who did
not refuse). For the browserless `purchase`, the `client_id` is the one captured
at checkout (`meta_attribution.ga_client_id`).

### Purchase match enrichment

The `Purchase` webhook has no browser, so the signals are captured at checkout:
the checkout reads the `_fbp`/`_fbc` cookies and the GA4 `client_id` plus
IP/UA/e-mail and stores them in `public.meta_attribution` (service role only,
one row per workspace). The webhook reads that row back and attaches the keys
to the Meta `Purchase` and the GA4 `purchase`, so a PIX payment that settles
hours later and every renewal still match. The row is written only when a
signal exists, so a plain checkout never wipes a stored one.

### Campaigns: first touch and last touch

- **First touch** (`signup_attribution`): the campaign of the first link a
  person followed (`origem`, `onda`, `utm_*`), kept in a cookie by the
  middleware and written once to the workspace when the account exists. The
  entry doors of `/admin/metricas` count purchases by it.
- **Last touch** (`meta_attribution.campaign_*`, `purchase_attributions`): the
  campaign of THIS purchase, from the checkout link or, when the link has none,
  from the last-campaign cookie the middleware keeps for 14 days (the webhook's
  window). The webhook adds it to the `Purchase` (`last_origem`, `last_utm_*`)
  and writes one `purchase_attributions` row per invoice that started a
  subscription; a refund or chargeback drops it (`purchase_attribution_is_paid`).

### Segment capture

The audience a visitor declares before any account exists. Since migration
`0028` there is one vocabulary: the site's personas `negocio`, `agencia`,
`produto` and `dev` ARE `member_segment`, plus `outro` (`lib/site-segment.ts`).
A segment link (`?segment=agencia`) is kept by the middleware in a readable
cookie (90 days, the newest wins, an unknown value writes nothing), and a
click on the page writes the same cookie (`rememberSegment`). It stamps every
site event, pre-fills the waitlist's select, goes into the sign-up's metadata
(so `handle_new_user` stamps the profile and `account.created` carries it) and
pre-fills the onboarding's first step; the member can change it in either.

### Visits per page and door (first-party, no cookie)

The middleware counts one view per document load of a public page by a person
who is not signed in (never a crawler, a prefetch, a redirect or a client-side
navigation) through `count_site_view` (migration 0005), after the response, so
the page never waits. The door is the link's `?origem=`, else the first-touch
door, else "direto". These counts are the visits of the entry doors table in
`/admin/metricas`; they set no cookie and are aggregated by day, page, door and
language.

## Configuration — where to get each value

Set these in Vercel (and `apps/web/.env` for local). All are optional; leaving
them empty disables tracking with no errors.

- **`NEXT_PUBLIC_META_PIXEL_ID`**: Meta Events Manager → *Data sources* → the
  dataset → the **Pixel ID**. Public by design.
- **`META_CAPI_TOKEN`**: same dataset → *Settings* → *Conversions API* →
  **Generate access token**. Server-only secret.
- **`META_CAPI_TEST_EVENT_CODE`** *(optional)*: Events Manager → *Test events*
  shows a `TESTxxxxx` code; set it temporarily to watch events arrive, then
  remove it.
- **`NEXT_PUBLIC_GA4_ID`**: Google Analytics → *Admin* → *Data streams* → the
  **Web** stream → **Measurement ID** (`G-XXXXXXXXXX`). Public by design.
- **`GA4_API_SECRET`**: same Web stream → *Measurement Protocol API secrets* →
  **Create**. Server-only secret.
- **`SUPABASE_SERVICE_ROLE_KEY`**: also what the visits counter uses; without
  it no visit is counted and nothing else changes.

## Verifying

1. Set the ids, open the public site, read the notice, open the member area.
2. Meta **Test events** (with `META_CAPI_TEST_EVENT_CODE`): `PageView` and
   `ViewContent` from the browser, `CompleteRegistration`, `InitiateCheckout`
   and `Purchase` from the server, with `event_id` deduplication shown.
3. GA4 **Realtime** / **DebugView**: `page_view` on the site and on member
   pages (none on `/admin`), `view_content`, and `sign_up` / `begin_checkout` /
   `purchase` from the Measurement Protocol.
4. Refuse in the notice: no `_fbp`/`_fbc`/`_ga` cookie afterwards, no scripts
   on the next load, on the site and in the member area.
