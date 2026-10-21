---
paths: ["apps/web/src/icons/**", "apps/web/src/app/**"]
---

# Icon contract

- Pages import icons only as `@/icons/nexture/ni-*` (the alias may be remapped per project to an adapter set — see `apps/web/src/icons/README.md`). Never import an icon library (Phosphor, Lucide, MUI icons for decoration) directly in a page.
- Every icon component implements `NextureIconsProps` (`size`, `variant`, `className`, `oneTone`) and is a default export. The props type and the size helpers live in `src/icons/nexture-icons.ts`, which imports NO icon (every icon file imports it).
- `src/icons/icon-registry.tsx` (`IconMap`, `NextureIcons`) maps names to components and imports the whole set. Use it only where the icon name is data (the dashboard menu, a catalog icon typed by the operator); a client component that imports it ships every icon to the browser.
- Alternative sets live in sibling folders (`src/icons/phosphor/`, ...) with identical file names; gaps are filled by `npm run icons:stubs -w @flyee/web` (fallback re-exports, never overwritten).
- Adapters import icon libs from their SSR-safe entry (e.g. `@phosphor-icons/react/dist/ssr`) so they work in Server Components.
