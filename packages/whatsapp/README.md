# @flyee/whatsapp

WhatsApp of ONE behind a provider interface (`docs/ONE-PLANO-DESENVOLVIMENTO.md`, sections 3.2, 4.6 and 6). Each firm connects its own number through the official Cloud API, and a provider instance speaks for ONE number of ONE firm.

The package is pure: no database, no environment, no framework. It reads what the vendor sends, speaks to the vendor, and holds the rules a screen needs before the database is asked. What may be sent is decided in the database (`reserve_wa_send`, migration `0019_whatsapp`); the app wires the two (`apps/web/src/lib/whatsapp/*`).

## What is here

| File | What it is |
|---|---|
| `src/types.ts` | `WhatsAppProvider` (`send`, `fetchMedia`, `listTemplates`, `createTemplate`), `OutboundMessage`, `TemplateSubmission` and `TemplateCreated`, `SendResult` with the refusals a caller branches on, `MediaResult`, and `WhatsAppEvent`: everything a webhook delivery can say, in the platform's own words |
| `src/webhook.ts` | `verifySignature` (the HMAC of the RAW body, compared in constant time) and `parseWebhook` (messages, statuses, the coexistence fields, account and template events, a template's new category once the change is made). What it does not know yields nothing, never an exception |
| `src/rules.ts` | `isWindowOpen`, `renderTemplate`, `checkTemplate` (the vendor's limits as errors; a promise of result, a word about price and the marketing category as warnings for the lawyer), `failureCodeOf` |
| `src/providers/meta.ts` | `MetaProvider` (the Cloud API for one number, and the submission of a utility template to its account with positional values and an example of each) and what connecting a firm takes: `exchangeSignupCode`, `subscribeApp`, `registerNumber`, `requestCoexistenceSync`, `getNumberInfo`, `listAccountNumbers`, `unsubscribeApp` |
| `src/simulator.ts` | `SimulatorProvider` (a template submitted to it is approved at once as a utility message; it keeps no memory, so the platform hands back the templates it recorded for the simulated account) and the deliveries the vendor would post (a person writes, a status, an echo from the firm's phone, a disconnection), in the vendor's shapes and signed, so they enter by the same door as the real ones |
| `src/*.test.ts` | The contract every provider keeps, the parser against the vendor's payload shapes, the rules |

`npm test -w @flyee/whatsapp` runs them (42 tests).

## Rules

- **A send never throws.** A refusal is an answer the caller records: `window_closed`, `invalid_recipient`, `token_invalid`, `rate_limited`, `unavailable`, or `rejected` with the vendor's code as `detail`. The vendor's own text is never passed on: it can quote the message.
- **Not knowing is its own answer.** When the vendor did not answer at all (a timeout, a line that dropped) or a server error named nothing, the message may have gone out before the line went quiet: that is `unconfirmed`, never "not sent, try again", because sending it again could deliver it twice. `unavailable` is kept for when the vendor itself says it could not take the message. A template submitted with no answer, or with a server error whatever it names, is `unconfirmed` too: the account may have it, and the next reading of its templates says.
- **A media is given up only when the vendor says it is gone.** `fetchMedia` answers `fetched`, `gone` (the vendor keeps a media for 7 days) or `later` (no answer, a rate limit, a token that did not work): the caller tries `later` again and never records it as lost.
- **One code per failure.** `failureCodeOf` (a send refused at once) and `vendorFailureCode` (a status that arrives later) give the same words, so a screen has one list to read.
- **A delivery is authentic or it is nothing.** `verifySignature` runs over the raw body before anything is parsed. The app accepts the vendor's app secret, and the simulator's own secret only while the simulator is on.
- **The firm's token comes from the vault**, handed to `MetaProvider` by the caller, with the API version from configuration (`platform_settings`, key `whatsapp`). Nothing here reads an environment variable.
- **The simulator stands where the vendor stands, on both sides.** It never reaches the network, a number connected to it is marked `simulator` in the database, and an event signed by it can only touch numbers so marked.
- **The check of a template points and decides nothing.** Whether a sentence breaches the bar's rules on advertising (CFOAB, Provimento 205/2021) is the lawyer's to say.

## What was verified, and what was not

The vendor's shapes and steps were read in Meta's reference on 2026-10-09: the webhook envelope and its fields (`messages`, `smb_message_echoes`, `smb_app_state_sync`, `history`, `account_update`, `message_template_status_update`), the error codes a send answers, Embedded Signup v4 (the code lives 30 seconds; `FINISH`, `FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING`, `CANCEL`), the coexistence syncs (contacts, then history, once each, within 24 hours) and its disconnection (`PARTNER_REMOVED`), subscribing and unsubscribing the app. The creation of a template (`POST /{waba}/message_templates` with its name, language, category, `parameter_format` and components, the body's example values as one list, and the answer's id, status and category) and the field `template_category_update` (a change announced, with `correct_category` and the day it takes effect, and a change made, with `previous_category` and `new_category`) were read on 2026-10-11.

**None of it ran against Meta**: ONE has no Meta app yet. The contract tests answer from the response shapes of the reference, with invented ids and tokens; when ONE has an app and a test number, the same tests take recordings of real calls.

## Known limits

- A template is sent with the values of its body, in order (`{{1}}`, `{{2}}`). One with named placeholders, a value in the header or a button with a dynamic address is listed and, if sent, refused by the vendor with its code.
- ONE submits the templates of the notices to clients (migration 0038) and nothing else: any other template is created in Meta's WhatsApp Manager, and ONE lists it with its approval and checks its text. Meta may call a utility template marketing; such a notice stays off until its text is changed.
- An edit or a deletion made on the firm's phone is not mirrored yet.
- A template's status event carries no order: one delivered late can put back a status the account has since left, until the next sync of the templates corrects it.
- The firm sends text and templates from the conversations screen. The database and the provider already carry an image or a PDF of the firm's files; the screen to attach one comes with the client's folder (M2).
