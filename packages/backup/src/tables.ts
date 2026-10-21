/**
 * Which tables the logical backup copies.
 *
 * Every table of `public` is copied, so a table added later is in the backup
 * without anybody remembering this file, except the ones named here, each
 * for a reason:
 *
 * - `backup_runs`: the record of the backups themselves.
 * - `connection_secrets`: the firms' sealed vendor tokens (migration 0017)
 *   and the lawyers' authorizations at their cloud certificate's provider
 *   (0041). They are encrypted with a key that never enters the database,
 *   but a copy of them in a bucket is one more place they live, and a
 *   restore never needs them: a firm reconnects its account, a lawyer
 *   authorizes again, and the token is sealed anew.
 */
export const NEVER_BACKED_UP: readonly string[] = ["backup_runs", "connection_secrets"];

/** The tables to copy, from every table of the schema, in a stable order. */
export function tablesToBackUp(all: readonly string[]): string[] {
  return [...new Set(all)].filter((table) => !NEVER_BACKED_UP.includes(table)).sort();
}
