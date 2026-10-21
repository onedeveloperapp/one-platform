import assert from "node:assert/strict";
import test from "node:test";

import { NEVER_BACKED_UP, tablesToBackUp } from "./tables.ts";

test("the vault of tokens and the record of the backups are never copied", () => {
  const all = ["profiles", "connection_secrets", "connections", "backup_runs", "ai_runs"];
  assert.deepEqual(tablesToBackUp(all), ["ai_runs", "connections", "profiles"]);
  for (const table of NEVER_BACKED_UP) assert.equal(tablesToBackUp(all).includes(table), false);
});

test("a table added later is copied without anybody naming it", () => {
  assert.deepEqual(tablesToBackUp(["uma_tabela_nova", "profiles"]), ["profiles", "uma_tabela_nova"]);
});

test("the same table listed twice is copied once", () => {
  assert.deepEqual(tablesToBackUp(["profiles", "profiles"]), ["profiles"]);
});
