# apps/web boundaries

- `apps/web` is the only app in this repo. Code shared between the app, the jobs and tooling lives in `packages/*`.
- Do not redefine theme tokens locally (`--primary`, `--grey-*` etc.) — they come from `@flyee/design-tokens`.
- This repo IS the ONE product: the platform for law firms (accounts, firms, cases, documents, courts, messaging, billing of the ONE subscription). Domain rules that decide something (forum, deadlines, prescription, eligibility) live in a package as pure functions with tests, never inside a page or a route handler.
- A page or route never talks to a vendor directly: it goes through the package adapter (real, fake, contract test), and through an RPC that receives the firm when it writes.
- The flyee.club surfaces (CLI delivery and OAuth, the module catalog, the club screens and consoles) are being removed in M0: do not build on them or extend them.
