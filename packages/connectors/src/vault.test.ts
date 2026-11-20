import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import test from "node:test";

import { type Keyring, openSecret, parseKeyring, sealSecret, VaultOpenError } from "./crypto.ts";
import { FakeVaultStore } from "./fake.ts";
import { checkPayload, hasCredentialKey, isCredentialName, Vault } from "./vault.ts";

const keyOf = () => randomBytes(32).toString("base64");

function keyring(entries: string): Keyring {
  const parsed = parseKeyring(entries);
  if (!parsed.ok) throw new Error(parsed.detail);
  return parsed.keyring;
}

const K1 = keyOf();
const K2 = keyOf();
const TOKEN = "EAAB-token-de-teste-0000";

function setup(ring = keyring(`1:${K1}`), now?: () => number) {
  const store = new FakeVaultStore(now);
  const vault = new Vault(store, ring);
  const id = store.begin("firm-a", "whatsapp", "waba-1");
  return { store, vault, id, where: { orgId: "firm-a", connectionId: id } };
}

test("a token sealed for an account opens only there, and the store never holds it in the clear", async () => {
  const { store, vault, id, where } = setup();
  assert.deepEqual(await vault.seal(where, { access_token: TOKEN }), { kind: "sealed", replaced: false });

  const held = store.connections.get(id)?.envelope;
  assert.ok(held);
  assert.equal(held.keyVersion, 1);
  assert.ok(!JSON.stringify(held).includes(TOKEN));
  assert.ok(!Buffer.from(held.ciphertext, "base64").toString("utf8").includes(TOKEN));

  const opened = await vault.open(where, "whatsapp.send");
  assert.equal(opened.kind, "opened");
  if (opened.kind !== "opened") return;
  assert.deepEqual(opened.payload, { access_token: TOKEN });
  assert.deepEqual(opened.connection, {
    connectionId: id,
    orgId: "firm-a",
    provider: "whatsapp",
    externalId: "waba-1",
    status: "connected",
    expiresAt: null,
  });
});

test("work done for one firm never reaches an account of another, even holding its id", async () => {
  const { store, vault, id, where } = setup();
  await vault.seal(where, { access_token: TOKEN });
  const asOtherFirm = { orgId: "firm-b", connectionId: id };

  assert.deepEqual(await vault.open(asOtherFirm, "whatsapp.send"), { kind: "refused", code: "not_found" });
  assert.deepEqual(await vault.seal(asOtherFirm, { access_token: "de outro escritório" }), {
    kind: "refused",
    code: "not_found",
  });
  await vault.report(asOtherFirm, false, "token_revoked");
  // Nothing of the account changed, and no read of it was recorded for the other firm.
  assert.equal(store.connections.get(id)?.status, "connected");
  assert.deepEqual(store.reads, []);
  assert.equal((await vault.open(where, "whatsapp.send")).kind, "opened");
});

test("every seal draws a new nonce: the same token never seals the same way twice", () => {
  const ring = keyring(`1:${K1}`);
  const where = { orgId: "firm-a", connectionId: "connection-1" };
  const first = sealSecret(ring, { access_token: TOKEN }, where);
  const second = sealSecret(ring, { access_token: TOKEN }, where);
  assert.notEqual(first.iv, second.iv);
  assert.notEqual(first.ciphertext, second.ciphertext);
});

test("a sealed token moved to another account, or another firm, does not open", async () => {
  const { store, vault, id, where } = setup();
  await vault.seal(where, { access_token: TOKEN });
  const other = { orgId: "firm-a", connectionId: store.begin("firm-a", "whatsapp", "waba-2") };
  const otherFirm = { orgId: "firm-b", connectionId: store.begin("firm-b", "whatsapp", "waba-1") };
  for (const target of [other, otherFirm]) {
    const connection = store.connections.get(target.connectionId);
    assert.ok(connection);
    connection.status = "connected";
    connection.envelope = { ...store.connections.get(id)!.envelope! };
    assert.deepEqual(await vault.open(target, "whatsapp.send"), { kind: "refused", code: "tampered" });
  }
});

test("a changed byte is caught, never opened into something else", async () => {
  const { store, vault, id, where } = setup();
  await vault.seal(where, { access_token: TOKEN });
  const held = store.connections.get(id)!.envelope!;
  const bytes = Buffer.from(held.ciphertext, "base64");
  bytes[0] ^= 1;
  held.ciphertext = bytes.toString("base64");
  assert.deepEqual(await vault.open(where, "whatsapp.send"), { kind: "refused", code: "tampered" });
});

test("a lawyer's own credential is refused before anything is sealed", async () => {
  const { store, vault, id, where } = setup();
  const credentials: Record<string, string>[] = [
    { senha: "x" },
    { pinCode: "1234" },
    { certificado_a1: "x" },
    { totp_seed: "x" },
  ];
  for (const payload of credentials) {
    assert.deepEqual(await vault.seal(where, payload), { kind: "refused", code: "credential_field" });
  }
  assert.deepEqual(await vault.seal(where, { access_token: TOKEN }, { metadata: { conta: { privateKey: "x" } } }), {
    kind: "refused",
    code: "invalid_metadata",
  });
  assert.equal(store.connections.get(id)?.envelope, null);
});

test("what a token may be: a few named text fields", () => {
  assert.equal(checkPayload({ access_token: TOKEN, app_secret: "s" }), null);
  assert.equal(checkPayload({}), "empty");
  assert.equal(checkPayload({ "Access Token": TOKEN }), "invalid_field_name");
  assert.equal(checkPayload({ access_token: "" }), "invalid_value");
  assert.equal(checkPayload({ access_token: "x".repeat(17_000) }), "too_large");
  assert.equal(
    checkPayload(Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`campo_${index}`, "x"]))),
    "too_many_fields",
  );
});

test("credential names follow the database's rule, word by word", () => {
  for (const name of [
    "pin",
    "pinCode",
    "PIN",
    "senhaTribunal",
    "password",
    "privateKey",
    "chave_privada",
    "cert",
    "certificado_a1",
    "seedPhrase",
    "mfa_secret",
    "2fa",
    "totp_uri",
    "otp",
    "pfx",
    "passphrase",
  ]) {
    assert.equal(isCredentialName(name), true, name);
  }
  for (const name of [
    "access_token",
    "app_secret",
    "api_key",
    "phone_number_id",
    "shipping",
    "spinner",
    "certidao",
    "pinned_at",
    "waba_id",
  ]) {
    assert.equal(isCredentialName(name), false, name);
  }
  assert.equal(hasCredentialKey({ conta: { lista: [{ senhaTribunal: "x" }] } }), true);
  assert.equal(hasCredentialKey({ conta: { lista: [{ numero: "x" }] }, access_token: "y" }), false);
});

test("the keys come from VAULT_KEYS: the highest version seals, anything malformed refuses them all", () => {
  assert.deepEqual(parseKeyring(undefined), { ok: false, problem: "not_configured", detail: "VAULT_KEYS is not set" });
  assert.equal(parseKeyring("  ").ok, false);

  const two = parseKeyring(`1:${K1}, 2:${K2}`);
  assert.ok(two.ok);
  if (two.ok) {
    assert.equal(two.keyring.current, 2);
    assert.deepEqual([...two.keyring.keys.keys()].sort(), [1, 2]);
  }

  for (const bad of [
    `${K1}`,
    `1:${randomBytes(16).toString("base64")}`,
    `0:${K1}`,
    `1:${K1},1:${K2}`,
    `1:nao-e-base64!`,
  ]) {
    const parsed = parseKeyring(bad);
    assert.equal(parsed.ok, false, bad);
    assert.equal(parsed.ok ? null : parsed.problem, "malformed", bad);
  }
});

test("a rotation reseals every token under the newest key, after which the old key can go", async () => {
  const store = new FakeVaultStore();
  const old = new Vault(store, keyring(`1:${K1}`));
  const first = { orgId: "firm-a", connectionId: store.begin("firm-a", "whatsapp", "waba-1") };
  const second = { orgId: "firm-b", connectionId: store.begin("firm-b", "zapsign") };
  await old.seal(first, { access_token: "um" });
  await old.seal(second, { api_token: "dois" });

  const rotating = new Vault(store, keyring(`2:${K2},1:${K1}`));
  assert.deepEqual(await rotating.rewrap(), { rewrapped: 2, skipped: 0, failed: [] });
  assert.deepEqual(await rotating.rewrap(), { rewrapped: 0, skipped: 0, failed: [] });
  assert.equal(store.connections.get(first.connectionId)?.envelope?.keyVersion, 2);

  const after = new Vault(store, keyring(`2:${K2}`));
  const opened = await after.open(second, "assinaturas.enviar");
  assert.equal(opened.kind === "opened" && opened.payload.api_token, "dois");
});

test("a token sealed by a key no longer listed does not open, and a rotation reports it", async () => {
  const { store, vault, id, where } = setup();
  await vault.seal(where, { access_token: TOKEN });
  const lost = new Vault(store, keyring(`3:${K2}`));
  assert.deepEqual(await lost.open(where, "whatsapp.send"), { kind: "refused", code: "unknown_key_version" });
  assert.deepEqual(await lost.rewrap(), {
    rewrapped: 0,
    skipped: 0,
    failed: [{ connectionId: id, code: "unknown_key_version" }],
  });
  assert.throws(
    () => openSecret(keyring(`3:${K2}`), store.connections.get(id)!.envelope!, where),
    (error: unknown) => error instanceof VaultOpenError && error.code === "unknown_key_version",
  );
});

test("a cut or expired account gives nothing to open", async () => {
  let clock = Date.parse("2026-10-08T12:00:00Z");
  const { store, vault, id, where } = setup(keyring(`1:${K1}`), () => clock);
  await vault.seal(where, { access_token: TOKEN }, { expiresAt: "2026-10-09T12:00:00Z" });
  assert.equal((await vault.open(where, "whatsapp.send")).kind, "opened");

  clock = Date.parse("2026-10-10T12:00:00Z");
  assert.deepEqual(await vault.open(where, "whatsapp.send"), { kind: "refused", code: "expired" });
  assert.equal(store.connections.get(id)?.envelope, null);
  assert.deepEqual(await vault.seal(where, { access_token: TOKEN }), { kind: "refused", code: "expired" });

  const other = { orgId: "firm-a", connectionId: store.begin("firm-a", "zapsign") };
  await vault.seal(other, { api_token: "x" });
  store.disconnect(other.connectionId);
  assert.deepEqual(await vault.open(other, "assinaturas.enviar"), { kind: "refused", code: "disconnected" });
});

test("every open is recorded with what it was for, and a purpose is a short code", async () => {
  const { store, vault, id, where } = setup();
  await vault.seal(where, { access_token: TOKEN });
  await vault.open(where, "whatsapp.send");
  assert.deepEqual(await vault.open(where, "Ler tudo"), { kind: "refused", code: "invalid_purpose" });
  assert.deepEqual(store.reads, [{ connectionId: id, purpose: "whatsapp.send" }]);
});

test("a failure is reported as a code and a success brings the account back", async () => {
  const { store, vault, id, where } = setup();
  await vault.seal(where, { access_token: TOKEN });
  await vault.report(where, false, "token_revoked");
  assert.equal(store.connections.get(id)?.status, "error");
  assert.equal((await vault.open(where, "whatsapp.send")).kind, "opened");
  await vault.report(where, true);
  assert.equal(store.connections.get(id)?.status, "connected");
});

test("what another audited door read opens only for its own place, and its refusal passes on", async () => {
  const { store, vault, id, where } = setup();
  await vault.seal(where, { access_token: TOKEN }, { expiresAt: "2099-01-01T00:00:00Z" });
  const envelope = store.connections.get(id)?.envelope;
  assert.ok(envelope);
  const answer = {
    ok: true as const,
    envelope,
    orgId: "firm-a",
    provider: "psc.serproid",
    externalId: null,
    status: "connected" as const,
    expiresAt: "2099-01-01T00:00:00Z",
  };
  const opened = vault.openAnswer(where, answer);
  assert.equal(opened.kind, "opened");
  if (opened.kind === "opened") assert.equal(opened.payload.access_token, TOKEN);
  // The same envelope, said to be another connection's or another firm's, does not open.
  assert.equal(vault.openAnswer({ orgId: "firm-a", connectionId: "outra" }, answer).kind, "refused");
  assert.equal(vault.openAnswer({ orgId: "firm-b", connectionId: id }, answer).kind, "refused");
  assert.deepEqual(vault.openAnswer(where, { ok: false, code: "no_signature" }), {
    kind: "refused",
    code: "no_signature",
  });
  // Nothing was read through the store's general door.
  assert.deepEqual(store.reads, []);
});

test("a lawyer's court login enters only through its own door, and opens only for its own connection", async () => {
  const { store, vault, id, where } = setup();
  // The general seal still refuses a password, whatever the account.
  assert.deepEqual(await vault.seal(where, { login: "52998224725", senha: "segredo-de-teste" }), {
    kind: "refused",
    code: "credential_field",
  });
  // The court login's door seals it, and nothing of it is held in the clear.
  assert.deepEqual(await vault.sealLawyerCourtLogin(where, { login: " 52998224725 ", senha: "segredo-de-teste" }), {
    kind: "sealed",
    replaced: false,
  });
  const envelope = store.connections.get(id)?.envelope;
  assert.ok(envelope);
  assert.ok(!JSON.stringify(envelope).includes("segredo-de-teste"));
  assert.ok(!Buffer.from(envelope.ciphertext, "base64").toString("utf8").includes("segredo-de-teste"));
  // It opens from what `court_login_open` answers, for that connection alone.
  const answer = {
    ok: true as const,
    envelope,
    orgId: "firm-a",
    provider: "court.eproc-tjsp",
    externalId: "pessoa-1",
    status: "connected" as const,
    expiresAt: null,
  };
  const opened = vault.openAnswer(where, answer);
  assert.equal(opened.kind, "opened");
  if (opened.kind === "opened") assert.deepEqual(opened.payload, { login: "52998224725", senha: "segredo-de-teste" });
  assert.equal(vault.openAnswer({ orgId: "firm-a", connectionId: "outra" }, answer).kind, "refused");
  // A login of no size, or with a line break, is refused before anything is sealed.
  assert.deepEqual(await vault.sealLawyerCourtLogin(where, { login: "", senha: "x" }), {
    kind: "refused",
    code: "empty",
  });
  assert.deepEqual(await vault.sealLawyerCourtLogin(where, { login: "a", senha: "linha\nquebrada" }), {
    kind: "refused",
    code: "invalid_value",
  });
});

test("the code a court asked is sealed to its batch and opens for that batch alone", () => {
  const { vault } = setup();
  const sealed = vault.sealBatchCode("firm-a", "lote-1", " 123 456 ");
  assert.equal(sealed.kind, "sealed");
  if (sealed.kind !== "sealed") return;
  assert.ok(!JSON.stringify(sealed.envelope).includes("123456"));
  assert.equal(vault.openBatchCode("firm-a", "lote-1", sealed.envelope), "123456");
  assert.equal(vault.openBatchCode("firm-a", "lote-2", sealed.envelope), null);
  assert.equal(vault.openBatchCode("firm-b", "lote-1", sealed.envelope), null);
  assert.deepEqual(vault.sealBatchCode("firm-a", "lote-1", "12"), { kind: "refused", code: "invalid_code" });
});
