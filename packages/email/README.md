# @flyee/email

The e-mails the platform sends to the people of a firm and to contacts of the list: the Resend client, the React Email templates and their copy, in Portuguese.

## Contract

- Server-only (uses `RESEND_API_KEY`); never import from client components.
- Every sender takes the reader's address and the template's props, picks the subject from the copy, and returns `{ sent: boolean, error? }`. **None of them throws.** Without `RESEND_API_KEY` they return `{ sent: false }` with no error, so a caller can tell "there is no provider" from "the provider refused".
- A caller always has a path that works without e-mail: the bell notice is written either way, the link stays on the page, the form says the list is unavailable.
- ONE writes in Portuguese only. `EmailLocale` is a union of one (`"pt-BR"`) and every sender still takes `locale`, so a second language is added in `src/locale.ts` and `src/copy/` and the compiler names what has to learn it. Dates and amounts arrive already formatted for the reader: a template never formats.

## Copy

`src/copy/pt-BR.ts` is the structural source of truth: `EmailCopy` is its type. Three rules for whoever edits it:

- the copy rules of the root `CLAUDE.md` hold: no dash, no exclamation mark, no emoji, none of the banned words (`apps/web/src/lib/i18n/copy-rules.test.ts` reads this file);
- a plan is called by the name it has in the data (`plans.name`), never by a word written in the copy, and no sentence depends on the grammatical gender of that name;
- a sentence that states a time ("within 24 hours") has to be true anywhere inside the window the message is sent in.

## Templates

`src/templates/` holds one React Email component per message, all inside `shell.tsx` (language on the document, preview line, one card, small print, signature). Inline styles only: e-mail clients ignore stylesheets, so the colours in `shell.tsx` are the light values of `packages/design-tokens` copied by hand. Keep them aligned when the palette changes. The button carries the charcoal label on the primary colour, not white, for contrast.

| Sender | Message | Can the reader stop it? |
| --- | --- | --- |
| `sendMemberWelcomeEmail` | a new account is confirmed | no (about the account) |
| `sendKitReceiptEmail` | receipt of a one-time access, with the end date the grant has | no (a receipt) |
| `sendSubscriptionActiveEmail` | a subscription is live | no |
| `sendSubscriptionCanceledEmail` | a subscription ended: why, and whether another purchase keeps the account active | no |
| `sendAccessEndedEmail` | the term of a one-time access ran out | no |
| `sendTermEndingEmail` | a paid period that does not renew is about to end | no |
| `sendLeadConfirmationEmail` | the waitlist's double opt-in link | no (it answers a request) |
| `sendNewsletterBatch` | a message the operator wrote to the confirmed list (Markdown) | **yes** |
| `sendContactFormEmail` | the public contact form, forwarded to the operator | no |

The billing messages follow the inherited ladder (a one-time access and a subscription) and are rewritten with ONE's subscription tiers in M3. M1 adds the invitation of a colleague and a reply-to per firm.

A message the reader can stop carries its unsubscribe address twice: as a link in the small print and as `List-Unsubscribe` + `List-Unsubscribe-Post` headers (one click, RFC 8058). The caller builds that address and decides who is left out; this package never reads a preference.

The batch sender sends up to `BATCH_LIMIT` (100) messages in one request, each to its own reader with its own content. A batch is all or nothing: on an error nobody is counted as sent, and the caller's bookkeeping decides who is tried again.

## Tests

```bash
npm run test:email     # from the repo root
```

`src/templates.test.tsx` renders every template and checks the language on the document, that only the stoppable messages carry an unsubscribe link, and the rules a template states (the receipt's end date, why a subscription ended). No test sends anything.

## Env vars (apps/web/.env.local)

```
RESEND_API_KEY=        # server-only
EMAIL_FROM=            # verified sender, e.g. "ONE <nao-responda@seu-dominio.com.br>"
CONTACT_FORM_TO=       # where the contact form goes (falls back to EMAIL_FROM)
```

Without a verified domain, Resend only delivers from `onboarding@resend.dev` to your own account e-mail, which is enough for development.

## Supabase auth e-mails

Confirmation, password recovery and e-mail change are sent by Supabase Auth, not by this package. Their templates are in `supabase/templates/` and still carry the previous product's texts: they are rewritten when the ONE Supabase project is created.
