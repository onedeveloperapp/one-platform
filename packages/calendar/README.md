# @flyee/calendar

A firm's calendar of hearings, behind an interface (`docs/ONE-PLANO-DESENVOLVIMENTO.md`, section 6: "Agenda (Google): `upsertEvent` na agenda criada pelo ONE"). A person of the firm connects a Google account; ONE creates in it one secondary calendar of the firm's hearings and writes each hearing there as an event under an id of its own, so the same hearing written again replaces its event and a cancelled one is taken out.

## What is here

| File | What it is |
|---|---|
| `src/types.ts` | `CalendarProvider` (`authorizationUrl`, `exchangeCode`, `createCalendar`, `calendarAccess`, `upsertEvent`, `deleteEvent`, `revoke`), `CalendarEvent`, the grant, `CALENDAR_SCOPE` and the errors: `CalendarAuthError` (the grant no longer holds: the firm connects again), `CalendarGoneError` (the calendar was deleted in Google), `CalendarUnavailableError` (no answer, a limit, an outage: later), `CalendarQuotaError` (the platform's project out of its day: every firm waits, and a worker stops and gives back what it took), `CalendarRequestError` (what was sent was refused) |
| `src/event-id.ts` | `eventIdOf`: the event's id of a hearing, the 16 bytes of its uuid in base32hex (26 characters of `0-9a-v`) |
| `src/fake.ts` | `FakeCalendarProvider`: the calendars and their events in memory, the grants that hold, and the failures a test asks for. `lenient` for a server of more than one instance (a preview): any instance takes a grant and a calendar of the fake's own form, since each instance has its own memory |
| `src/providers/google.ts` | `GoogleCalendarProvider`: OAuth 2.0 for web server applications and the Calendar API v3, written from Google's references (read on 2026-10-11) |
| `src/contract.test.ts` | What any provider must do. Runs against the fake, and against the Google provider talking to a stand-in that answers in the shapes of Google's references |

`npm test -w @flyee/calendar` runs the contract and the test of the event's id.

## Google

- **One scope**: `https://www.googleapis.com/auth/calendar.app.created`, "Make secondary Google calendars, and see, create, change, and delete events on them". ONE never reads the account's other calendars, its events or its contacts. Sharing the calendar with the rest of the firm is done in Google by the person who connected it (asking `calendar.acls` too would let ONE change the sharing of every calendar the account owns).
- **The grant**: the consent asks `access_type=offline` and `prompt=consent select_account`, so a refresh token always comes back and is of the account the person picks, not whichever is signed in; it is sealed in the vault (`packages/connectors`) and opened by the backend once per connection and round of work. An access token lasts an hour and is asked again with it, once, when the API answers 401. A refresh answered with `invalid_grant` is a grant that no longer holds: revoked by the account, unused for six months, or, **while the project's consent screen is in Testing, older than seven days**: the firm connects again. Google keeps 100 grants per account per client; a 101st invalidates the oldest. Revoking a token revokes every grant the account gave the project, so a grant is given back only when the firm disconnects, never because something failed on ONE's side. No PKCE: the reference for web server applications names no such parameter, and a code is worth nothing without the client's secret, which never leaves the server.
- **Connecting again**: the account is asked whether it may still write the firm's calendar (`calendarList.get`, its `accessRole`): its own, or one shared with it to make changes, is taken again; one deleted, never shared with it, or shared only to be read is not, and a new calendar is made.
- **The events**: written with `PUT` by their id (a hearing changed, or one taken out and put back: Google keeps an event taken out and brings it back), created with `POST` and that id when the calendar does not have it, replaced when the id exists (409: another worker created it in between, or Google kept it); taken out with `DELETE` (204; 404 or 410 is one already gone). A 404 that remains is told apart by asking for the calendar: gone from the account, or there and the event cannot be written. `sendUpdates=none` everywhere and no guests: no e-mail goes to anybody. Each event carries the case's address in ONE as its `source`.
- **The errors** read from the Calendar API's list, in its old form (`errors[].reason`) and its new one (`details[].reason`, `status`): 403 with `rateLimitExceeded`, `userRateLimitExceeded`, `quotaExceeded`, `RATE_LIMIT_EXCEEDED` or `RESOURCE_EXHAUSTED`, 429 and 5xx pass with time; what is the platform's own and no firm's is `CalendarPlatformError`, for every firm at once: 403 with `dailyLimitExceeded` (the project out of its day, `CalendarQuotaError`), 403 with `accessNotConfigured` or `SERVICE_DISABLED` (the API off in the project), and the token endpoint refusing the client (`invalid_client`, `unauthorized_client`, `deleted_client`: a wrong or rotated secret); another 403 is a refusal of the grant.
- **A limit**: an event Google kept after somebody deleted it in the calendar, and then purged, answers 404 to a replacement and 409 to a creation under the same id; the hearing's id never changes, so its event cannot be written again there (`event_unavailable`, a request refused), and a new calendar takes it.

**The client is the platform's**: `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` (a Google Cloud project with the Calendar API on and an OAuth consent screen whose redirect is `/api/connections/google/callback`) live in the server's environment. Without them the card of the calendar says it is not available here and nothing is written anywhere. Publishing the consent screen out of Testing (with the scope's verification Google asks for) is what ends the seven days.

None of it ran against Google yet: the provider is proven with the stand-in, and the first consent with a real project is where it gets checked.

## Rules

- The refresh token is a vendor's token of the firm: sealed in the vault, never in a log, never in an error message. A disconnection gives it back to Google (`revoke`) before it is discarded.
- An event says what the firm's people need at the hearing and names nobody of the case: the kind, the case's number, the lawsuit's number and court, the time in the hearing's zone, the place or the link, who of the firm attends, and the case's address in ONE. A calendar is shared and shows on phones, and a name written there would outlive a correction or an erasure in ONE.
- Fixtures hold invented hearings only.
