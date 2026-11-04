---
name: product-screen
description: UX playbook for authenticated app screens (everything under apps/web/src/app/(dashboard) that is NOT marketing). Use BEFORE creating or substantially editing any product screen — it stops the default drift into CRUD tables and forces goal-first, activation-driven design (empty states, onboarding, progressive disclosure), automation before manual work, cards that ask only for what is still owed, and the fixes of defects already met in production.
---

# Product screen playbook

You are designing a screen inside a paid product, not an admin CRUD. The failure mode this skill exists to prevent: **defaulting to a table of rows with add/edit/delete**, because that is the statistically common shape. Real products are designed around what the user is trying to ACHIEVE and how fast they reach value.

Scope: every screen under `apps/web/src/app/(dashboard)/**` (the authenticated app). Marketing (`[locale]/(marketing)`) has its own skill. A `PreToolUse` hook loads this automatically on edits here — you never wait to be asked.

**This playbook is project-agnostic.** It holds what any product built on this template needs, including the fixes of defects already met in production, written so a new project does not meet them again. A project writes its own bindings (the product's name, its automation settings, its examples, its copy rules) in `.claude/rules/app-ux.md` and `apps/web/CLAUDE.md`; where a binding is more specific, it is the project's decision.

## Pass 0 — goal, not table

Before any layout, write down: **who** is on this screen, **what job** they came to do, and **what "success" looks like** for them here. Design backward from that. Ask: if this screen were not a table, what would it be? A table is a valid answer only when the job is genuinely "scan/compare/manage many rows" — otherwise it is the lazy default. Prefer: a focused summary + the one primary action; a guided flow; a single object view with its context; a dashboard that answers a question.

## Pass 0b — who does the work: the product or the person

Before designing a screen where a person does a task by hand (writes, fills in, copies, marks, checks something against a rule), ask whether the product can do it from what it already has (a document it holds, an integration, a rule, its AI), and design that instead:

- **The product does the task**, and every automated run is recorded (what ran, on what, with what result). How much it decides alone is the account's setting, per decision: automatic, automatic with a share checked by a person, or a person decides. The project sets the default.
- **The person only answers** what only they know or decide: a question asked in place (a blank only they can fill, a choice left open), a decision, a document to send again after a refusal said with why.
- **The screen shows what the product did**, says beside it, not in a distant help text, that it may be wrong and what to check, and lets the person change it; what it could not do alone waits for a person with the reason.
- **Propose, never ask for a technical fact.** Where the product can find a fact (which system, which code, which category, what a document says), it proposes it and the person approves it or not, the approval recorded as that person's decision. A field asking the person to look the fact up is the defect.

A screen where a person does by hand what the product could do is the exception, and its reason is written beside it.

**Never list the product's work as the person's step.** A checklist, a count, a pending line, an empty state or a message names as the person's only what a person does or decides. What the product does alone is said as the product's: done, being done, or waited for ("Waiting for the first order from your store"), with a manual way, where one exists, offered as the exception and never as the primary action. Failure this prevents: a setup checklist ending with "Create your first case", while the product creates cases by itself from an integration, told the user who had just finished the setup that the work was manual.

**A registration starts from documents.** Where a record is already written on a document the person has (an ID, a proof of address, a ticket, a booking's screenshot, a photo of a printed page), the form opens on sending it: the product reads it, fills the fields and marks each as read from the document until somebody writes over it, and the person confirms or corrects; a field no document gives is asked beside them. Typing every field is the contingency ("Fill in by hand"), never the first screen. Failure this prevents: a form of typed fields for a new person whose ID and ticket the product had already read on another screen.

## The activation principle (from onboarding research)

The best products bring the user to VALUE fast (the "aha moment") — they sell the outcome, not the feature list.

- **First-run is not a blank screen.** A brand-new account must land on a path to value: a welcome + the first meaningful action, or a short setup. Show what the product will do for them.
- **Personalize when it earns its keep**, and then *show what the answer unlocked* — a home already populated with the user's relevant content beats an empty one.
- **Onboarding checklist** (`OnboardingChecklist` + `@flyee/onboarding`): a persistent, dismissible-but-reopenable list of the few steps to first result. Replacing pop-ups/banners with a checklist lifted one-week retention +10% (Mural). It doubles as the honest gamification below.
- **Progressive disclosure** (`SetupWizard`): one decision per screen with a visible progress rail; a long setup that never feels long. Splitting a form across steps can *raise* conversion (House +15%).
- **Never divert attention from a setup**: a setup or onboarding flow holds no exit before it ends, no link to another screen, no "see more", no showcase of features to explore. Everything a step needs happens in the step (a dialog, an inline form, the second factor, an invitation's link copied or sent by e-mail in place), and information for later belongs on the home or its own page. Every link out of a setup is a setup left half done. Failure this prevents: a "See modules" line on a setup's first step took the account's owner away before anything was configured.
- **Settle every prerequisite before the step that needs it**: before ordering a flow's steps, list what each step's writes require (a second factor, a role, a connection, data another step writes). Each requirement becomes its own step ahead of the first step that needs it, and the flow does not advance past it until it is met, with the reason on screen. A step that opens disabled, waiting on something an earlier step could have settled, is a dead end. Failure this prevents: a second factor asked inside six setup steps locked the very first one; it became step 1.
- **Split setups by scope.** What every account needs is the core setup; what one module or feature needs is that module's own setup, after the core and before the home, only for what the account has, each in its module's colour, the others shown disabled as what the account could add. Never put a module's parameter in the core, nor ask an account to set up what it does not have.
- **Everybody who joins has a setup of their own.** An invited member is never dropped on a home that says nothing: their setup asks the second factor first, then what their role needs to work (a professional registration, a signature), and the home reminds them of what they set aside.
- **Reassure along the way**: inline validation (a password field that ticks requirements as you type), microcopy that explains the impact of a step, tooltips on dry concepts. None of it is flashy; it makes the flow feel effortless.

## Empty states (non-negotiable)

Every zero-data view uses `EmptyState` — icon + one line of why + the ONE next action (the nudge). A bare "No data" / empty table is a UX failure. The empty state is often a user's FIRST impression of a feature: make it teach and invite. Whether a view is empty is decided by the list it stands for, never by a count of a narrower scope (see "Lists, counts and the latest few"), and a read that failed is an error with a retry, never an empty state.

## Engagement patterns — what works vs theater

Distilled from the gamification research — most of it is a WARNING:

- **Use: completion drive.** Progress toward closing an open loop (Gestalt closure — Apple activity rings drove 49.5% behavior change). This is the onboarding checklist + `ActivationProgress` ring. It maps REAL setup/usage progress.
- **Use: competence feedback.** Signals that the user got better at the actual thing (real personal records, meaningful milestones tied to genuine work) — the need most tied to lasting motivation. Domain-specific: design it into the product's own data, not as a bolt-on.
- **Avoid: PBL theater** — points, badges, leaderboards bolted on. The three most-documented failures (LinkedIn, Foursquare, Google News all retired theirs); they drive quantity over the behavior the business needs.
- **Avoid: streak traps.** Streaks shift from motivating to obligational and carry active regulatory risk (EU Digital Fairness Act). Do not ship a streak by default.
- **Avoid the S-curve.** Stacking streaks + points + badges + challenges reverses engagement (Habitica: 100% of studied users had counterproductive effects). If you're stacking mechanics, you're past the peak.
- **Local, winnable competition** beats a global leaderboard when competition fits the product at all (Strava segments).

## Layout & craft (dashboards)

- Arrange by the QUESTION the screen answers, not by table schema. Group related data; decide how much belongs on one screen before it clutters.
- Lead cards/sections with a meaningful icon (show, don't tell — same as marketing). Use the harmonic tones (`components/marketing/tone.ts` hues via tokens) for categorical families; primary for the primary action.
- **Cards lead with their icon and say where they stand.** A card a person works through opens with the icon of what it is on its family's tint, its title, and on the right where it stands (a status chip) and what it keeps one click away (a quick-actions menu); each thing it lists says its state in a state line: done (green, a check), under way (amber, a clock), to look at or act on (the attention accent, an exclamation), failed (red), information (grey), the words saying the state too. In this template: `CardTitle`, `StatusChip`, `QuickActions`, `StateLine`.
- **A card asks only for what is still owed.** A request already fulfilled (a document that arrived and serves, a link sent, an answer given) is said as done and leaves the card's main area: doing it again goes to the quick-actions menu, one click away; when nothing is left, the card says so first, on a tinted line ("Nothing else to send"). What is still owed, or arrived and does not serve, is a line in the attention colour with its ONE button beside it. Check every card for a button that asks for what already happened. Never hide in the menu the only way to do the card's pending job, nor a right the person must find in plain sight (withdrawing a consent, deleting their data). Failure this prevents: a link page asked a person to send an ID a partner had already sent for them.
- **One line per thing, its state on the right.** A card's list is one row per thing: what it is and whose on the left; its state in words on the right, aligned down the card (`StateLine` `status`); a button only on a row that still owes something; a detail under the name (a refusal's reason, a file's name) only where it explains the state or tells two rows apart. A box per item with a chip, a second chip and a button each doubles the card's height for nothing.
- **Confirm a binding act in front of the person.** An act whose consequences the person must understand (a consent given or withdrawn, a decision others will act on) ends in a dialog that states the outcome (the state in a large icon, the title in their words, one consequence a line, one button; `OutcomeDialog` here), never in an alert or a toast at the top of the page, which is read past.
- MUI v9 first, theme tokens only (never hardcode colors), Formik+Yup for forms with inline errors near the field, next-intl for every string.

## Lists, counts and the latest few

- **A screen says each thing once.** Two sections fed by the same counts split them, never repeat them: the list of what is late or blocks the work names its items one by one, and the tiles beside it keep only the rest (what falls today, what is good to look at). An empty state ("nothing waits") never sits beside a list that holds items, nor beside the error that says a read failed; and a reminder waits while a checklist on the same screen already asks the same thing. Failure this prevents: a home that listed approvals, publications and overdue deadlines in its "act now" list and again as tiles under "what waits for you", and said "nothing waits" under a list of blocked cases.
- **A count counts what its list shows.** A tile, badge or heading count beside a list has the list's scope and filters. A count that leaves something out on purpose (only what still needs action) says so in its label, and never decides whether the list shows. Failure this prevents: a page decided "nothing here yet" from a count that left out items already handed on, and hid the account's only item, which the list itself still held.
- **A home shows the latest few, never the list.** The latest 3 to 5 items, one compact line each: what it is with one word under it, on the right its step in words with its progress in small, the whole line a link to the item; then "See all" to the full list. In this template: `ProgressList`. A full list or a table on a home is the defect.
- **A list a person works through stays still.** While they act on its rows (triage, approve, decide), each row keeps its place whatever the server reads behind it, and they ask for the next ones. A refresh that reorders rows under the pointer makes the person act on the wrong item.
- **A search for a person travels in the request, never in the address.** A name, an ID number or a case number typed in a search goes in the request body: an address lands in history, logs and referrers.
- **A page past the end of its list shows its last page**, never an empty page that reads as "nothing here".

## Async work, said while the person is still there

- **Say the outcome where the person acted, while they still have the thing in hand.** What can be checked at once is checked at once (a photo too blurry to read is said under the line it was sent from, with "take another" and "send it as it is": a rule may be wrong, and the person decides). What the server checks later is read again for a bounded while (every ~10 s for a few minutes after the upload), so the answer, a refusal with its reason included, shows before they leave.
- **Status that moves on its own is read again while it moves**: on a visible tab only, at a pace that matches how fast it changes, slower as it waits, stopping when nothing moves or after a bound. The newest answer wins, and a line never says "working" after the work finished.
- **Focus follows the work, never the page.** When an async action ends, put the person back on the line they acted on (its first button that can be pressed, or the line itself), unless they moved on to type elsewhere; the page never scrolls under them.

## Never lose what the person typed

- An editor or a dialog with unsaved input asks before closing; a background refresh never closes or resets it; what was typed is kept in the tab and offered back when it is opened again.
- A side trip to settle a prerequisite returns to the form with what was typed (`product-verify` walks it).

## Words, colour and time

- **Hues go on icons, bars and fills; words keep the text colours**: a palette hue rarely reaches 4.5:1 as small text on a light ground.
- **Red is for failure and risk only.** What the person should look at or do takes the attention accent; under way, amber; done, green; information, grey. Every state is said in words too, never by colour alone.
- **A missing value hides its line**: never print "—", "null" or an empty label in its place.
- **A time carries its zone**: said in the zone of the place it belongs to (a court, an airport, a store), the zone named when it may not be the reader's.
- **Interpolated names read as a sentence**: no category word before a name that may already carry it ("the agency Agency Sol"), no label's capital kept inside a sentence, no two cards of one screen with the same title.
- **An error says its real reason.** A refusal from a provider is read by its code and said as what happened (a sending limit reached, an e-mail that could not leave, an address that already has an account), with what the person can do; "check your connection" only for a request that never reached the server. Failure this prevents: a sign-up refused because the provider's e-mail sender hit its hourly limit told the person to check their connection, and they kept retrying.
- **A one-time code verifies on its last digit**: typed or pasted, the code submits itself once complete, and a wrong one clears for a new try.

## Next.js App Router pitfalls (each one broke a screen in production)

- **Show a required step in place, never by `redirect()` from a page under the shell's Suspense boundary**: in a production build that redirect goes through the client router and the screen breaks (React error #310). Render the step where the page would be.
- **After a sign-in, a sign-out or a change of account, load the next page anew** (a full navigation), never a client-router push: the router keeps the layout's redirect of the old session and replays it on every page under it, leaving a blank screen.
- **A server file imports from a `"use client"` file only its components and its types.** Any other value exported there (a guard like `isStep()`, a list of steps, a constant) reaches the server as a client reference: it typechecks and builds, and throws when the page is requested ("Attempted to call ... from the server but ... is on the client"), so every visit lands on the error boundary. Put what the page and its view both read in a plain module beside them, imported by both.
- **A component that reads its own data takes an optional first read as a prop** (`initial`): a server page can hand it one, and a preview or a test draws it from fixtures without a session.
- **A server action is a public endpoint**: validate every argument as if a stranger sent it, and check the caller's right to act again inside it.

## Forms & semantic fields

- **Semantic data never goes in a raw `TextField`.** Phone, national ID numbers (CPF/CNPJ here), postal code (CEP) and money use the field catalog in `components/product/fields/` (`PhoneField`, `CpfField`/`CnpjField`/`CpfCnpjField`, `CepField`, `CurrencyField`) — mask, inline check-digit validation and locale-aware formatting come built in (`product-lint` advises when it spots a bypass).
- **Postal-code auto-fill pattern**: `CepField`'s `onAddressFound` pre-fills street/district/city/state — those fields MUST remain editable (a head start, not a lock), a failed lookup silently degrades to manual entry (never block the form on a third party), and a form that opens with a postal code already filled does not look it up again over the address on record.
- **Persist digits, not masks**: run `onlyDigits()` (`@flyee/fields`) before writing to the DB; validate in Yup with the same package's validators (`.test("cpf", t(...), isValidCpf)`) so UI and schema agree.
- **Inline, translated feedback**: each field takes `invalidMessage` (product namespace) and flags complete-but-invalid values as the user types — never only on submit.
- Respect the loading and error states — skeletons that reserve space (no layout shift), errors that say what to do next.

## Component conformance (check BEFORE writing markup)

`apps/web/src/components/product/catalog.json` is the machine-readable catalog of this layer, and the `product-screen-guard` hook injects a digest of it into every write/edit here — so the full range is always in context. Two kinds of entry: `components` already exist (import them) and `template` are shapes described but not packaged yet (build them to the description, in the existing visual language, and register them in the catalog).

**Never invent a component.** The order is fixed and there is no fourth option:

1. **The catalog has it** — import it. If it almost fits, EXTEND it (a prop, a mode) rather than writing a parallel one; the `StatTile` filter mode exists because a screen needed a clickable tile and the first attempt was eleven hand-written boxes instead.
2. **The catalog describes it under `template` but it is not packaged yet** — build it to that description, keeping the shape: radius, tint (`-light/10`), band height, type scale, hover. Register it in `catalog.json` in the same commit.
3. **Neither has it** — build it, but build it IN the existing visual language: the same tokens, the same radii, the same tone vocabulary (`TILE_TONE`), the same type scale. Put it in `components/product/` with a comment saying which existing component it is closest to and why nothing existing fit. Then register it.

A `<Box>` with a border and a radius is not a shortcut, it is a second design language growing next to the existing one. It type-checks, it survives review, and it is invisible until someone opens the screen and asks why it looks nothing like the rest. `product-lint` blocks the interactive form of this (`[invented-component]`) and flags the static one.

**The check is about SHAPE, not only tokens.** For every value you are about to render, ask which entry fits it:

| The data is | The component |
| --- | --- |
| a series the payload already carries | `TrendSparkline` |
| an x-of-y allowance | `UsageMeter` |
| 2–6 counters describing one population | `MetricBars` |
| a single counter, or a clickable filter | `StatTile` |
| a lifecycle state | a pastel status `Chip` (the state is NAMED, never colour alone) |
| where one thing stands, in a list of things | `StateLine` |
| where something stands along its way | `ProgressSteps` (whole), `ProgressBar` (in a row), `ProgressList` (the latest few) |
| a definition attached to a number | `InfoHint` (a `Tooltip` on a plain `Box` dies on touch and keyboard) |
| zero data | `EmptyState`, or the illustrated banner when the whole screen is empty |

A series, a ratio, a share or a counter set rendered as a **sentence of numbers** is a defect — it makes the reader do arithmetic the component would have done. Equally a defect: hand-rolling a shape the catalog already has, and hardcoding `bg-primary/10` where `TILE_TONE` prescribes `bg-{tone}-light/10`.

The inverse is also a defect: **never invent a chart to fill space.** A visual earns its place only when it answers a question the user actually asks, on data that already exists. Below ~6 categories `MetricBars` beats a donut; without real prior-period data there is no trend to draw.

## Reusable building blocks

`apps/web/src/components/product/`: `EmptyState`, `OnboardingChecklist`, `OnboardingChecklistCard`, `ActivationProgress`, `SetupWizard`. State persistence: `@flyee/onboarding` (`getOnboardingState`, `completeStep`, `computeProgress`) over `onboarding_state` (migration 0009). Step definitions live in the project's code; only state is persisted.

**Live predicates are the preferred path** (not click-tracking): give a step a `done` derived from real product state (`{ key, title, done: hasConnection }`) so the checklist reflects reality; `completeStep` is only for steps with no observable signal. Strings in these components come from the `product` i18n namespace of every locale the project has. For multi-tenant setup work, set `ONBOARDING_ORG_SCOPED = true` so activation is shared across an org's members instead of per user.

**Wiring (already in place):** declare the steps in `apps/web/src/lib/onboarding.ts` (`ONBOARDING_STEPS`; empty ⇒ everything degrades to the app root). The four auth entry points (sign-in, sign-up, `/auth/callback`, `/auth/two-factor`) call `resolvePostAuthDestination`, sending a user with pending onboarding to `/onboarding` (the `SetupWizard`, self-guarding) and everyone else to `DEFAULTS.appRoot`. The app home mounts `OnboardingChecklistCard` for the remaining steps. Do NOT put this check in the middleware — it runs on every request and must stay query-free.

## Before finishing

Walk the screen as a brand-new user (empty data) AND as a returning one. Confirm: no blank empty states; a first-run path to value exists; no CRUD table where a focused view fits the job better; no task left to the person that the product could do, and nothing the product does listed as theirs; every card asks only for what is still owed and says each thing's state in words; every count matches the list it labels; **every value is in the catalog shape that fits it — no series, ratio or counter set left as a sentence, and no chart added that the data does not support**; nothing typed can be lost; strings translated; tokens only; `npm run build` + `npm run lint:fix` pass.

For a new flow or a substantial edit, run the `product-verify` skill — it drives the real app through the journey (new + returning user, 1440/390, light/dark) and judges dead ends, lost context, error-vs-empty and leftover demo surfaces. Code that was never run is not verified.
