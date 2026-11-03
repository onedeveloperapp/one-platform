---
paths: ["apps/web/src/app/(dashboard)/**", "apps/web/src/components/product/**"]
---

# Product (authenticated app) UX

- The `product-screen` skill is MANDATORY for any create/edit here — a `PreToolUse` hook (`.claude/hooks/product-screen-guard.mjs`) loads it automatically; you never wait to be asked.
- **Goal, not table**: design from the user's job and what success looks like. Never default to a CRUD table of rows — that shape is allowed only when the job really is scan/compare/manage many rows.
- **Never a blank screen**: every zero-data view uses `EmptyState` (icon + why + the ONE next action). A brand-new user must find a path to value (the aha moment).
- **Onboarding never diverts attention**: a setup or onboarding screen (`/configurar`, the setup on the home, any `SetupWizard`) carries nothing that leads away from finishing it: no link to another screen, no "see more", no list of things to explore. Each step does its work in place (dialogs, inline forms, the second factor in the step); what is information for later lives on the home or its own page. A line of modules with "Ver módulos" on the first step of `/configurar` took the owner out of a setup half done (2026-10-30).
- **Prerequisites come first**: in a setup or any multi-step flow, whatever a later step cannot be done without (the second factor, a role, a connection, a fact the database checks) is its own step before the first step that needs it, and the flow does not advance past it until it is met. Never let a person reach a step and find it locked by something an earlier step could have settled. The second factor is the first step of `/configurar` for this reason (2026-11-03): it was asked inside six steps, and blocked the owner at the first.
- Long setups use `SetupWizard` (progressive disclosure); steps to first result use `OnboardingChecklist` + `@flyee/onboarding` (state only; step definitions live in the project's code).
- **Engagement**: completion drive (`ActivationProgress`) and competence feedback only. Never ship points, badges, leaderboards or streaks — documented failures, and streaks carry regulatory risk.
- MUI v9 + theme tokens only, next-intl for every string, inline form errors near the field, skeletons that reserve space.
- **Semantic fields**: phone, CPF/CNPJ, CEP and money never go in a raw `TextField` — use `components/product/fields/*` (mask + check-digit validation + CEP auto-fill via `@flyee/fields`); persist `onlyDigits()`, never the masked string.
