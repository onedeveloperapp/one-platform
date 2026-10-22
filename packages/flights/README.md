# @flyee/flights

Flight facts of ONE behind interfaces (`docs/ONE-PLANO-DESENVOLVIMENTO.md`, sections 4.6 and 6): what happened to a flight, the weather observed at an airport, and the official record of the flights operated in Brazil. They are evidence for a case and input for its triage. Whether a delay gives a claim is a rule in `packages/rules`, never decided here.

## What is here

| File | What it is |
|---|---|
| `src/types.ts` | `FlightStatusProvider` (`getFlightStatus`), `WeatherProvider` (`getMetar`), their records, and `arrivalDelayMinutes`, the one way a delay is counted |
| `src/fake.ts` | `FakeFlightData`: a test declares the flights and observations, and reads them back through both interfaces |
| `src/vra.ts` | ANAC's official monthly record of the flights operated in Brazil (VRA): the address of a month's file, its header read by the names of the columns, each line as a flight (`parseVraLine`) or as a leg no schedule foresaw (`parseVraUnscheduled`), and `zonedInstant`, a wall time of a zone as the instant it was |
| `src/check.ts` | How a leg of a case is checked (`conferencia-voo-v1`): which flight of the record is the leg's (`matchLeg`: the airline's own number, a codeshare, or the route for an airline the platform does not know; from the leg's origin, at the ticket's time), the legs of the same flight no schedule foresaw tied to it (`withUnscheduled`), and how what the case says stands against a source (`compareLeg`: agrees, differs, cancelled, diverted, nothing to compare), with the source's own delays and, for a cancelled flight whose aircraft went on by those legs, when it reached the destination |
| `src/providers/redemet.ts` | `RedemetProvider`: the reports (METAR) of Brazilian airports from REDEMET (DECEA), with the platform's key. Its reference was read on 2026-10-09; it has not run against REDEMET yet |
| `src/providers/anac-vra.ts` | `AnacVraSource` (`FlightRecordSource`): a month of ANAC's record from the public file, read as it arrives and never held whole; its encoding told by its first line (UTF-8 from 2021, Latin-1 before); a month read whole, missing (404) or unavailable with why, never a month of no flights when it was not read. Its first lines of June 2021, December 2018 and March 2016 were read on 2026-10-10 |
| `src/providers/flightaware.ts` | `FlightAwareProvider`: what happened to a flight anywhere, from FlightAware's AeroAPI, with the platform's key: the recent and scheduled flights, and the history from 2011. Written from its OpenAPI reference (4.17.1, read on 2026-10-10); it has not run against AeroAPI yet. A status says when the flight is now expected at its destination (`estimatedArrival`: the arrival once it landed, before that AeroAPI's `estimated_in` or `estimated_on`, of the same kind as the other times), which is how ONE sees a delay coming before the flight lands |
| `src/contract.test.ts` | What any provider must do. Runs against the fake, against REDEMET and against AeroAPI with stand-ins in the shapes of their references |
| `src/check.test.ts` | The record read from lines in the form of a real file, the matching and the comparison, as tables |

`npm test -w @flyee/flights` runs both.

## Which source, for what (evaluated on 2026-10-10)

| | ANAC VRA | FlightAware AeroAPI | Flightradar24 API |
|---|---|---|---|
| What it is | The official record: the schedule each airline registered, joined to what it reported as flown | A company that joins airline, air traffic and ADS-B data | A network of ADS-B receivers |
| Scheduled times | Yes | Yes, at the gate and on the runway | No |
| Actual times | Yes | Yes, at the gate and on the runway | Takeoff and landing only |
| Cancellation | Yes, as the airline reported it | A flag that means "no longer tracked", of which a cancellation is one reason | No: a flight that did not fly is simply absent |
| Flights covered | The scheduled flights operated in Brazil, domestic and international | The world | The world |
| When it is there | A month's file comes out about five weeks after the month ends | At once, and history from 2011 | At once; history from 2016, as deep as the plan pays for (30 days, 2 years, or all) |
| Cost and licence | Free, public data | Standard from US$ 100 a month, licensed for internal business and business-to-consumer use; selling it on to other businesses (B2B) only in Premium, from US$ 1,000 a month | From US$ 9, 90 or 900 a month by credits; commercial use allowed, the terms of showing it to third parties not read |
| Weight as evidence | An official record | A private source, as a print is today | A private source |

What ONE uses:

- **The VRA first**, for every leg of a case: it is official, free, and says what the airline itself reported, cancellations included. Its one gap is time: a flight of the last weeks is not in it yet, and a flight entirely abroad never is.
- **FlightAware for what the VRA cannot answer**: a recent flight, a leg abroad, and later (M4) a flight followed while it happens. Asked on demand, by a person, each answer recorded. Whether ONE's use (software sold to firms, which reads it for them) fits Standard or needs Premium is a question for FlightAware's sales, before a key goes to production.
- **Flightradar24 is not used**: with no scheduled time and no cancellation, it cannot say a flight was late or cancelled, only when an airplane took off and landed, which the other two already say.
- AeroDataBox, the plan's first choice, gave way to these.

## What joins, and when

| Integration | Interface | Milestone |
|---|---|---|
| REDEMET, the weather observations of Brazilian airports | `WeatherProvider` | built in M2 (S6) |
| ANAC's VRA, the official record of the flights operated in Brazil, a month at a time | `vra.ts` and `check.ts`, read by the case's flight check | built in M3 |
| FlightAware, what happened to a flight anywhere | `FlightStatusProvider` | built in M3 (a check asked by a person); a flight followed while it happens built in the adjustments before the tests, phase 4 (migration 0051: the trips ONE follows read in their window, within the platform's daily reads, `apps/web/src/lib/flight-alerts/watch.ts`) |

## Rules

- The delay is counted at the arrival at the destination, in whole minutes, by `arrivalDelayMinutes`. A cancelled flight and a flight that landed somewhere else have no delay: they are their own facts.
- A record keeps what the source said. Interpretation (was it the weather, was it the airline) belongs to the triage, with a lawyer's approval.
- Every time of the VRA is Brasília time, whatever the airport; a ticket prints each airport's local time. They are compared as instants, with each airport's offset, and never as words.
- A source that does not know a flight says nothing about it: "not found" is never "did not fly".
- "Cancelled" in the VRA is the planned flight. The file of August 2026 (read on 2026-10-10) had 2,307 lines with no scheduled time, all flown: legs no schedule foresaw, numbered as the flight with a "Z" before it and dated by the flight's day ("Referência"), each named by a code of Portaria nº 1.190/SRE of 2011 (as amended by Portaria nº 906/SAS of 2018): 2 an extra leg, 3 a return to the origin, 4 a leg included in a scheduled flight, 6 a leg nobody paid for, 7 and 9 charters, D a leg carried by another flight of the airline (1 and E are not in that text, and are read as "another leg"). The check ties to a flight the legs of its airline, number and day, leaving out 6, 7 and 9, which carry no passenger of the flight. 191 of that month's 2,560 cancelled flights had their aircraft reach the destination by such legs (American's 950 of 13 August: Guarulhos to San Juan, then New York, 3 h 52 min after the scheduled arrival). The screens and the dossier say so as what the aircraft did; the record does not say who was on board.
- About 200 flights a month that do have a schedule (code 0) are also numbered with a "Z", on days the plain number does not fly: the ticket's number is the one after it, and they are read by it.
- One number may fly several legs on a day (2,076 flight-days in August 2026, 728 of them Gol's, Azul's and LATAM Brasil's): a ticket is followed through its stops to its destination, departing with its first leg and arriving with its last; a flight that never reaches the ticket's destination is said to end elsewhere, and only its departure is compared. A month's file holds a flight by the day its first leg was scheduled ("Referência"), up to two days before a later leg's.
- A month ANAC answers 404 for is not out yet; one that never comes is a check given up, never "no such flight": a file not read says nothing.
