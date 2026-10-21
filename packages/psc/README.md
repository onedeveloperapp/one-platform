# @flyee/psc

A lawyer's ICP-Brasil certificate in the cloud, behind an interface. A PSC ("Prestador de Serviço de Confiança") is a provider the ITI accredited to keep a person's certificate and sign with it: the holder authorizes an application at the PSC's own page with their own factors (an app, a PIN, a QR code), and the application then asks the PSC to sign hashes. The key never leaves the PSC, and the application never collects the holder's factors. ONE uses it to sign, with the lawyer's own certificate, the files that go to a court (the attached `.p7s` the Projudi of TJGO takes, built by `@flyee/documents/cms`), after the owner's decisions of 2026-10-14 (ONE keeps what an automation of its own needs of a lawyer's credentials) and 2026-10-15 (what needs no court's authorization first).

## What is here

| File | What it is |
|---|---|
| `src/types.ts` | `PscProvider` (`authorizeUrl`, `exchangeCode`, `certificates`, `sign`), the scopes (`single_signature`, `multi_signature`, `signature_session`; a token answer carries the scope the PSC says it granted, when it says one), `PscError` with what the caller does next (`denied`, `expired`, `token_used`, `refused`, `not_authorized`, `unavailable`), `SHA256_OID` and `MAX_PERSON_LIFETIME_SECONDS` (7 days) |
| `src/pkce.ts` | `newVerifier`, `challengeOf` (S256) and `newState`: the norm makes PKCE mandatory |
| `src/providers/iti.ts` | `ItiPscProvider`: one client for every PSC, as DOC-ICP-17.01 specifies its API, configured by the PSC's base address and by the two ways a PSC's own manual departs from the norm (a hash in hexadecimal, the token asked in JSON) |
| `src/certificate.ts` | `certificateFacts`: what a certificate says of its holder: the name; the CPF only where ICP-Brasil writes it of a person (the alternative name's OID 2.16.76.1.3.1, the 11 positions after the 8 of the birth date, with its check digits; `cpfChecks`), the CPF of the common name ("NOME:CPF") apart, and a company's CNPJ (2.16.76.1.3.3); its validity, serial, issuer and fingerprint (the SHA-256 of its DER), and whether it is an authority's (basic constraints). The first certificate of a PEM, read strictly; `holderPemOf` picks of a bundle the holder's, never an AC of the chain, whatever the order, with line breaks written as backslash and "n" read as line breaks. It reads; it never decides that a certificate is valid |
| `src/fake.ts` | `FakePsc`: a PSC in memory with a test AC of its own that issues each holder's certificate (by default an invented one with a CPF every manual uses; with a login hint, the CPF it names), and keys it never hands out, so what is built on its signatures verifies as a PSC's would, its chain included. It keeps the norm's rules the contract checks. `companyCertificateFirst` lists a company's certificate first, which signs when no alias is named; `grantScope` grants another scope than the one asked, and says so. `consentAtOnce` and `lenient` for a machine with no PSC (a preview, where the start and the return may run in different instances: codes and tokens carry what they stand for, sealed with `secret`, and every holder's serial, the default one's included, comes from the CPF) |
| `src/contract.test.ts` | What any client must do, against the fake and against the norm's client talking to a stand-in in the norm's shapes (once as the norm says, once as BirdID's manual says) |

`npm test -w @flyee/psc` runs the contract (29 tests).

## The norm

DOC-ICP-17.01, version 3.0, approved by Instrução Normativa ITI nº 20, of 23/11/2020, item 6.4 (read on 2026-10-14):

- `GET <base>/oauth/authorize` with `response_type=code`, `client_id`, `redirect_uri` (one the application registered), `state`, `lifetime` in seconds, `scope`, `code_challenge` and `code_challenge_method=S256`, and `login_hint` (a CPF or a CNPJ). The PSC shows the holder what is asked and lets them choose among their certificates.
- `POST <base>/oauth/token` (a form) with the code and the verifier: the access token, `expires_in`, and whose authorization it is (`authorized_identification_type` and `authorized_identification`). There is no refresh: a token lives what was asked, at most 7 days for a natural person, and a token of one signature is spent by it.
- `GET <base>/oauth/certificate-discovery`: the certificates the token reaches, in PEM (`status: "N"` when none).
- `POST <base>/oauth/signature` with a list of hashes, each with its id, the hash, its algorithm (the OID of SHA-256) and the format: `RAW` (the PKCS#1 v1.5 signature over the hash) or `CMS` (a detached CMS the PSC builds, with its own signed attributes and `signingTime`). ONE asks `RAW` and builds the CMS itself, so it chooses the attributes (`@flyee/documents/cms`).

The application registers at each PSC (`client_id` and `client_secret`) with an ICP-Brasil SSL certificate of its own domain, and its redirect addresses must be of that host.

## The PSCs

The base address of each PSC is data, never a constant: the table `psc_providers` (migration 0041), seeded from the ITI's list of PSCs (LPSC, the cycle of 09/07/2026 to 05/01/2027) and each PSC's own manual where one is public, with what each departs from the norm and how many hashes a call takes. None was tried yet: the operator records one as confirmed when the platform registered at it and tried it in its test environment.

| PSC | Base | What its manual says |
|---|---|---|
| BirdID (Soluti) | `https://api.birdid.com.br/v0` | hashes in hexadecimal, the token asked in JSON; production and `apihom.birdid.com.br` for tests |
| SerproID (Serpro) | `https://serproid.serpro.gov.br/oauth/v0` (the manual's; the LPSC lists `.../smartcert-api/api`) | 5 hashes a call; a code lives 60 seconds; the holder chooses 15 minutes to 7 days for a session |
| SafeID (Safeweb) | `https://pscsafeweb.safewebpss.com.br/Service/Microservice/OAuth/api/v0` | the norm's core, with extensions of its own ONE does not use |
| VIDaaS (Valid) | `https://certificado.vidaas.com.br/v0` | no public manual; the norm's paths answer there |
| RemoteID (Certisign) | `https://remoteidcertisign.com.br/api/v0` | no public manual; the norm's paths answer under `/api/v0` |
| DigitalSign, SyngularID, GoldID | as the LPSC lists them | not read |

To test in each PSC's own environment: whether the hash goes in hexadecimal or base64, and whether the `RAW` comes with the DigestInfo of PKCS#1 v1.5 (the norm says "the RSA operation over the hash" and says no more). ONE checks every signature before using it (`signForCourt` in the app reads each `.p7s` back), so a PSC whose answer is another is found on the authorization's own test, never on the day of a filing.

## Rules

- The token a PSC hands back is the lawyer's own authorization, sealed in the vault as a connection of that lawyer with the address it was issued at, under the rules of migration 0041: only the lawyer gives it, for themself, with the second factor, once they declared their CPF, and it is kept only for a person's certificate of that CPF, pinned by its serial (`login_hint` asks the PSC for that CPF's certificates); it lives at most 7 days; it is opened only for a use declared first and bound to what it says, with the hash of every document; every use is on record for the lawyer, the firm's partners and who manages it; the lawyer, a partner or who manages the firm ends it at once, and it ends by itself when the lawyer leaves or stops being a lawyer of the firm, when the PSC no longer signs with it and when the platform moves the PSC's address.
- A refusal ends a lawyer's authorization only where the token endpoint says the holder said no: on the endpoints a token reaches, a 401 is a token that no longer works and any other refusal is of the request (a hash, a certificate). Only words about the token itself say a token was spent: an id or a hash "already used" is the request's.
- ONE asks a session of signatures (`signature_session`) and keeps nothing a PSC granted otherwise: a token of one signature would be spent by the authorization's own test.
- Each hash a use sends goes under an id of that use alone (`<use>.<position>`), never one the PSC saw in an earlier use of the same session.
- A certificate discovery that answers no list is a refusal, never "no certificate": only `status: "N"` says the token reaches none.
- ONE signs with the certificate authorized, by its serial and its fingerprint, never an AC's the PSC lists beside it.
- Never the holder's factors: ONE does not use the norm's optional `pwd_authorize`, which collects them, nor any PSC's flow that does.
- Never a key or a certificate's file: the key stays at the PSC, and the certificate ONE reads is the public one the PSC hands for each use.
- Fixtures hold invented holders only.

None of it ran against a PSC yet: the client is proven with the stand-in in the norm's shapes, and the first authorization in a PSC's test environment is where it gets checked.
