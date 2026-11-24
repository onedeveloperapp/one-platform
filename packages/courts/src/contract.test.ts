import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FakeDjenClient, type FakeDjenEntry } from "./fake.ts";
import {
  DjenHttpClient,
  DjenInvalidQueryError,
  DjenRateLimitedError,
  DjenUnavailableError,
  DjenWindowTooLargeError,
} from "./providers/djen.ts";
import type { DjenClient } from "./types.ts";

const ANA = { uf: "GO", number: "12345" };
const BRUNO = { uf: "SP", number: "67890" };
/** A lawyer of another state whose registration has the same number as Ana's. */
const CAIO = { uf: "MG", number: "12345" };
/** A lawyer of Ana's state whose registration is Ana's number with a letter: another person. */
const DORA = { uf: "GO", number: "12345A" };

/** What the courts published in this scenario. Every person, number and case here is invented. */
const PUBLISHED: FakeDjenEntry[] = [
  {
    hash: "hash0003abcdefghijklmnopqrstuv",
    court: "TJGO",
    cnj: "50012347920998090051",
    availableOn: "2026-10-06",
    kind: "Intimação",
    text: "Fica a parte autora intimada da audiência de conciliação.",
    link: "https://projudi.tjgo.jus.br/BuscaProcesso?PaginaAtual=-1",
    unit: "2º Juizado Especial Cível de Goiânia",
    className: "Procedimento do Juizado Especial Cível",
    parties: [{ name: "Pessoa Inventada da Silva", side: "active" }],
    lawyers: [ANA],
  },
  {
    hash: "hash0001abcdefghijklmnopqrstuv",
    court: "TJGO",
    cnj: "50012347920998090051",
    availableOn: "2026-10-01",
    kind: "Citação",
    text: "Cite-se a parte ré.",
    link: null,
    parties: [
      { name: "Pessoa Inventada da Silva", side: "active" },
      { name: "COMPANHIA AEREA DE TESTE SA", side: "passive" },
    ],
    lawyers: [ANA, BRUNO],
  },
  {
    hash: "hash0002abcdefghijklmnopqrstuv",
    court: "TJSP",
    cnj: "10009874520998260100",
    availableOn: "2026-10-03",
    kind: "Intimação",
    text: "Manifeste-se a parte autora em 15 dias.",
    link: "https://eproc1g.tjsp.jus.br/eproc/",
    lawyers: [BRUNO],
  },
  {
    // The court cancelled it after making it available, and said why.
    hash: "hash0004abcdefghijklmnopqrstuv",
    court: "TJGO",
    cnj: "50012347920998090051",
    availableOn: "2026-10-07",
    kind: "Intimação",
    text: "Fica a parte autora intimada da sentença.",
    link: null,
    documentType: "Sentença",
    active: false,
    cancelReason: "Publicada em duplicidade.",
    lawyers: [ANA],
  },
  {
    // Addressed to the lawyer whose registration is Ana's number with a letter.
    hash: "hash0006abcdefghijklmnopqrstuv",
    court: "TJGO",
    cnj: "50045678620998090051",
    availableOn: "2026-10-04",
    kind: "Intimação",
    text: "Intime-se a parte ré.",
    link: null,
    lawyers: [DORA],
  },
  {
    // Addressed to a lawyer of another state with the same number as Ana's.
    hash: "hash0005abcdefghijklmnopqrstuv",
    court: "TJMG",
    cnj: "50007658620998130024",
    availableOn: "2026-10-05",
    kind: "Intimação",
    text: "Intime-se.",
    link: null,
    lawyers: [CAIO],
  },
];

/**
 * What any DJEN client must do, whatever is behind it. It runs against the
 * fake and against the real client, which is answered here by a stand-in of
 * the public API in the shapes of its reference (read on 2026-10-08): none
 * of it has run against the DJEN itself in this suite.
 */
function djenContract(name: string, make: (published: FakeDjenEntry[]) => DjenClient) {
  describe(`DJEN client contract: ${name}`, () => {
    it("lists what is addressed to the lawyer on or after the date, oldest first", async () => {
      const client = make(PUBLISHED);
      const all = await client.listByOab({ ...ANA, since: "2026-10-01" });
      assert.deepEqual(
        all.map((communication) => communication.hash),
        ["hash0001abcdefghijklmnopqrstuv", "hash0003abcdefghijklmnopqrstuv", "hash0004abcdefghijklmnopqrstuv"],
      );
      const recent = await client.listByOab({ ...ANA, since: "2026-10-02" });
      assert.deepEqual(
        recent.map((communication) => communication.hash),
        ["hash0003abcdefghijklmnopqrstuv", "hash0004abcdefghijklmnopqrstuv"],
      );
    });

    it("stops at the last day asked, when one is given", async () => {
      const client = make(PUBLISHED);
      const firstDays = await client.listByOab({ ...ANA, since: "2026-10-01", until: "2026-10-06" });
      assert.deepEqual(
        firstDays.map((communication) => communication.hash),
        ["hash0001abcdefghijklmnopqrstuv", "hash0003abcdefghijklmnopqrstuv"],
      );
      const oneDay = await client.listByOab({ ...ANA, since: "2026-10-07", until: "2026-10-07" });
      assert.deepEqual(
        oneDay.map((communication) => communication.hash),
        ["hash0004abcdefghijklmnopqrstuv"],
      );
      assert.deepEqual(await client.listByOab({ ...ANA, since: "2026-10-06", until: "2026-10-05" }), []);
    });

    it("looks at what a court made available on a day: how many, how many with no text, and the systems by kind", async () => {
      const client = make([
        ...PUBLISHED,
        {
          hash: "hash0101abcdefghijklmnopqrstuv",
          court: "TJGO",
          cnj: "10003012720998090100",
          availableOn: "2026-10-08",
          kind: "Intimação",
          text: "Intime-se.",
          link: "https://projudi.tjgo.jus.br/BuscaProcesso?id=1",
          unit: "1º Juizado Especial Cível de Goiânia",
          className: "Procedimento do Juizado Especial Cível",
          lawyers: [BRUNO],
        },
        {
          hash: "hash0102abcdefghijklmnopqrstuv",
          court: "TJGO",
          cnj: "10003021220998090100",
          availableOn: "2026-10-08",
          kind: "Intimação",
          text: "<p> </p>",
          link: "https://pje.tjgo.jus.br/consulta?id=2",
          unit: "2º Juizado Especial Cível de Goiânia",
          className: "Procedimento do Juizado Especial Cível",
          lawyers: [BRUNO],
        },
        {
          hash: "hash0103abcdefghijklmnopqrstuv",
          court: "TJSP",
          cnj: "10003039420998260100",
          availableOn: "2026-10-08",
          kind: "Intimação",
          text: "Cite-se.",
          link: "https://eproc1g.tjsp.jus.br/x",
          unit: "1ª Vara Cível",
          className: "Procedimento Comum Cível",
          lawyers: [BRUNO],
        },
      ]);
      const probe = await client.probe({ court: "TJGO", day: "2026-10-08" });
      assert.equal(probe.items, 2);
      assert.equal(probe.withoutText, 1);
      assert.deepEqual(probe.systems, { juizado: { projudi: 1, pje: 1 } });
      const none = await client.probe({ court: "TJGO", day: "2026-10-05" });
      assert.deepEqual(none, { items: 0, withoutText: 0, systems: {} });
    });

    it("answers a lawyer with nothing published with an empty list, not an error", async () => {
      const client = make(PUBLISHED);
      assert.deepEqual(await client.listByOab({ uf: "RJ", number: "1", since: "2026-01-01" }), []);
      assert.deepEqual(await client.listByOab({ ...ANA, since: "2027-01-01" }), []);
    });

    it("keeps a registration apart from the same number in another state", async () => {
      const client = make(PUBLISHED);
      const ofAna = (await client.listByOab({ ...ANA, since: "2026-01-01" })).map((communication) => communication.court);
      assert.ok(!ofAna.includes("TJMG"));
      const ofCaio = await client.listByOab({ ...CAIO, since: "2026-01-01" });
      assert.deepEqual(
        ofCaio.map((communication) => communication.hash),
        ["hash0005abcdefghijklmnopqrstuv"],
      );
    });

    it("keeps a registration apart from the same number with a letter", async () => {
      const client = make(PUBLISHED);
      const ofAna = (await client.listByOab({ ...ANA, since: "2026-01-01" })).map((communication) => communication.hash);
      assert.ok(!ofAna.includes("hash0006abcdefghijklmnopqrstuv"));
      // However the number is typed: with a mask, in small letters, with zeros in front.
      for (const number of ["12345A", "12.345-a", "012345A"]) {
        const ofDora = await client.listByOab({ uf: "go", number, since: "2026-01-01" });
        assert.deepEqual(
          ofDora.map((communication) => communication.hash),
          ["hash0006abcdefghijklmnopqrstuv"],
          number,
        );
      }
    });

    it("never repeats a hash: it is the key the capture stores a communication under", async () => {
      const client = make([...PUBLISHED, PUBLISHED[0]]);
      const hashes = (await client.listByOab({ ...ANA, since: "2026-01-01" })).map(
        (communication) => communication.hash,
      );
      assert.equal(new Set(hashes).size, hashes.length);
    });

    it("says when a court cancelled a communication, and what the court gave of each", async () => {
      const client = make(PUBLISHED);
      const listed = await client.listByOab({ ...ANA, since: "2026-10-01" });
      assert.deepEqual(
        listed.map((communication) => communication.active),
        [true, true, false],
      );
      const hearing = listed[1];
      assert.equal(hearing.unit, "2º Juizado Especial Cível de Goiânia");
      assert.equal(hearing.className, "Procedimento do Juizado Especial Cível");
      assert.equal(listed[0].unit, null);
      assert.equal(listed[0].className, null);
      // What the court published under it, and why it took one back, when the DJEN says.
      assert.deepEqual(
        listed.map((communication) => [communication.documentType, communication.cancelReason]),
        [
          [null, null],
          [null, null],
          ["Sentença", "Publicada em duplicidade."],
        ],
      );
    });

    it("writes the case number as 20 digits and the day as YYYY-MM-DD", async () => {
      const client = make(PUBLISHED);
      for (const communication of await client.listByOab({ ...BRUNO, since: "2026-01-01" })) {
        assert.match(communication.cnj, /^\d{20}$/);
        assert.match(communication.availableOn, /^\d{4}-\d{2}-\d{2}$/);
        assert.ok(communication.link === null || URL.canParse(communication.link));
      }
    });

    it("lists every communication of one lawsuit by its number, whoever it was addressed to, oldest first", async () => {
      const client = make(PUBLISHED);
      const expected = ["hash0001abcdefghijklmnopqrstuv", "hash0003abcdefghijklmnopqrstuv", "hash0004abcdefghijklmnopqrstuv"];
      // However the number is written: its digits, or the mask a person or a receipt gives it.
      for (const cnj of ["50012347920998090051", "5001234-79.2099.8.09.0051"]) {
        const history = await client.listByProcess({ cnj });
        assert.deepEqual(history.map((communication) => communication.hash), expected, cnj);
        // The court's taking one back is said here too.
        assert.deepEqual(history.map((communication) => communication.active), [true, true, false]);
      }
    });

    it("names the parties each communication is addressed to, with their side, and the lawyers it goes through", async () => {
      const client = make(PUBLISHED);
      const history = await client.listByProcess({ cnj: "50012347920998090051" });
      const byHash = new Map(history.map((communication) => [communication.hash, communication]));
      // The summons goes to both sides through both lawyers; the notice of the hearing to the side that sues alone.
      assert.deepEqual(byHash.get("hash0001abcdefghijklmnopqrstuv")?.parties, [
        { name: "Pessoa Inventada da Silva", side: "active" },
        { name: "COMPANHIA AEREA DE TESTE SA", side: "passive" },
      ]);
      assert.deepEqual(byHash.get("hash0001abcdefghijklmnopqrstuv")?.lawyers, [ANA, BRUNO]);
      assert.deepEqual(byHash.get("hash0003abcdefghijklmnopqrstuv")?.parties, [
        { name: "Pessoa Inventada da Silva", side: "active" },
      ]);
      assert.deepEqual(byHash.get("hash0003abcdefghijklmnopqrstuv")?.lawyers, [ANA]);
      // One that names nobody names nobody: never a party made up.
      assert.deepEqual(byHash.get("hash0004abcdefghijklmnopqrstuv")?.parties, []);
    });

    it("answers a lawsuit with nothing published with an empty list, and refuses what is not a number", async () => {
      const client = make(PUBLISHED);
      assert.deepEqual(await client.listByProcess({ cnj: "50099998820998090051" }), []);
      await assert.rejects(client.listByProcess({ cnj: "123" }), DjenInvalidQueryError);
      await assert.rejects(client.listByProcess({ cnj: "" }), DjenInvalidQueryError);
    });

    it("gives the address of a communication's certificate, by its hash", () => {
      const address = make(PUBLISHED).certificateUrl("hash0001abcdefghijklmnopqrstuv");
      assert.ok(URL.canParse(address));
      assert.equal(new URL(address).protocol, "https:");
      assert.ok(address.endsWith("/api/v1/comunicacao/hash0001abcdefghijklmnopqrstuv/certidao"));
    });
  });
}

// ---------- A stand-in of the public API, in the shapes of its reference ----------

type Call = { url: URL };

/**
 * Answers `GET /api/v1/comunicacao` as the reference describes it: filtered
 * by the number of the registration and its state and by the days asked, a
 * page of 100 at a time, with `count` and the rate-limit headers. A search
 * by number alone would match every state: the stand-in does what the API
 * may do and answers by the number when no state is given.
 */
function djenStandIn(
  published: FakeDjenEntry[],
  options: {
    remaining?: number[];
    statuses?: number[];
    ignoreState?: boolean;
    /** What `count` says: the total (one of the ways the API answers), the size of the page (another), or nothing. */
    count?: "total" | "page" | "none";
  } = {},
) {
  const calls: Call[] = [];
  const statuses = [...(options.statuses ?? [])];
  const remaining = [...(options.remaining ?? [])];
  const fetcher = async (input: string | URL | Request) => {
    const url = new URL(String(input));
    calls.push({ url });
    const forced = statuses.shift();
    if (forced && forced !== 200) {
      // What the API answers when it refuses or is busy, as read on 2026-10-09.
      const busy = JSON.stringify({ status: "error", message: "O sistema está muito ocupado. Tente novamente mais tarde." });
      return new Response(forced === 429 ? "" : busy, { status: forced });
    }
    // The API matches the number as it is written, letter included, and does not mind zeros in front.
    const number = (url.searchParams.get("numeroOab") ?? "").replace(/^0+/, "");
    const uf = options.ignoreState ? null : url.searchParams.get("ufOab");
    const from = url.searchParams.get("dataDisponibilizacaoInicio") ?? "";
    const until = url.searchParams.get("dataDisponibilizacaoFim") ?? "9999-12-31";
    const page = Number(url.searchParams.get("pagina") ?? "1");
    const size = Number(url.searchParams.get("itensPorPagina") ?? "100");
    // The API holds a communication once: a hash published twice is the same.
    const unique = [...new Map(published.map((entry) => [entry.hash, entry])).values()];
    const court = url.searchParams.get("siglaTribunal");
    // A search by a lawsuit's number asks no days, and answers its whole history (checked on 2026-11-24).
    const lawsuit = url.searchParams.get("numeroProcesso");
    const matching = unique
      .filter((entry) =>
        lawsuit !== null
          ? entry.cnj === lawsuit.replace(/\D/g, "")
          : entry.availableOn >= from &&
            entry.availableOn <= until &&
            (court
              ? entry.court === court
              : entry.lawyers.some((lawyer) => lawyer.number === number && (!uf || lawyer.uf === uf))),
      )
      // Newest first, as a gazette lists: the client is the one that orders.
      .sort((a, b) => b.availableOn.localeCompare(a.availableOn));
    const items = matching.slice((page - 1) * size, page * size).map((entry, index) => ({
      id: 1000 + index,
      hash: entry.hash,
      siglaTribunal: entry.court,
      numero_processo: entry.cnj,
      numeroprocessocommascara: entry.cnj,
      data_disponibilizacao: entry.availableOn,
      datadisponibilizacao: entry.availableOn.split("-").reverse().join("/"),
      tipoComunicacao: entry.kind,
      tipoDocumento: entry.documentType ?? null,
      motivo_cancelamento: entry.cancelReason ?? null,
      data_cancelamento: entry.active === false ? entry.availableOn : null,
      texto: entry.text,
      link: entry.link,
      meio: "D",
      nomeOrgao: entry.unit ?? null,
      nomeClasse: entry.className ?? null,
      ativo: entry.active ?? true,
      status: "P",
      // In the API's own shape (read on 2026-11-24): the name, the side as "A" or "P", and the communication's id.
      destinatarios: (entry.parties ?? []).map((party) => ({
        nome: party.name,
        polo: party.side === "active" ? "A" : party.side === "passive" ? "P" : null,
        comunicacao_id: 1000 + index,
      })),
      destinatarioadvogados: entry.lawyers.map((lawyer, at) => ({
        id: at + 1,
        advogado: { id: at + 1, nome: "ADVOGADO INVENTADO", numero_oab: lawyer.number, uf_oab: lawyer.uf },
      })),
    }));
    const mode = options.count ?? "total";
    const count = mode === "total" ? { count: matching.length } : mode === "page" ? { count: items.length } : {};
    return new Response(JSON.stringify({ status: "success", message: "Sucesso", ...count, items }), {
      status: 200,
      headers: { "content-type": "application/json", "x-ratelimit-limit": "20", "x-ratelimit-remaining": String(remaining.shift() ?? 19) },
    });
  };
  return { fetcher: fetcher as typeof fetch, calls };
}

const realClient = (published: FakeDjenEntry[], extra: object = {}) => {
  const server = djenStandIn(published);
  return new DjenHttpClient({ fetch: server.fetcher, today: () => "2026-10-09", sleep: async () => undefined, ...extra });
};

djenContract("fake", (published) => new FakeDjenClient(published));
djenContract("the public API", (published) => realClient(published));

describe("the fake DJEN", () => {
  it("counts its calls, so a test of the capture can prove it does not repeat them", async () => {
    const client = new FakeDjenClient(PUBLISHED);
    await client.listByOab({ ...ANA, since: "2026-10-01" });
    await client.listByOab({ ...ANA, since: "2026-10-01" });
    await client.listByProcess({ cnj: "50012347920998090051" });
    assert.deepEqual(client.calls, { listByOab: 2, listByProcess: 1, probe: 0 });
  });
});

describe("the DJEN through its public API", () => {
  it("a look the API refuses is an outage, never a day with nothing", async () => {
    const server = djenStandIn(PUBLISHED, { statuses: [500] });
    const client = new DjenHttpClient({ fetch: server.fetcher, today: () => "2026-10-09", sleep: async () => undefined });
    await assert.rejects(client.probe({ court: "TJGO", day: "2026-10-08" }), DjenUnavailableError);
    const busy = djenStandIn(PUBLISHED, { statuses: [429] });
    const again = new DjenHttpClient({ fetch: busy.fetcher, today: () => "2026-10-09", sleep: async () => undefined });
    await assert.rejects(again.probe({ court: "TJGO", day: "2026-10-08" }), DjenRateLimitedError);
    assert.equal(busy.calls.length, 1);
  });

  /** Many communications for one lawyer, one a day back from the 9th of October 2026 and around again. */
  const many = (count: number): FakeDjenEntry[] =>
    Array.from({ length: count }, (_, index) => ({
      hash: `bulk${String(index).padStart(6, "0")}abcdefghijklmnopqrst`,
      court: "TJGO",
      cnj: "50012347920998090051",
      availableOn: `2026-09-${String((index % 28) + 1).padStart(2, "0")}`,
      kind: "Intimação",
      text: `Publicação ${index + 1}.`,
      link: null,
      lawyers: [ANA],
    }));

  it("asks for the registration, its state and the days, a page of 100 at a time, up to today", async () => {
    const server = djenStandIn(many(230));
    const client = new DjenHttpClient({ fetch: server.fetcher, today: () => "2026-10-09", sleep: async () => undefined });
    const listed = await client.listByOab({ uf: "go", number: "012345", since: "2026-09-01" });
    assert.equal(listed.length, 230);
    assert.equal(server.calls.length, 3);
    const first = server.calls[0].url;
    assert.equal(first.origin + first.pathname, "https://comunicaapi.pje.jus.br/api/v1/comunicacao");
    assert.deepEqual(Object.fromEntries(first.searchParams), {
      numeroOab: "12345",
      ufOab: "GO",
      dataDisponibilizacaoInicio: "2026-09-01",
      dataDisponibilizacaoFim: "2026-10-09",
      pagina: "1",
      itensPorPagina: "100",
    });
    assert.deepEqual(
      server.calls.map((call) => call.url.searchParams.get("pagina")),
      ["1", "2", "3"],
    );
    // Oldest first, whatever order the API answered in.
    assert.ok(listed.every((item, index) => index === 0 || listed[index - 1].availableOn <= item.availableOn));
  });

  it("asks for a lawsuit by its digits alone, with no days, a page of 100 at a time, and keeps only what is of it", async () => {
    const server = djenStandIn(PUBLISHED);
    const client = new DjenHttpClient({ fetch: server.fetcher, today: () => "2026-10-09", sleep: async () => undefined });
    await client.listByProcess({ cnj: "5001234-79.2099.8.09.0051" });
    assert.equal(server.calls.length, 1);
    const asked = server.calls[0].url.searchParams;
    assert.equal(asked.get("numeroProcesso"), "50012347920998090051");
    assert.equal(asked.get("pagina"), "1");
    assert.equal(asked.get("itensPorPagina"), "100");
    for (const name of ["numeroOab", "ufOab", "dataDisponibilizacaoInicio", "dataDisponibilizacaoFim", "siglaTribunal"]) {
      assert.equal(asked.get(name), null, name);
    }
    // An answer that holds a communication of another number keeps it out.
    const loose = djenStandIn([...PUBLISHED, { ...PUBLISHED[2], hash: "hash0099abcdefghijklmnopqrstuv", cnj: "50012347920998090051" }]);
    const fetcher = (async (input: string | URL | Request) => {
      const response = await loose.fetcher(input);
      const body = (await response.json()) as { items: { numero_processo: string; hash: string }[] };
      for (const item of body.items) if (item.hash === "hash0099abcdefghijklmnopqrstuv") item.numero_processo = "10009874520998260100";
      return new Response(JSON.stringify(body), { status: 200, headers: response.headers });
    }) as typeof fetch;
    const strict = new DjenHttpClient({ fetch: fetcher, today: () => "2026-10-09", sleep: async () => undefined });
    const kept = await strict.listByProcess({ cnj: "50012347920998090051" });
    assert.ok(!kept.some((communication) => communication.hash === "hash0099abcdefghijklmnopqrstuv"));
    assert.equal(kept.length, 3);
  });

  it("keeps only what names the very registration, even when the API answers by the number alone", async () => {
    const server = djenStandIn(PUBLISHED, { ignoreState: true });
    const dropped: number[] = [];
    const client = new DjenHttpClient({
      fetch: server.fetcher,
      today: () => "2026-10-09",
      onFiltered: (communications) => void dropped.push(communications),
    });
    const listed = await client.listByOab({ ...ANA, since: "2026-01-01" });
    assert.ok(listed.length > 0);
    assert.ok(listed.every((communication) => communication.court !== "TJMG"));
    // What the API answered for another lawyer is left out and counted, once for the listing: by what was
    // checked it should be nothing, so a count is the alarm.
    assert.equal(dropped.length, 1);
    assert.ok(dropped[0] >= 1);
    // A listing with nothing of anybody else says nothing.
    const quiet: number[] = [];
    const exact = new DjenHttpClient({
      fetch: djenStandIn(PUBLISHED).fetcher,
      today: () => "2026-10-09",
      onFiltered: (communications) => void quiet.push(communications),
    });
    await exact.listByOab({ ...BRUNO, since: "2026-01-01" });
    assert.deepEqual(quiet, []);
  });

  it("asks up to the last day given, and never past today", async () => {
    const server = djenStandIn(many(60));
    const client = new DjenHttpClient({ fetch: server.fetcher, today: () => "2026-10-09" });
    await client.listByOab({ ...ANA, since: "2026-09-01", until: "2026-09-05" });
    await client.listByOab({ ...ANA, since: "2026-09-01", until: "2026-12-31" });
    assert.deepEqual(
      server.calls.map((call) => call.url.searchParams.get("dataDisponibilizacaoFim")),
      ["2026-09-05", "2026-10-09"],
    );
  });

  it("reads every page when the count is the size of the page, as the API sometimes answers", async () => {
    // Read against the API on 2026-10-09: a search answered `count: 100` on each of its full pages.
    const server = djenStandIn(many(230), { count: "page" });
    const client = new DjenHttpClient({ fetch: server.fetcher, today: () => "2026-10-09", sleep: async () => undefined });
    assert.equal((await client.listByOab({ ...ANA, since: "2026-09-01" })).length, 230);
    assert.deepEqual(
      server.calls.map((call) => call.url.searchParams.get("pagina")),
      ["1", "2", "3"],
    );
    // A last page that comes full is followed by one more, which comes empty.
    const full = djenStandIn(many(200), { count: "page" });
    const patient = new DjenHttpClient({ fetch: full.fetcher, today: () => "2026-10-09", sleep: async () => undefined });
    assert.equal((await patient.listByOab({ ...ANA, since: "2026-09-01" })).length, 200);
    assert.equal(full.calls.length, 3);
    // And with no page left to follow, a listing of full pages is not a whole one.
    const capped = new DjenHttpClient({ fetch: djenStandIn(many(230), { count: "page" }).fetcher, today: () => "2026-10-09", maxPages: 2 });
    await assert.rejects(() => capped.listByOab({ ...ANA, since: "2026-09-01" }), DjenWindowTooLargeError);
  });

  it("does not take a listing that ends before the count it was given", async () => {
    const server = djenStandIn(many(150));
    // A first page that comes short while the API says there are 150.
    const short = (async (input: string | URL | Request) => {
      const answer = await server.fetcher(input);
      const body = (await answer.json()) as { count: number; items: unknown[] };
      return new Response(JSON.stringify({ status: "success", count: body.count, items: body.items.slice(0, 40) }), { status: 200 });
    }) as unknown as typeof fetch;
    await assert.rejects(
      () => new DjenHttpClient({ fetch: short, today: () => "2026-10-09" }).listByOab({ ...ANA, since: "2026-09-01" }),
      DjenUnavailableError,
    );
  });

  it("asks for the number as it is registered, letter included", async () => {
    const server = djenStandIn(PUBLISHED);
    const client = new DjenHttpClient({ fetch: server.fetcher, today: () => "2026-10-09" });
    await client.listByOab({ uf: "go", number: "012.345-a", since: "2026-10-01" });
    assert.equal(server.calls[0].url.searchParams.get("numeroOab"), "12345A");
    assert.equal(server.calls[0].url.searchParams.get("ufOab"), "GO");
    // An API that answered by the digits alone would still give Ana nothing of the other lawyer.
    const loose = (async (input: string | URL | Request) => {
      const url = new URL(String(input));
      url.searchParams.set("numeroOab", "12345A");
      return server.fetcher(url);
    }) as unknown as typeof fetch;
    assert.deepEqual(await new DjenHttpClient({ fetch: loose, today: () => "2026-10-09" }).listByOab({ ...ANA, since: "2026-10-01" }), []);
  });

  it("never takes a part for the whole: days that hold as much as a search gives are refused", async () => {
    // A client that follows two pages of 100 stands for the API's own ceiling of 10,000.
    const within = djenStandIn(many(150));
    const fits = new DjenHttpClient({ fetch: within.fetcher, today: () => "2026-10-09", maxPages: 2 });
    assert.equal((await fits.listByOab({ ...ANA, since: "2026-09-01" })).length, 150);

    const beyond = djenStandIn(many(230));
    const cut = new DjenHttpClient({ fetch: beyond.fetcher, today: () => "2026-10-09", maxPages: 2 });
    await assert.rejects(() => cut.listByOab({ ...ANA, since: "2026-09-01" }), DjenWindowTooLargeError);
    // The count of the first page already says so: no other page is asked.
    assert.equal(beyond.calls.length, 1);
    // Fewer days hold fewer results, and are read whole.
    assert.equal((await cut.listByOab({ ...ANA, since: "2026-09-01", until: "2026-09-10" })).length, 86);

    // A count that stopped at the ceiling may hide what lies past it.
    const exact = djenStandIn(many(200));
    const atCeiling = new DjenHttpClient({ fetch: exact.fetcher, today: () => "2026-10-09", maxPages: 2 });
    await assert.rejects(() => atCeiling.listByOab({ ...ANA, since: "2026-09-01" }), DjenWindowTooLargeError);

    // An API that does not say how many there are, with every page full.
    const uncounted = (async (input: string | URL | Request) => {
      const answer = await beyond.fetcher(input);
      const body = (await answer.json()) as { items: unknown[] };
      return new Response(JSON.stringify({ status: "success", items: body.items }), { status: 200 });
    }) as unknown as typeof fetch;
    const waits: number[] = [];
    const blind = new DjenHttpClient({
      fetch: uncounted,
      today: () => "2026-10-09",
      maxPages: 2,
      sleep: async (ms) => void waits.push(ms),
    });
    await assert.rejects(() => blind.listByOab({ ...ANA, since: "2026-09-01" }), DjenWindowTooLargeError);
    // An answer with no word about the window of calls is not a window that is spent.
    assert.deepEqual(waits, []);
  });

  it("refuses what is not a registration or a day, instead of answering that nothing was published", async () => {
    const server = djenStandIn(PUBLISHED);
    const client = new DjenHttpClient({ fetch: server.fetcher, today: () => "2026-10-09" });
    // A listing with nothing in it would be recorded as days that were read.
    const notOne = [
      { uf: "Goiás", number: "12345" },
      { uf: "GO", number: "" },
      { uf: "GO", number: "ABC" },
      { uf: "GO", number: "0000000" },
    ];
    for (const registration of notOne) {
      await assert.rejects(() => client.listByOab({ ...registration, since: "2026-10-01" }), DjenInvalidQueryError);
    }
    await assert.rejects(() => client.listByOab({ ...ANA, since: "01/10/2026" }), DjenInvalidQueryError);
    await assert.rejects(() => client.listByOab({ ...ANA, since: "2026-10-01", until: "amanhã" }), DjenInvalidQueryError);
    // A day that has not come has nothing to read yet: that is no error, and nothing is asked.
    assert.deepEqual(await client.listByOab({ ...ANA, since: "2026-10-10" }), []);
    assert.equal(server.calls.length, 0);
  });

  /** The window of calls as the API counts it: twenty, then twenty more after a wait. */
  const windows = () => Array.from({ length: 400 }, (_, call) => 19 - (call % 20));

  it("reads a long listing across the windows of calls it may wait for, and no further", async () => {
    const waits: number[] = [];
    const fits = djenStandIn(many(5900), { remaining: windows() });
    const reader = new DjenHttpClient({
      fetch: fits.fetcher,
      today: () => "2026-10-09",
      sleep: async (ms) => void waits.push(ms),
    });
    assert.equal((await reader.listByOab({ ...ANA, since: "2026-09-01" })).length, 5900);
    // Fifty-nine full pages and the empty one that ends them: three windows of calls, two waits.
    assert.equal(fits.calls.length, 60);
    assert.deepEqual(waits, [61_000, 61_000]);

    // More than the waits of one listing reach is under the 10,000 of a search and still out of reach: said
    // as too large, so the capture asks for fewer days. Tried again as it is, it would meet the same wall.
    for (const count of [6500, 9900]) {
      const beyond = djenStandIn(many(count), { remaining: windows() });
      const stopped = new DjenHttpClient({ fetch: beyond.fetcher, today: () => "2026-10-09", sleep: async () => undefined });
      await assert.rejects(() => stopped.listByOab({ ...ANA, since: "2026-09-01" }), DjenWindowTooLargeError);
      assert.equal(beyond.calls.length, 60);
    }
    // The same when the API counts by the page: nothing but the pages themselves says how many there are.
    const blind = djenStandIn(many(6500), { remaining: windows(), count: "page" });
    const unsure = new DjenHttpClient({ fetch: blind.fetcher, today: () => "2026-10-09", sleep: async () => undefined });
    await assert.rejects(() => unsure.listByOab({ ...ANA, since: "2026-09-01" }), DjenWindowTooLargeError);
  });

  it("gives a listing the time of one turn: a slow one is for later, a long one for fewer days", async () => {
    const timed = (count: number, msPerCall: number) => {
      let clock = 0;
      const server = djenStandIn(many(count), { remaining: windows() });
      const fetcher = (async (input: string | URL | Request) => {
        clock += msPerCall;
        return server.fetcher(input);
      }) as unknown as typeof fetch;
      return new DjenHttpClient({
        fetch: fetcher,
        today: () => "2026-10-09",
        now: () => clock,
        sleep: async (ms) => {
          clock += ms;
        },
      });
    };
    // Thirty pages at two seconds each and one wait fit the time.
    assert.equal((await timed(2950, 2000).listByOab({ ...ANA, since: "2026-09-01" })).length, 2950);
    // Slow from its first page: nothing says the days hold too much.
    await assert.rejects(
      () => timed(1500, 10_000).listByOab({ ...ANA, since: "2026-09-01" }),
      (error: unknown) => error instanceof DjenUnavailableError && error.status === null,
    );
    // A window's worth of pages read and the time is over: it is the listing that is long.
    await assert.rejects(() => timed(5000, 5000).listByOab({ ...ANA, since: "2026-09-01" }), DjenWindowTooLargeError);
  });

  it("waits a minute when the window of calls is spent, and goes on", async () => {
    const waits: number[] = [];
    const server = djenStandIn(many(150), { remaining: [0, 19] });
    const client = new DjenHttpClient({
      fetch: server.fetcher,
      today: () => "2026-10-09",
      sleep: async (ms) => void waits.push(ms),
    });
    assert.equal((await client.listByOab({ ...ANA, since: "2026-09-01" })).length, 150);
    assert.deepEqual(waits, [61_000]);
  });

  it("waits on a 429 and asks the same page again; insisted on, it gives up for now", async () => {
    const waits: number[] = [];
    const once = djenStandIn(PUBLISHED, { statuses: [429] });
    const patient = new DjenHttpClient({ fetch: once.fetcher, today: () => "2026-10-09", sleep: async (ms) => void waits.push(ms) });
    assert.equal((await patient.listByOab({ ...ANA, since: "2026-10-01" })).length, 3);
    assert.deepEqual(waits, [61_000]);
    assert.deepEqual(
      once.calls.map((call) => call.url.searchParams.get("pagina")),
      ["1", "1"],
    );

    const always = djenStandIn(PUBLISHED, { statuses: [429, 429, 429, 429, 429] });
    const limited = new DjenHttpClient({ fetch: always.fetcher, today: () => "2026-10-09", sleep: async () => undefined });
    await assert.rejects(() => limited.listByOab({ ...ANA, since: "2026-10-01" }), DjenRateLimitedError);
    // Two waits of a minute fit what one call may wait; a third does not, so it never hammers the API.
    assert.equal(always.calls.length, 3);
  });

  it("says the DJEN is unavailable when it does not answer, or answers what cannot be read", async () => {
    const down = djenStandIn(PUBLISHED, { statuses: [503] });
    await assert.rejects(
      () => new DjenHttpClient({ fetch: down.fetcher, today: () => "2026-10-09" }).listByOab({ ...ANA, since: "2026-10-01" }),
      (error: unknown) => error instanceof DjenUnavailableError && error.status === 503,
    );
    const silent = (async () => {
      throw new Error("network");
    }) as unknown as typeof fetch;
    await assert.rejects(
      () => new DjenHttpClient({ fetch: silent, today: () => "2026-10-09" }).listByOab({ ...ANA, since: "2026-10-01" }),
      (error: unknown) => error instanceof DjenUnavailableError && error.status === null,
    );
    const garbled = (async () => new Response("<html>manutenção</html>", { status: 200 })) as unknown as typeof fetch;
    await assert.rejects(
      () => new DjenHttpClient({ fetch: garbled, today: () => "2026-10-09" }).listByOab({ ...ANA, since: "2026-10-01" }),
      DjenUnavailableError,
    );
    // An answer that says it failed is not a day with nothing published, whatever its HTTP status.
    const failed = (async () =>
      new Response(JSON.stringify({ status: "error", message: "O sistema está muito ocupado.", items: [] }), {
        status: 200,
      })) as unknown as typeof fetch;
    await assert.rejects(
      () => new DjenHttpClient({ fetch: failed, today: () => "2026-10-09" }).listByOab({ ...ANA, since: "2026-10-01" }),
      DjenUnavailableError,
    );
  });

  it("hands over what is addressed to the lawyer as it came, for the capture to refuse and count", async () => {
    const mine = [{ advogado: { numero_oab: "12345", uf_oab: "GO" } }];
    const odd = (async () =>
      new Response(
        JSON.stringify({
          status: "success",
          count: 5,
          items: [
            { hash: "", numero_processo: "50012347920998090051", data_disponibilizacao: "2026-10-01", destinatarioadvogados: mine },
            { hash: "semprocesso0001abcdefghijklmn", numero_processo: "123", data_disponibilizacao: "2026-10-01", destinatarioadvogados: mine },
            { hash: "semdia00000001abcdefghijklmno", numero_processo: "50012347920998090051", data_disponibilizacao: "ontem", destinatarioadvogados: mine },
            // Of another lawyer: this is the one thing a listing leaves out.
            { hash: "deoutro0000001abcdefghijklmno", numero_processo: "50012347920998090051", data_disponibilizacao: "2026-10-01", destinatarioadvogados: [{ advogado: { numero_oab: "54321", uf_oab: "GO" } }] },
            {
              hash: "inteira0000001abcdefghijklmno",
              siglaTribunal: "tjgo",
              numero_processo: "5001234-79.2099.8.09.0051",
              data_disponibilizacao: "2026-10-01",
              tipoComunicacao: " Intimação ",
              texto: "Texto.",
              link: "javascript:alert(1)",
              destinatarioadvogados: [{ advogado: { numero_oab: "012345", uf_oab: "go" } }],
              // A party with no name is nobody; a side the DJEN does not give is none; the same party twice is one.
              destinatarios: [
                { nome: "  ", polo: "A" },
                { nome: "Pessoa  Inventada", polo: "a" },
                { nome: "Pessoa Inventada", polo: "A" },
                { nome: "Terceira Inventada", polo: "X" },
              ],
            },
          ],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const listed = await new DjenHttpClient({ fetch: odd, today: () => "2026-10-09" }).listByOab({ ...ANA, since: "2026-10-01" });
    assert.deepEqual(
      listed.map((communication) => [communication.hash, communication.cnj, communication.availableOn]),
      [
        ["", "50012347920998090051", "2026-10-01"],
        ["inteira0000001abcdefghijklmno", "50012347920998090051", "2026-10-01"],
        ["semprocesso0001abcdefghijklmn", "123", "2026-10-01"],
        ["semdia00000001abcdefghijklmno", "50012347920998090051", "ontem"],
      ],
    );
    assert.deepEqual(listed[1], {
      hash: "inteira0000001abcdefghijklmno",
      court: "TJGO",
      cnj: "50012347920998090051",
      availableOn: "2026-10-01",
      kind: "Intimação",
      documentType: null,
      text: "Texto.",
      // Only an address of the web is kept as a link.
      link: null,
      unit: null,
      className: null,
      active: true,
      cancelReason: null,
      parties: [
        { name: "Pessoa Inventada", side: "active" },
        { name: "Terceira Inventada", side: null },
      ],
      // The registration as the bar's keys write it: no zeros in front, the state in capitals.
      lawyers: [ANA],
    });
  });

  it("reads a cancelling in every place the answer may say it", async () => {
    const mine = [{ advogado: { numero_oab: "12345", uf_oab: "GO" } }];
    const item = (hash: string, extra: object) => ({
      hash: `${hash}abcdefghijklmnopqrstuvwxyz`.slice(0, 30),
      siglaTribunal: "TJGO",
      numero_processo: "50012347920998090051",
      data_disponibilizacao: "2026-10-01",
      texto: "Texto.",
      destinatarioadvogados: mine,
      ...extra,
    });
    const answers = (async () =>
      new Response(
        JSON.stringify({
          status: "success",
          items: [
            item("a1", { ativo: true }),
            item("a2", {}),
            item("a3", { ativo: "S" }),
            item("b1", { ativo: false, motivo_cancelamento: " Publicada em duplicidade. " }),
            item("b2", { ativo: 0 }),
            item("b3", { ativo: "N" }),
            item("b4", { ativo: true, data_cancelamento: "2026-10-02" }),
            item("b5", { ativo: true, motivo_cancelamento: "Erro material." }),
          ],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const listed = await new DjenHttpClient({ fetch: answers, today: () => "2026-10-09" }).listByOab({ ...ANA, since: "2026-10-01" });
    assert.deepEqual(
      listed.map((communication) => [communication.hash.slice(0, 2), communication.active, communication.cancelReason]),
      [
        ["a1", true, null],
        ["a2", true, null],
        ["a3", true, null],
        ["b1", false, "Publicada em duplicidade."],
        ["b2", false, null],
        ["b3", false, null],
        ["b4", false, null],
        ["b5", false, "Erro material."],
      ],
    );
  });
});
