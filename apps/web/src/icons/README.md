# Icons

The template ships with the **Nexture** set (`nexture/`, 449 SVG components) and an adapter-based mechanism to swap the whole app to an alternative set per project.

## The contract

Every icon — original or adapter — is a default-exported component accepting `NextureIconsProps` (`size`, `variant`, `className`, `oneTone`; see [nexture-icons.ts](nexture-icons.ts)). Pages import icons as `@/icons/nexture/ni-*`, and the string-name registry (`IconMap` and the `NextureIcons` component, in [icon-registry.tsx](icon-registry.tsx)) resolves through the same alias. **Never import an external icon library directly in pages** — always go through an adapter folder that implements the contract.

Two files, on purpose. `nexture-icons.ts` holds the props type and the size helpers and imports no icon: every icon file imports it, so whatever it pulled in would ship with each icon. `icon-registry.tsx` imports the WHOLE set; a client component that imports it ships every icon to the browser. Use it only where the icon name is data (the dashboard menu, an icon the operator typed into the catalog). Until 2026-10-01 both lived in one file, and importing any single icon loaded all 429 on every page.

## Switching a project to Phosphor

1. Generate fallback stubs for icons without a real adapter yet:
   ```bash
   npm run icons:stubs -w @flyee/web
   ```
2. Uncomment the alias line in `apps/web/tsconfig.json`:
   ```jsonc
   "@/icons/nexture/*": ["./src/icons/phosphor/*"],
   ```
3. Restart the dev server. Everything that has a real adapter renders Phosphor; the rest falls back to Nexture until you replace its stub.

`phosphor/` starts with ~16 real adapters (bell, user, settings, chevrons, trash, etc.) wrapping [@phosphor-icons/react](https://phosphoricons.com). Replace stubs incrementally — the stub file tells you it is one.

## Adding another set (e.g. Lucide, Tabler)

1. Create `src/icons/<set>/` and write adapters following the Phosphor examples (same file names, same contract; import helpers from `../nexture-icons` and the icon lib from its SSR-safe entry point).
2. Run `npm run icons:stubs -w @flyee/web -- <set>` to fill the gaps with Nexture fallbacks.
3. Point the tsconfig alias at the new folder.
