# @flyee/chatwoot

The firms' panel of attendance behind an interface (migration 0223 of `packages/db`). The platform runs one
Chatwoot (the `whatsapp-support` kit, `packages/atendimento`), with one account per firm. ONE stays the one that
talks to WhatsApp: every message of a firm's conversations is written into an inbox of the API kind of its account,
and what a person of the firm writes there comes back through the inbox's webhook and goes out through ONE's
outbox, under ONE's rules. The team's rooms (migration 0238, the kit's D26) are inboxes of the team alone in the
same account: of the API kind with no webhook and no reply window, nobody assigned by rotation, one conversation
whose contact has no phone and no e-mail, its people the inbox's members and the conversation's participants
(`createTeamInbox`, `setInboxMembers`, `setParticipants`, `removeParticipants`, `renameInbox`, `renameContact`,
`conversationStatus`), so nothing written there leaves the panel and only who is in the room sees it.

- `src/types.ts`: the interface (`ChatwootProvider`: the platform's app, an account through a person's token, a
  person's preferences) and its errors.
- `src/providers/http.ts`: the HTTP provider, with the token as `Authorization: Bearer` (a proxy may drop the
  `api_access_token` header, which has an underscore).
- `src/fake.ts`: the panel in memory, on the same rules, which also writes the signed deliveries of an inbox's
  webhook, so a test drives ONE's webhook as Chatwoot does.
- `src/webhook.ts`: the signature of a delivery (`X-Chatwoot-Signature`, the HMAC SHA-256 of
  `"<X-Chatwoot-Timestamp>.<raw body>"` under the inbox's secret) and the events ONE acts on: what a person wrote to
  the client, and a change of a conversation's status.
- `src/contract.test.ts`: what any provider does, run against the fake and against the HTTP provider talking to a
  stand-in on the shapes of Chatwoot 4.19.1 (read in its code on 2026-11-12). The HTTP provider was also run once
  against the platform's instance on that day, in a throwaway account it deleted at the end: an account, its
  service person and token, an API inbox with its secret, a contact (the second of a number refused with 422), a
  conversation, messages with a file and a private note, a message's status, a conversation's status, the
  preferences, the login link, and the deletes. The rooms' calls were read in Chatwoot 4.19.1's code on 2026-11-13
  (`InboxMembersController#update` and `Conversations::ParticipantsController#update` make the list the whole
  membership, each participant in the inbox) and run against the stand-in; they have not run against the
  platform's instance yet.

`npm test -w @flyee/chatwoot` runs the contract test.
