# @flyee/identity

Lookup of a CPF in the federal registry, behind an interface (`docs/ONE-PLANO-DESENVOLVIMENTO.md`, sections 4.6 and 6). ONE asks one thing of it: is this the person the documents name, and is the registration regular.

## What is here

| File | What it is |
|---|---|
| `src/types.ts` | `CpfLookup` (`lookupCpf(cpf, birthDate)`), `CpfRecord`, the answers (`found`, `not_found`, `birth_date_mismatch`, `minor`, `unavailable`), `InvalidCpfError`, `InvalidBirthDateError`, and `normalizeCpf` / `normalizeBirthDate`, where every implementation starts |
| `src/fake.ts` | `FakeCpfLookup`: answers only for the invented people a test registers, and counts the lookups that reached it |
| `src/providers/serpro.ts` | `SerproCpfLookup`: Serpro's Consulta CPF v3 (`/consulta-cpf-df/v3/cpf/{cpf}/{DDMMAAAA}`, the token of the gateway kept for its hour and asked again once on a 401) |
| `src/contract.test.ts` | What any lookup must do. Runs against the fake, and against the Serpro provider with a scripted HTTP layer that answers in the shapes of Serpro's reference |

`npm test -w @flyee/identity` runs the contract.

## The registry

Serpro retired versions 1 and 2 of Consulta CPF (they answer 410). Version 3, read in Serpro's reference on 2026-10-09, answers for a CPF **and the birth date that goes with it**, and never for a minor:

- 200 or 206: the registration (`ni`, `nome`, `nomeSocial`, `nascimento`, `situacao.codigo`, `situacao.descricao`); situation `0` is regular, the others (`2` suspended, `3` holder deceased, `4` pending, `5` cancelled for multiplicity, `8` null, `9` cancelled) are not;
- 404 with `CPF_INEXISTENTE` or `DATA_NASCIMENTO_DIVERGENTE`: `not_found` or `birth_date_mismatch`;
- 422 (under 18) and 451 (under 16): `minor`;
- anything else (401, 403, 5xx, a timeout): `unavailable`, which the app reports and never records as an answer.

Serpro bills 200, 206 and 404. The demonstration environment (`environment: "trial"`) answers for the fictitious CPFs of the reference and bills nothing.

**The credential is the platform's, not a firm's.** ONE contracts the registry; `SERPRO_CONSUMER_KEY` and `SERPRO_CONSUMER_SECRET` live in the server's environment (`apps/web/.env.example`), never in the vault. Without them the app says the lookup is not on in that environment.

None of it ran against Serpro yet: the provider is proven with the scripted layer, and the first call with a real key is where it gets checked.

## How the app uses it

The database decides whether a lookup may happen (`begin_cpf_check`, migration 0022: a person of the firm, an adult with a CPF and a birth date, within the firm's daily ceiling); the backend asks the registry and records the answer (`record_cpf_check`), kept only while the person still has the CPF and the birth date that were asked. The audit event says what came back and whether the name matches, never the number or a name. See `apps/web/src/lib/cases/actions.ts` (`checkCpf`).

## Rules

- A number that fails its check digits, or a birth date that is not a day, is refused before any call to the registry.
- The answer is personal data: stored on the person under the firm with the moment it was read, never written to a log. An error message never carries the number.
- Fixtures hold invented people only. Never a real person's CPF.
