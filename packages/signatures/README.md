# @flyee/signatures

Electronic signature of the documents a firm's client signs (the power of attorney, the fee agreement, the declarations), behind a provider interface (`docs/ONE-PLANO-DESENVOLVIMENTO.md`, sections 4.6, 6 and 7).

This is not the lawyer's signature. A lawyer signs inside the court's own system when filing, with whatever certificate that system takes (A1, A3 or cloud). ONE never receives a certificate, a PIN or a password.

## What is here

| File | What it is |
|---|---|
| `src/types.ts` | `SignatureProvider` (`createEnvelope`, `getStatus`, `downloadSigned`), the envelope and its states, `EnvelopeNotSignedError` |
| `src/fake.ts` | `FakeSignatureProvider`: a test opens an envelope and plays the client with `sign`, `refuse` and `expire` |
| `src/providers/zapsign.ts` | `ZapSignProvider`: the firm's ZapSign account by its API token, `registerWebhook`, and `readZapSignWebhook` for a delivery |
| `src/contract.test.ts` | What any provider must do. Runs against the fake and against a stand-in of ZapSign that answers in the shapes of its reference |

`npm test -w @flyee/signatures` runs the contract.

## ZapSign

Read in ZapSign's API reference on 2026-10-09 (docs.zapsign.com.br): a document is made from a base64 PDF with its signers (`POST /api/v1/docs/`), read back with its status and each signer's `signed_at` (`GET /api/v1/docs/{token}/`; `pending`, `signed`, and `recusado` once refused), and its signed file is a link that lasts 60 minutes. The sandbox (`sandbox.api.zapsign.com.br`) answers the same and signs nothing with legal validity.

ZapSign does not sign the body of a webhook. When a firm connects, ONE points the account's one webhook at `/api/webhooks/zapsign` with a header of its own (`x-one-webhook-secret`) carrying a random secret, sealed in the vault with the token. A delivery is taken only when it names an envelope ONE opened (`external_id`) and carries that firm's secret, compared in constant time; what it says is never the state: the envelope is read again from ZapSign.

The token is the firm's (each firm pays its own ZapSign account), sealed in the vault (migration 0017) with the secret and the environment. ONE sends the signing link itself (the client's page, the conversation): ZapSign writes to nobody.

None of it ran against ZapSign yet: the provider is proven with the stand-in, and the first sandbox account is where it gets checked.

## In the app

Migration 0023 holds the envelopes: reserved by a person of the firm, claimed and opened by the backend (`apps/web/src/lib/signatures/work.ts`), signed when ZapSign says so (the signed PDF kept in the firm's files and added to the case), or ended. The fallbacks are there too: the client signs the PDF at gov.br (`assinador.iti.br`, with an account prata or ouro) and sends it back through their link, or the act is made at a notary through e-Notariado; a person of the firm confirms the signed file.

## Rules

- An envelope is opened only after the database reserved it (claim, then send): a retried job never sends two signing requests for the same document version.
- A refused or expired envelope never becomes signed. A new version of the document opens a new envelope.
- The signed file is stored with its hash; the case shows the hash, never trusts a file name.
