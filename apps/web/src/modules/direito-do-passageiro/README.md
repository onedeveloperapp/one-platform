# Direito do Passageiro (module)

The first product module of ONE: air passengers' claims against airlines. The owner decided on 2026-10-29 that it is
one module among the ones to come, separated from the core, with an area of its own for the travel agency a firm
partners with.

## What is the module's

- `definition.ts`: what the core asks of the module (`lib/modules/types.ts`): its key and name, and its kinds of
  problem (`incidents.ts`, stored in `cases.incident`).
- `jobs.ts`: the module's jobs, which the core's list of jobs takes through `lib/modules/jobs.ts`.
- `flights/`: each leg of a case checked against ANAC's official record, the weather and the status of a flight at
  FlightAware (`packages/flights` holds the vendors' adapters).
- `flight-alerts/`: the trips ONE follows and its first word to a passenger when a flight has a problem.
- Its routes live in a route group named after it, `app/**/(direito-do-passageiro)/...`.

In the database: `cases.module` says the module of a case (migration 0068), and the passenger's own columns
(`incident`, `airline_iata`, `flight_date`, the Tema 1.417 triage, the weather, the family's choice), the legs of the
trip (`flight_segments`), the trips followed (`tracked_trips`, `tracked_legs`, `flight_alerts`) and the flight checks
(`flight_checks`) are the module's. A new table of the module carries a prefix of its own.

## How the core reaches it

The core never imports this folder. It asks `lib/modules/registry.ts` (the kinds of problem, their words, the words
a model reads for each) and `lib/modules/jobs.ts` (the jobs). The lint refuses any other import of `@/modules/`
outside the module, its route group and the tests (`eslint.config.ts`).

## What is still in the core

From before the module had a folder of its own, these still reach into it directly, listed in
`lib/modules/boundary.ts` (`LEGACY_MODULE_IMPORTS`, kept exact by `lib/modules/boundary.test.ts`): the case page and
its trip card (the flight checks and the weather), the case's writes that ask for a flight check, the dossier, the
weather read for the Tema 1.417 triage, the status of a flight in the operator's console and in the test chat, and
the trips of the test chat. Beside them, still passenger-shaped in the core: the rules of the forum, of the kind of
proceeding and of the Tema 1.417 in `packages/rules`, the trip on the client's link, the instructions of ONE in the
conversation (`atendimento.conversa`) and the marks of a piece. Each is a seam to move here or behind the registry
when a second module needs it.

## A new module

A folder `src/modules/<key>/` with its `definition.ts` (and `jobs.ts` when it has jobs), a row of `product_modules`
in a migration, its definition added to `lib/modules/registry.ts` (and its jobs to `lib/modules/jobs.ts`), and its
routes in a route group named `(<key>)`. Kinds of problem are unique across modules: a kind names its module by
itself.
