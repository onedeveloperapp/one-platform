# @flyee/signatures

Electronic signature of the documents a firm's client signs (the power of attorney, the fee agreement, the declarations), behind a provider interface (`docs/ONE-PLANO-DESENVOLVIMENTO.md`, sections 4.6, 6 and 7).

This is not the lawyer's signature. A lawyer signs inside the court's own system when filing, with whatever certificate that system takes (A1, A3 or cloud). ONE never receives a certificate, a PIN or a password.

## What is here

| File                       | What it is                                                                                                                                                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/types.ts`             | `SignatureProvider` (`createEnvelope`, `getStatus`, `downloadSigned`), the envelope and its states, `EnvelopeNotSignedError`; `AccountSignatureProvider` (a firm's own account, which also cancels) with `SignatureAuthError` and `SignatureUnavailableError` (its status and a short code) |
| `src/fake.ts`              | `FakeSignatureProvider`: a test opens an envelope and plays the client with `sign`, `refuse` and `expire`                                                                                                                                                                                   |
| `src/providers/zapsign.ts` | `ZapSignProvider`: the firm's ZapSign account by its API token, `registerWebhook`, and `readZapSignWebhook` for a delivery                                                                                                                                                                  |
| `src/providers/d4sign.ts`  | `D4SignProvider`: the firm's D4Sign account by its `tokenAPI` (and `cryptKey` where the account enabled it) and its safe, `listSafes`, `d4signWebhookUrl` and `readD4SignWebhook` for a delivery                                                                                            |
| `src/contract.test.ts`     | What any provider must do. Runs against the fake and against stand-ins of ZapSign and of D4Sign that answer in the shapes of their references                                                                                                                                               |

`npm test -w @flyee/signatures` runs the contract.

## ZapSign

Read in ZapSign's API reference on 2026-10-09 (docs.zapsign.com.br): a document is made from a base64 PDF with its signers (`POST /api/v1/docs/`), read back with its status and each signer's `signed_at` (`GET /api/v1/docs/{token}/`; `pending`, `signed`, and `recusado` once refused), and its signed file is a link that lasts 60 minutes. The sandbox (`sandbox.api.zapsign.com.br`) answers the same and signs nothing with legal validity.

ZapSign does not sign the body of a webhook. When a firm connects, ONE points the account's one webhook at `/api/webhooks/zapsign` with a header of its own (`x-one-webhook-secret`) carrying a random secret, sealed in the vault with the token. A delivery is taken only when it names an envelope ONE opened (`external_id`) and carries that firm's secret, compared in constant time; what it says is never the state: the envelope is read again from ZapSign.

The token is the firm's (each firm pays its own ZapSign account), sealed in the vault (migration 0017) with the secret and the environment. ONE sends the signing link itself (the client's page, the conversation): ZapSign writes to nobody.

None of it ran against ZapSign yet: the provider is proven with the stand-in, and the first sandbox account is where it gets checked.

## D4Sign

Read in D4Sign's API reference on 2026-11-17 (docapi.d4sign.com.br, its Markdown and OpenAPI pages, its public Postman collection, its official PHP SDK and its help center): a document goes into one of the account's safes from a base64 PDF (`POST /documents/{safe}/uploadbinary`), takes a webhook of its own (`POST /documents/{uuid}/webhooks`), its signers by e-mail (`createlist`, a `key_signer` each) and is sent to signature with no e-mail of D4Sign's (`sendtosigner`, `skip_email` "1"); each signer's own address comes from `GET /documents/{uuid}/signaturelink/{decoded key_signer}`. `GET /documents/{uuid}/list` reads the phase (`statusId`: 4 finished, 6 cancelled) and each signature; `download` hands a temporary address of the signed PDF; `cancel` ends one still waiting.

The keys go in the address of every call (`tokenAPI`, and `cryptKey` only where the account enabled it), so an address of a call is never logged. Production is secure.d4sign.com.br; the sandbox is an account of its own at sandbox.d4sign.com.br, signing nothing with legal validity, with its API turned on by D4Sign's support.

What shaped the provider, and what to check in the sandbox before production (the full list is in the research notes of 2026-11-17):

- **A limit of 10 calls an hour** per account by default ("Você terá um limite de 10 requisições por hora", raised by D4Sign's sales). A document costs four calls and one per signer, and the signed PDF one more. Its webhook says what happens, and the sweep asks a D4Sign envelope once a day (0254). The limit is read from a 429 or from D4Sign's words, but only in a refusal or in a success that is nothing but a message, never in a document's name or a signer's comment; an opening that meets it is given back to wait an hour (`provider_rate_limited`, `record_signature_retry` in the app), never failed.
- **Every signer is an e-mail address**, to which D4Sign sends a token at the moment of signing even when the address reaches the signer another way ("essa camada de segurança não pode ser removida"). A signer with no e-mail is refused before anything leaves (`signer_email_missing`).
- **The webhook comes as form data** and is taken here by the secret ONE writes in its own address (`d4signWebhookUrl`): D4Sign's HMAC takes a third key of the account, and its pages disagree on what it covers. A delivery only says something happened; the document is read again.
- A document left half made by a refusal or a failure is cancelled at D4Sign before the error goes on. When the cancel meets the hour's limit too, the document stays in the safe as a draft nobody was sent.
- **Two signers on one e-mail** are refused before anything leaves (`signer_email_shared`): D4Sign would give them one code.
- **A 401 or "check api user"** is the keys' end (`D4SignAuthError`); **a 403** is an access refused (`provider_forbidden`: a safe or a document the API user may not reach), and **a 404 on the upload** is a safe D4Sign does not know (`safe_not_found`).
- `downloadSigned(id, known)` takes the state the caller just read, so the download asks no status again.
- D4Sign takes no minor as a signer of their own: a paper a minor of 16 or 17 signs beside who assists them (0224) is to be checked in the sandbox.
- To check: whether `createlist` and `/list` answer one object or a list for several signers (both are read), the order `/list` gives the signers (who signed when is read by the order of their `key_signer`), what D4Sign answers once its limit is reached, the encoding of the webhook's form, and what a signer still receives with `skip_email`.

None of it ran against D4Sign yet: the provider is proven with the stand-in, and the pilot firm's sandbox account is where it gets checked.

## In the app

Migration 0023 holds the envelopes: reserved by a person of the firm, claimed and opened by the backend (`apps/web/src/lib/signatures/work.ts`), signed when ZapSign says so (the signed PDF kept in the firm's files and added to the case), or ended. The fallbacks are there too: the client signs the PDF at gov.br (`assinador.iti.br`, with an account prata or ouro) and sends it back through their link, or the act is made at a notary through e-Notariado; a person of the firm confirms the signed file.

## Rules

- An envelope is opened only after the database reserved it (claim, then send): a retried job never sends two signing requests for the same document version.
- A refused or expired envelope never becomes signed. A new version of the document opens a new envelope.
- The signed file is stored with its hash; the case shows the hash, never trusts a file name.
