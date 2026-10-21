import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FakeCpfLookup } from "./fake.ts";
import { SerproCpfLookup } from "./providers/serpro.ts";
import { type CpfLookup, type CpfRecord, InvalidBirthDateError, InvalidCpfError, normalizeCpf } from "./types.ts";

/**
 * The people of the scenario are the fictitious CPFs the Serpro reference
 * lists for its demonstration environment (read on 2026-10-09), with the
 * birth dates it gives them: nobody's real number.
 */
const REGULAR: CpfRecord = {
  cpf: "40442820135",
  name: "Nome do CPF 404.428.201-35",
  socialName: null,
  birthDate: "1970-11-14",
  situationCode: "0",
  situation: "Regular",
  regular: true,
};
const SUSPENDED: CpfRecord = {
  cpf: "40532176871",
  name: "Nome do CPF 405.321.768-71",
  socialName: null,
  birthDate: "1982-03-22",
  situationCode: "2",
  situation: "Suspensa",
  regular: false,
};
/** Under 18 in the reference: the registry does not answer for them. */
const MINOR = { cpf: "30272095079", birthDate: "2009-02-03" };
/** Passes the check digits and is registered to nobody in the scenario. */
const UNKNOWN = "39053344705";
const TODAY = "2026-10-09";

// ---------- The registry's answers, in the shapes of its reference ----------

type Scripted = { status: number; body: unknown } | Error;

function scriptedFetch(answers: Scripted[]) {
  const calls: { url: string; method: string; headers: Record<string, string>; body: string | null }[] = [];
  const run = (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({
      url: String(input),
      method: init?.method ?? "GET",
      headers: (init?.headers ?? {}) as Record<string, string>,
      body: typeof init?.body === "string" ? init.body : null,
    });
    const next = answers.shift();
    if (!next) throw new Error(`unexpected call to ${String(input)}`);
    if (next instanceof Error) throw next;
    return new Response(JSON.stringify(next.body), { status: next.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
  return { run, calls };
}

const TOKEN = { status: 200, body: { scope: "am_application_scope default", token_type: "Bearer", expires_in: 3295, access_token: "token-de-teste" } };
const recordOf = (person: CpfRecord, extra: Record<string, unknown> = {}) => ({
  ni: person.cpf,
  nome: person.name,
  situacao: { codigo: person.situationCode, descricao: person.situation },
  nascimento: `${person.birthDate!.slice(8, 10)}${person.birthDate!.slice(5, 7)}${person.birthDate!.slice(0, 4)}`,
  dataInscricao: "01011990",
  ...extra,
});

/** A Serpro provider answering, call by call, what the registry would answer for the scenario. */
function serproFor(people: CpfRecord[]) {
  const answers: Scripted[] = [];
  const network = scriptedFetch(answers);
  const lookup = new SerproCpfLookup({
    consumerKey: "chave",
    consumerSecret: "segredo",
    environment: "trial",
    fetch: (async (input, init) => {
      const url = String(input);
      if (url.endsWith("/token")) answers.unshift(TOKEN);
      else {
        const [, cpf, ddmmyyyy] = /\/cpf\/(\d{11})\/(\d{8})$/.exec(url) ?? [];
        const born = `${ddmmyyyy.slice(4)}-${ddmmyyyy.slice(2, 4)}-${ddmmyyyy.slice(0, 2)}`;
        const person = people.find((entry) => entry.cpf === cpf);
        if (cpf === MINOR.cpf) answers.unshift({ status: 422, body: {} });
        else if (!person) answers.unshift({ status: 404, body: { erro: "CPF_INEXISTENTE", erroDescricao: "Ni CPF inexistente" } });
        else if (person.birthDate !== born)
          answers.unshift({ status: 404, body: { erro: "DATA_NASCIMENTO_DIVERGENTE", erroDescricao: "Data divergente" } });
        else answers.unshift({ status: 200, body: recordOf(person) });
      }
      return network.run(input, init);
    }) as typeof fetch,
  });
  return lookup;
}

// ---------- The contract ----------

function cpfLookupContract(name: string, make: (people: CpfRecord[]) => CpfLookup) {
  describe(`CPF lookup contract: ${name}`, () => {
    it("finds a person by the number and the birth date, with or without the mask", async () => {
      const lookup = make([REGULAR, SUSPENDED]);
      const found = await lookup.lookupCpf("404.428.201-35", "1970-11-14");
      assert.deepEqual(found, { kind: "found", record: REGULAR, partial: false });
      assert.deepEqual(await lookup.lookupCpf("40442820135", "1970-11-14"), found);
    });

    it("says when a registration is not regular, with the registry's code and words", async () => {
      const found = await make([REGULAR, SUSPENDED]).lookupCpf("405.321.768-71", "1982-03-22");
      assert.equal(found.kind, "found");
      if (found.kind !== "found") return;
      assert.deepEqual([found.record.regular, found.record.situationCode, found.record.situation], [false, "2", "Suspensa"]);
    });

    it("tells a number it does not have from a birth date that does not match", async () => {
      const lookup = make([REGULAR]);
      assert.deepEqual(await lookup.lookupCpf(UNKNOWN, "1970-11-14"), { kind: "not_found" });
      assert.deepEqual(await lookup.lookupCpf(REGULAR.cpf, "1970-11-15"), { kind: "birth_date_mismatch" });
    });

    it("never answers for a person under 18", async () => {
      const lookup = make([REGULAR, { ...REGULAR, cpf: MINOR.cpf, birthDate: MINOR.birthDate }]);
      assert.deepEqual(await lookup.lookupCpf(MINOR.cpf, MINOR.birthDate), { kind: "minor" });
    });

    it("refuses a number or a date that is not one, before asking, and keeps the number out of the error", async () => {
      const lookup = make([REGULAR]);
      for (const wrong of ["40442820134", "111.111.111-11", "123", ""]) {
        await assert.rejects(lookup.lookupCpf(wrong, "1970-11-14"), (error: unknown) => {
          assert.ok(error instanceof InvalidCpfError);
          assert.equal(/\d{3}/.test(error.message), false);
          return true;
        });
      }
      for (const wrong of ["14/11/1970", "1970-02-30", ""]) {
        await assert.rejects(lookup.lookupCpf(REGULAR.cpf, wrong), InvalidBirthDateError);
      }
    });
  });
}

cpfLookupContract("fake", (people) => new FakeCpfLookup(people, { today: TODAY }));
cpfLookupContract("serpro", (people) => serproFor(people));

describe("the Serpro provider", () => {
  it("asks for a token with the platform's credential, and asks the pair at the address of version 3", async () => {
    const network = scriptedFetch([TOKEN, { status: 200, body: recordOf(REGULAR) }, { status: 200, body: recordOf(REGULAR) }]);
    const lookup = new SerproCpfLookup({ consumerKey: "chave", consumerSecret: "segredo", environment: "production", fetch: network.run });
    await lookup.lookupCpf(REGULAR.cpf, REGULAR.birthDate!);
    await lookup.lookupCpf(REGULAR.cpf, REGULAR.birthDate!);

    assert.equal(network.calls.length, 3, "one token for both lookups");
    const [token, query] = network.calls;
    assert.equal(token.url, "https://gateway.apiserpro.serpro.gov.br/token");
    assert.equal(token.method, "POST");
    assert.equal(token.headers.Authorization, `Basic ${Buffer.from("chave:segredo").toString("base64")}`);
    assert.equal(token.headers["Content-Type"], "application/x-www-form-urlencoded");
    assert.equal(token.body, "grant_type=client_credentials");
    assert.equal(query.url, "https://gateway.apiserpro.serpro.gov.br/consulta-cpf-df/v3/cpf/40442820135/14111970");
    assert.equal(query.headers.Authorization, "Bearer token-de-teste");
  });

  it("reads a partial answer and a social name, and asks again once when the token ended early", async () => {
    const network = scriptedFetch([
      TOKEN,
      { status: 401, body: {} },
      TOKEN,
      { status: 206, body: recordOf(REGULAR, { nomeSocial: "Nome Social Teste", dataInscricao: undefined }) },
    ]);
    const lookup = new SerproCpfLookup({ consumerKey: "chave", consumerSecret: "segredo", environment: "trial", fetch: network.run });
    const found = await lookup.lookupCpf(REGULAR.cpf, REGULAR.birthDate!);
    assert.equal(found.kind, "found");
    if (found.kind !== "found") return;
    assert.equal(found.partial, true);
    assert.equal(found.record.socialName, "Nome Social Teste");
    assert.equal(network.calls[3].url, "https://gateway.apiserpro.serpro.gov.br/consulta-cpf-df-trial/v3/cpf/40442820135/14111970");
  });

  it("answers `unavailable` with a code for every failure, and never throws for one", async () => {
    const cases: [Scripted[], string][] = [
      [[{ status: 401, body: {} }], "token_refused"],
      [[new Error("ECONNRESET")], "token_refused"],
      [[TOKEN, new Error("ETIMEDOUT")], "no_answer"],
      [[TOKEN, { status: 403, body: {} }], "credential_refused"],
      [[TOKEN, { status: 410, body: {} }], "version_retired"],
      [[TOKEN, { status: 504, body: {} }], "http_504"],
      [[TOKEN, { status: 400, body: { erro: "CPF_INVALIDO", erroDescricao: "Ni CPF informado é inválido" } }], "cpf_invalido"],
      [[TOKEN, { status: 200, body: { ni: REGULAR.cpf } }], "unreadable_answer"],
    ];
    for (const [answers, detail] of cases) {
      const network = scriptedFetch(answers);
      const lookup = new SerproCpfLookup({ consumerKey: "chave", consumerSecret: "segredo", environment: "trial", fetch: network.run });
      assert.deepEqual(await lookup.lookupCpf(REGULAR.cpf, REGULAR.birthDate!), { kind: "unavailable", detail }, detail);
    }
  });

  it("gives up a token a minute before it ends", async () => {
    let now = 0;
    const network = scriptedFetch([
      { status: 200, body: { access_token: "primeiro", expires_in: 3600 } },
      { status: 200, body: recordOf(REGULAR) },
      { status: 200, body: { access_token: "segundo", expires_in: 3600 } },
      { status: 200, body: recordOf(REGULAR) },
    ]);
    const lookup = new SerproCpfLookup({
      consumerKey: "chave",
      consumerSecret: "segredo",
      environment: "trial",
      fetch: network.run,
      now: () => now,
    });
    await lookup.lookupCpf(REGULAR.cpf, REGULAR.birthDate!);
    now = 3541 * 1000;
    await lookup.lookupCpf(REGULAR.cpf, REGULAR.birthDate!);
    assert.equal(network.calls[3].headers.Authorization, "Bearer segundo");
  });
});

describe("the fake CPF registry", () => {
  it("counts the lookups that reached it, and a refused number never does", async () => {
    const lookup = new FakeCpfLookup([REGULAR], { today: TODAY });
    await lookup.lookupCpf("404.428.201-35", "1970-11-14");
    await lookup.lookupCpf(UNKNOWN, "1970-11-14");
    await assert.rejects(lookup.lookupCpf("40442820134", "1970-11-14"), InvalidCpfError);
    assert.equal(lookup.lookups, 2);
  });

  it("only registers a number that passes its check digits", () => {
    assert.throws(() => new FakeCpfLookup([{ ...REGULAR, cpf: "12345678900" }]), InvalidCpfError);
    assert.equal(normalizeCpf(" 404.428.201-35 "), "40442820135");
  });
});
