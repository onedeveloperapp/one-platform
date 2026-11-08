# Product UX components

Building blocks for the authenticated app (dashboard/product screens) — the counterpart to `components/marketing/`. They exist so product screens are designed around **user goals and activation**, not defaulted to CRUD tables. See the `product-screen` skill for the full playbook, and `catalog.json` for every component with its props and when to use it.

- `EmptyState` — never ship a blank zero-data view: icon + why + the ONE next action (the nudge).
- `OnboardingChecklist` — persistent activation checklist (the Mural pattern, +10% one-week retention); shows real progress, nudges the next step, survives dismissal. Steps declared in code; state from `@flyee/onboarding`.
- `OnboardingChecklistCard` — the firm's setup checklist on the home. The page reads what the firm has in place (`firm_setup_facts`) and whether this person dismissed the card, and hands both over; the card renders nothing once everything is in place or the person dismissed it.
- `ActivationProgress` — completion-drive ring (Gestalt closure). The one research-backed gamification pattern — no points/badges/streaks.
- `SetupWizard` — multi-step setup shell (progressive disclosure): one decision per screen with a visible progress rail, so long setups don't feel long.
- `MessageBubble` — one message of a conversation, on the side of who said it.
- `CornerTag` — a short state floating over the corner of what it marks, as the count on the bell: "Em breve" off the icon of a module still to come in the menu, a lock on what the firm did not contract. It takes no room of the name beside it, so the name keeps its line.
- `ListBar` — the same bar on every list: the ready views with their counts, the search, "Filtrar" (the list's own filters, which narrow every count), "Ordenar", "Exportar" where the list really exports, and what it keeps out of sight; the filters in force as chips under it. `/casos` is the first list in it.
- `NumberCard` — a list's big number with what it was in the same span before (never a few days against a whole month), the move green only when it is the one hoped for, the card opening the list it counts; the arithmetic is `lib/numbers/compare.ts`.
- `SidePanel` — where every registration is made: a panel at the right of the page, the page behind it under a veil, the head with the icon and one line of what happens, the form scrolling, the buttons kept at the foot, the focus on the first field. The deadline and the hearing open in it (`DeadlinePanel`, `HearingPanel`), from their cards and from the "Adicionar" of the top (`components/layout/add/`), which asks for the case and the lawsuit first.
- `AtWorkNotice` — the notice that holds a record's screen while the product works on it: what it is doing, its steps and how long, the screen read again once it ends; from about two minutes on, "Continuar sem esperar". Only for the product's own work, never a wait on a person or a court. The case screen mounts it (`casos/[id]/components/case-at-work.tsx`).
- `CollapsibleCard` — a card of a long screen of many cards that a person opens when they need it: closed, it says where things stand in one line and, with a StatusChip, what waits for a person; `CollapsibleGroup` opens or closes them all at once. The case screen opens on arrival only the cards of the stage and the ones where something waits (`lib/cases/sections.ts`); `/settings/autonomia`, `/settings/team`, `/settings/connections` and `/admin/ai` use it the same way.

## Where the setup checklist is wired

- **Declared** in `apps/web/src/lib/onboarding.ts`: each step names the fact of `firm_setup_facts` (migration `0020_firm_today`) that closes it and the screen where it is done. A step is done when the thing exists in the database, never because somebody clicked it, and a step is declared only when its screen exists.
- **Read** by the home (`app/(dashboard)/inicio/page.tsx`), under the person's session, for who manages the firm: the facts, and the person's own row of `onboarding_state` (whether they dismissed the card).
- **After sign-in** everybody lands on the app root (`resolvePostAuthDestination`): the home is where the checklist waits, so nobody is held on a setup screen before seeing the product. It is never decided in the middleware, which runs on every request and stays query-free.

What a person keeps is only the dismissal (`@flyee/onboarding`, table `onboarding_state`, migration `0002_platform`): the setup itself belongs to the firm and is computed from facts on every read.
