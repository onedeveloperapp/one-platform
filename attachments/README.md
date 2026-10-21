# attachments/ — project input inbox

Drop zone for material the user hands to the project (brand art, page imagery, briefs, reference docs). It is **input waiting to be routed** — not documentation, not a permanent home. Agents move every file to its canonical location and this folder trends back to empty (only this README stays).

## Contract

1. When a task touches related work — and always during `/init-project` — check this folder first.
2. Route with `git mv` to the canonical home below; never leave copies behind.
3. Large binaries must not LIVE here (git history bloat): route or delete promptly.

## Routing table

| Material | Canonical home |
|---|---|
| Brand art (the lockup and the mark, as SVG, in their light, dark and one-colour versions) | `apps/web/public/brand/`, unedited. `apps/web/src/components/logo/logo.tsx` references those files and never redraws them. Every raster (the square mark, the home-screen tile, the `.ico` files) is GENERATED from the mark: `npm run brand:assets -w @flyee/web` |
| Page/marketing imagery (heroes, product screenshots, illustrations) | `apps/web/public/images/…` next to where the page uses it |
| Reference / inspiration screenshots (landing pages the user admires) | consumed by the `marketing-page` skill's Pass 0.R — structural ingredients recorded in `docs/DESIGN.md`, then deleted. **Blueprint mode** ("siga este modelo"): kept here until the built page passes the marketing-verify blueprint comparison, then deleted; never stored in the repo |
| Product brief / PRD | `docs/PRODUCT.md` (+ ~10-line summary in the root `CLAUDE.md`) |
| Page copy (the texts of a public page, such as the home) | `docs/<PAGE>-COPY.md` (the home's is `docs/HOME-COPY.md`), committed byte-exact as delivered, in its own commit, before the page is rebuilt from it. What the copy asks and the platform cannot back stays out of the page and goes back to the user as a decision |
| Reference documents meant for an AI knowledge base | the platform has none (the inherited knowledge base was removed in phase 1): ask the user |
| Fonts | wired via `next/font` in `apps/web` (license permitting), file next to its consumer |

Anything that fits no row: ask the user where it belongs before inventing a location.
