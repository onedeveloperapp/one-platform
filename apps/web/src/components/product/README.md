# Product UX components

Building blocks for the authenticated app (dashboard/product screens) — the counterpart to `components/marketing/`. They exist so product screens are designed around **user goals and activation**, not defaulted to CRUD tables. See the `product-screen` skill for the full playbook, and `catalog.json` for every component with its props and when to use it.

- `EmptyState` — never ship a blank zero-data view: icon + why + the ONE next action (the nudge).
- `OnboardingChecklist` — persistent activation checklist (the Mural pattern, +10% one-week retention); shows real progress, nudges the next step, survives dismissal. Steps declared in code; state from `@flyee/onboarding`.
- `OnboardingChecklistCard` — the firm's setup checklist on the home. The page reads what the firm has in place (`firm_setup_facts`) and whether this person dismissed the card, and hands both over; the card renders nothing once everything is in place or the person dismissed it.
- `ActivationProgress` — completion-drive ring (Gestalt closure). The one research-backed gamification pattern — no points/badges/streaks.
- `SetupWizard` — multi-step setup shell (progressive disclosure): one decision per screen with a visible progress rail, so long setups don't feel long.
- `MessageBubble` — one message of a conversation, on the side of who said it.
- `CollapsibleCard` — a card of a long screen of many cards that a person opens when they need it: closed, it says where things stand in one line and, with a StatusChip, what waits for a person; `CollapsibleGroup` opens or closes them all at once. The case screen opens on arrival only the cards of the stage and the ones where something waits (`lib/cases/sections.ts`).

## Where the setup checklist is wired

- **Declared** in `apps/web/src/lib/onboarding.ts`: each step names the fact of `firm_setup_facts` (migration `0020_firm_today`) that closes it and the screen where it is done. A step is done when the thing exists in the database, never because somebody clicked it, and a step is declared only when its screen exists.
- **Read** by the home (`app/(dashboard)/inicio/page.tsx`), under the person's session, for who manages the firm: the facts, and the person's own row of `onboarding_state` (whether they dismissed the card).
- **After sign-in** everybody lands on the app root (`resolvePostAuthDestination`): the home is where the checklist waits, so nobody is held on a setup screen before seeing the product. It is never decided in the middleware, which runs on every request and stays query-free.

What a person keeps is only the dismissal (`@flyee/onboarding`, table `onboarding_state`, migration `0002_platform`): the setup itself belongs to the firm and is computed from facts on every read.
