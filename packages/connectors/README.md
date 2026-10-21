# @flyee/connectors

The vault of the firms' vendor tokens.

A firm connects its accounts at its vendors (its WhatsApp Business account, its signature platform, its court-data aggregator), and the platform needs a vendor's API token to act on each of them. This package seals those tokens, opens them for a piece of work, and reseals them when the key rotates.

What it never keeps: a lawyer's own credential. A password, a PIN, a one-time code or its seed, a digital certificate or a private key is refused by name before anything is sealed (`isCredentialName`, the same rule as `is_credential_name` in the database), and a catalog test refuses a column named for one anywhere.

## How a token is kept

- **Sealed in the backend** with AES-256-GCM, under a fresh 12-byte nonce, with a key that never enters the database: `VAULT_KEYS` in the environment.
- **Bound to its place**: the firm and the connection are the additional authenticated data, so a sealed token copied under another account, or another firm, does not open. Every call to the store names both as well: work done for one firm never reaches an account of another by a wrong id.
- **Behind the vault functions only** (migration `0017_connections`): no API role reads the table of sealed tokens, not even the service role. Every read goes through `vault_read_secret`, which records what it was for in the audit trail. A caller opens once per batch of work and keeps the token in memory for that batch only.
- **Valid for as long as the vendor says**: a token past its `expires_at` is discarded when it is asked for, and by the daily upkeep.
- **Out of the logical backup** (`packages/backup/src/tables.ts`): a restore never needs it, the firm reconnects instead.

## Keys and rotation

`VAULT_KEYS` holds `version:base64` pairs, comma separated, each a key of 32 random bytes. The highest version seals; every listed version opens. To rotate:

1. Add the next version (`3:<new key>,2:<current key>`).
2. The daily upkeep (`one-vault-upkeep`) reseals every token an older version sealed, a batch per step.
3. After a pass with nothing pending, remove the old version.

A token sealed by a key that is no longer listed cannot be opened by anything; the upkeep reports it instead of skipping it silently.

## Who does what

| Step | Who | Where |
| --- | --- | --- |
| Start connecting an account | who manages the firm, with the second factor, never from a support visit | `begin_connection` (person's session) |
| Seal the token | the backend | `Vault.seal` over `vault_store_secret` |
| Open it for work | the backend | `Vault.open({ orgId, connectionId }, purpose)` over `vault_read_secret` |
| Report how the work went | the backend | `Vault.report` over `vault_report_status` |
| Disconnect (the token is discarded at once) | who manages the firm, with the second factor | `disconnect_connection` |
| Validity and rotation | the daily job | `expire_connections`, `Vault.rewrap` |

## Files

| File | What it holds |
| --- | --- |
| `src/crypto.ts` | `parseKeyring`, `sealSecret`, `openSecret`, `generateKey` |
| `src/vault.ts` | `Vault` (seal, open, report, rewrap), `checkPayload`, `isCredentialName` |
| `src/types.ts` | `Envelope`, `SecretPayload`, the `VaultStore` interface |
| `src/fake.ts` | `FakeVaultStore`: the store in memory, with the rules of the real one |

The app's store over the database is `apps/web/src/lib/connections/vault-store.ts`, and `getVault()` in `apps/web/src/lib/connections/vault.ts` is the one way to a vault in the app.

## Tests

`npm run test:connectors`: sealing and opening, binding to the place, tampering, the refusal of credential names, the keyring, rotation, validity and the record of every read. No key and no database. The database side is `packages/db/tests/0021_connections.test.sql`.
