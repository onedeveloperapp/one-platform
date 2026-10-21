import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { askAll, compareSources } from "./compare.ts";
import { type FakeProceeding, FakeProceedingSource } from "./fake.ts";
import {
  brasiliaInstant,
  isTjgoNumber,
  maskCnj,
  ProjudiRefusedError,
  ProjudiTjgoSource,
  ProjudiUnavailableError,
} from "./providers/projudi.ts";
import {
  AggregatorAuthError,
  AggregatorNoCreditError,
  AggregatorUnavailableError,
} from "./providers/aggregator-http.ts";
import { EscavadorSource } from "./providers/escavador.ts";
import { JuditSource } from "./providers/judit.ts";
import type { ProceedingSource } from "./types.ts";
import { parseXml, textOf, XmlError } from "./xml.ts";

/** Lawsuits of TJGO, invented: numbers with valid check digits, and people nobody is. */
const MOVED = "50001236020998090051";
const SECRET = "50004561220998090051";
const UNKNOWN = "50007896120998090051";
/** A lawsuit of TJSP: not TJGO's. */
const SAO_PAULO = "10002348820998260100";

const LAWSUITS: FakeProceeding[] = [
  {
    number: "5000123-60.2099.8.09.0051",
    unit: "Goiânia - 3º Juizado Especial Cível",
    className: "Procedimento do Juizado Especial Cível",
    subjects: ["Transporte Aéreo"],
    phase: "Conhecimento",
    status: "Ativo",
    claimValue: "15.000,00",
    distributedOn: "2026-08-03",
    lawyers: [{ name: "ANA TESTE SOUZA", oab: "12345 N", party: "Polo Ativo", receivesNotices: true }],
    responsibles: [{ role: "Juiz", name: "JUIZ INVENTADO", unit: "Goiânia - 3º Juizado Especial Cível" }],
    pending: [
      {
        kind: "pendency",
        title: "Intimação",
        status: "Aguardando Decurso de Prazo",
        start: "2026-10-07T02:59:59.000Z",
        end: "2026-10-30T02:59:59.000Z",
      },
    ],
    movements: [
      { id: "900000002", at: "2026-08-03T20:36:42.000Z", title: "Processo Distribuído", detail: "Goiânia - 3º Juizado Especial Cível", by: "SISTEMA PROJUDI" },
      { id: "900000001", at: "2026-08-03T20:36:41.000Z", title: "Petição Enviada", detail: null, by: "ANA TESTE SOUZA" },
      { id: "900000003", at: "2026-08-10T18:46:42.000Z", title: "Decisão -> Outras Decisões", detail: "Recebe inicial | Determina citação", by: "JUIZ INVENTADO" },
    ],
  },
  { number: "5000456-12.2099.8.09.0051", unit: "Goiânia - Vara de Família", secret: true },
];

/**
 * What any source of the course of lawsuits must do, whatever is behind it. It runs against the fake and
 * against TJGO's Projudi through a stand-in that answers in the shapes of its public webservice.
 */
/**
 * `everyCourt`: an aggregator reads every court, so a lawsuit of another court is one it may have; a
 * court's own system reads its own. What varies by source is not asked: the hour of a movement (a source
 * may give its day only), how a registration at the bar is written, what waits in a lawsuit.
 */
function sourceContract(name: string, make: (lawsuits: FakeProceeding[]) => ProceedingSource, everyCourt = false) {
  describe(`proceeding source contract: ${name}`, () => {
    it("reads a lawsuit and every movement of it, oldest first", async () => {
      const read = await make(LAWSUITS).read(MOVED);
      assert.equal(read.found, true);
      if (!read.found) return;
      assert.equal(read.proceeding.number, "5000123-60.2099.8.09.0051");
      assert.equal(read.proceeding.unit, "Goiânia - 3º Juizado Especial Cível");
      assert.equal(read.proceeding.status, "Ativo");
      assert.equal(read.proceeding.distributedOn, "2026-08-03");
      assert.equal(read.proceeding.secret, false);
      assert.deepEqual(
        read.movements.map((movement) => movement.id),
        ["900000001", "900000002", "900000003"],
      );
      assert.equal(read.movements[2].title, "Decisão -> Outras Decisões");
      // The day it happened, in Brasília, whatever the hour the source gives.
      assert.equal(new Date(Date.parse(read.movements[2].at) - 3 * 3_600_000).toISOString().slice(0, 10), "2026-08-10");
      assert.deepEqual(
        read.proceeding.lawyers.map((lawyer) => [lawyer.name, lawyer.party, lawyer.oab?.replace(/\D/g, "")]),
        [["ANA TESTE SOUZA", "Polo Ativo", "12345"]],
      );
      // Nothing of a party is kept.
      assert.equal(JSON.stringify(read).includes("Parte Autora Inventada"), false);
    });

    it("says a lawsuit it does not have is not found, and one in secret is found with no course", async () => {
      const source = make(LAWSUITS);
      assert.deepEqual(await source.read(UNKNOWN), { found: false });
      const secret = await source.read(SECRET);
      assert.equal(secret.found && secret.proceeding.secret, true);
      assert.equal(secret.found && secret.movements.length, 0);
    });

    it("covers the courts it reads, and finds nothing it does not have", async () => {
      const source = make(LAWSUITS);
      assert.equal(source.covers(MOVED), true);
      assert.equal(source.covers(SAO_PAULO), everyCourt);
      assert.equal(source.covers("5000123-60.2099.8.09.0051"), false);
      assert.deepEqual(await source.read(SAO_PAULO), { found: false });
    });
  });
}

sourceContract("fake", (lawsuits) => {
  const source = new FakeProceedingSource("fake", ["809"]);
  for (const lawsuit of lawsuits) source.add(lawsuit);
  return source;
});

/** Latin-1, as the tribunal writes: each letter is the byte of its code. */
const latin1 = (text: string) => Uint8Array.from(text, (letter) => letter.charCodeAt(0));
const xml = (body: string) => latin1(`<?xml version="1.0" encoding="iso-8859-1"?>\n${body}`);
const wall = (iso: string) => {
  // An instant as the tribunal writes it: Brasília's wall time.
  const local = new Date(Date.parse(iso) - 3 * 3_600_000).toISOString();
  return `${local.slice(8, 10)}/${local.slice(5, 7)}/${local.slice(0, 4)} ${local.slice(11, 19)}`;
};

/** What operation 74 answers for a lawsuit, in the shape the tribunal answered on 2026-10-11. */
function data74(lawsuit: FakeProceeding, id: string, hash: string): string {
  return `<dadosProcesso>
			<numero>${lawsuit.number}</numero>
			<area>Cível</area>
			<numeroTco></numeroTco>
			<rai></rai>
			<idProcesso>${lawsuit.secret ? "" : id}</idProcesso>
<hashProcesso>${lawsuit.secret ? "" : hash}</hashProcesso>
			<partes>
			<parte>
					<parteTipo>Polo Ativo</parteTipo>
					<nome>Parte Autora Inventada</nome>
				</parte>
			</partes>
			<outrasInformacoes>
				<serventia>${lawsuit.unit ?? ""}</serventia>
		   		<classe>${lawsuit.className ?? ""}</classe>
				<assuntos>
				${(lawsuit.subjects ?? []).map((subject) => `<assunto>${subject} -  </assunto>`).join("")}
				</assuntos>
	    	  	<valorCausa>${lawsuit.claimValue ?? ""}</valorCausa>
				<faseProcessual>${lawsuit.phase ?? ""}</faseProcessual>
			    <dataDistribuicao>${lawsuit.distributedOn ? `${lawsuit.distributedOn.slice(8, 10)}/${lawsuit.distributedOn.slice(5, 7)}/${lawsuit.distributedOn.slice(0, 4)} 00:00:00` : ""}</dataDistribuicao>
				<segredoJustica>${lawsuit.secret ? "Sim" : "Não"}</segredoJustica>
				<dataTransitoJulgado></dataTransitoJulgado>
				<status>${lawsuit.status ?? ""}</status>
			</outrasInformacoes>
			</dadosProcesso>`;
}

type Call = { url: URL };

/** TJGO's public webservice in the shapes of its answers: Latin-1 XML, one operation per `PaginaAtual`. */
function projudiStandIn(lawsuits: FakeProceeding[], answer?: (url: URL) => Response | null) {
  const calls: Call[] = [];
  const byId = new Map(lawsuits.map((lawsuit, index) => [String(7000 + index), lawsuit]));
  const hashOf = (id: string) => `${id}99887766`;
  const run = (async (input: string | URL) => {
    const url = new URL(String(input));
    calls.push({ url });
    const special = answer?.(url);
    if (special) return special;
    const page = url.searchParams.get("PaginaAtual");
    const ok = (body: string) => new Response(xml(body), { status: 200, headers: { "content-type": "text/html;charset=iso-8859-1" } });
    if (page === "2") {
      const asked = url.searchParams.get("a") ?? "";
      const found = [...byId].filter(([, lawsuit]) => lawsuit.number === asked || lawsuit.number.startsWith(`${asked}.`));
      return ok(`<resposta versao='1' operacao='74'>\n\t<processos>\n\t${found.map(([id, lawsuit]) => data74(lawsuit, id, hashOf(id))).join("")}\n\t</processos>\n</resposta>`);
    }
    const id = url.searchParams.get("a") ?? "";
    const lawsuit = byId.get(id);
    if (!lawsuit || url.searchParams.get("b") !== hashOf(id)) {
      return ok(`<resposta versao='1' operacao=''>\n\t<situacao>ERRO</situacao>\n\t<mensagem><{Operação Não Autorizada.}> Local Exception: br.gov.go.tj.projudi.ct.publicos.ServicosPublicosCt.executar()</mensagem>\n</resposta>`);
    }
    if (page === "3") {
      // The tribunal lists them in its own order: oldest first.
      const listed = [...(lawsuit.movements ?? [])].sort((a, b) => a.at.localeCompare(b.at));
      return ok(`<resposta versao='1' operacao='75'>\n\t<situacao>OK</situacao>\n\t<mensagem>\t\n\t\t<lista>${listed
        .map(
          (movement) => `
			<Movimentacao>
				<IdMovimentacao>${movement.id}</IdMovimentacao>
				<HashMovimentacao>1${movement.id}</HashMovimentacao>
				<DescricaoMovimentacao>${movement.title.replaceAll(">", "&gt;")}</DescricaoMovimentacao>
				<Complemento>${movement.detail ?? ""}</Complemento>
				<DataRealizacao>${wall(movement.at)}</DataRealizacao>
				<NomeUsuarioRealizador>${movement.by ?? ""}</NomeUsuarioRealizador>
			</Movimentacao>`,
        )
        .join("")}\n\t\t</lista>\n\t</mensagem>\n</resposta>`);
    }
    if (page === "4") {
      return ok(`<resposta versao='1' operacao='76'>\n\t<pendencias>${(lawsuit.pending ?? [])
        .map(
          (entry) => `
		<pendencia>
			<pendenciaTipo>${entry.title} - Parte Autora Inventada</pendenciaTipo>
			<responsavel></responsavel>
			<dataInicio>${entry.start ? wall(entry.start) : ""}</dataInicio>
			<dataFim>${entry.end ? wall(entry.end) : ""}</dataFim>
			<dataLimite></dataLimite>
			<liberadoAte></liberadoAte>
			<status>${entry.status ?? ""}</status>
		</pendencia>`,
        )
        .join("")}\n\t\t</pendencias>\n\t<conclusoes>\n\t\t</conclusoes>\n\t<audiencias>\n\t\t</audiencias>\n</resposta>`);
    }
    if (page === "6") {
      return ok(`<resposta versao='1' operacao='77'>\n\t<responsaveis>${(lawsuit.responsibles ?? [])
        .map((person) => `\n\t\t<responsavel>\n\t\t\t<cargo>${person.role}</cargo>\n\t\t\t<nome>${person.name}</nome>\n\t\t\t<serventia>${person.unit ?? ""}</serventia>\n\t\t</responsavel>`)
        .join("")}\n\t</responsaveis>\n\t<advogados>${(lawsuit.lawyers ?? [])
        .map(
          (lawyer) => `
	<advogado>
			<advogado>${lawyer.name}</advogado>
			<oabMatricula>${lawyer.oab ?? ""}</oabMatricula>
			<dativo>Não</dativo>
			<recebeIntimacao>${lawyer.receivesNotices ? "Sim" : "Não"}</recebeIntimacao>
			<dataHabilitacao>03/08/2026 17:36:41</dataHabilitacao>
			<serventia>Ordem dos Advogados do Brasil GO - GO</serventia>
			<parte>Parte Autora Inventada - ${lawyer.party}</parte>
		</advogado>`,
        )
        .join("")}\n\t</advogados>\n</resposta>`);
    }
    return new Response("", { status: 404 });
  }) as typeof fetch;
  return { run, calls };
}

sourceContract("projudi", (lawsuits) => new ProjudiTjgoSource({ fetch: projudiStandIn(lawsuits).run, pauseMs: 0 }));

describe("TJGO's Projudi, beyond the contract", () => {
  it("asks for the lawsuit by its number with its mask, then its course by the id and hash it answered, paced", async () => {
    const standIn = projudiStandIn(LAWSUITS);
    const waits: number[] = [];
    let clock = 0;
    const source = new ProjudiTjgoSource({
      fetch: standIn.run,
      pauseMs: 1000,
      sleep: async (ms) => {
        waits.push(ms);
        clock += ms;
      },
    });
    const read = await source.read(MOVED);
    // What waits in the lawsuit, with its term, and the movement's own moment.
    assert.equal(read.found && read.proceeding.pending[0].end, "2026-10-30T02:59:59.000Z");
    assert.equal(read.found && read.movements[2].at, "2026-08-10T18:46:42.000Z");
    assert.equal(read.found && read.proceeding.lawyers[0].oab, "12345 N");
    assert.deepEqual(
      standIn.calls.map((call) => call.url.searchParams.get("PaginaAtual")),
      ["2", "3", "4", "6"],
    );
    assert.equal(standIn.calls[0].url.origin + standIn.calls[0].url.pathname, "https://projudi.tjgo.jus.br/ServicosPublicos");
    assert.equal(standIn.calls[0].url.searchParams.get("a"), "5000123-60.2099.8.09.0051");
    assert.equal(standIn.calls[1].url.searchParams.get("a"), "7000");
    assert.equal(standIn.calls[1].url.searchParams.get("b"), "700099887766");
    // One call at a time, a pause between two.
    assert.equal(waits.length, 3);
    assert.ok(clock > 0);
  });

  it("keeps the side a lawyer acts for and never the party's name", async () => {
    const read = await new ProjudiTjgoSource({ fetch: projudiStandIn(LAWSUITS).run, pauseMs: 0 }).read(MOVED);
    assert.equal(read.found && JSON.stringify(read).includes("Parte Autora Inventada - "), false);
    assert.equal(read.found && read.proceeding.lawyers[0].party, "Polo Ativo");
    assert.deepEqual(read.found && read.proceeding.subjects, ["Transporte Aéreo"]);
  });

  it("tells a refusal, a tribunal out of the air and an answer that is not whole apart from a lawsuit it does not have", async () => {
    const answering = (response: () => Response) =>
      new ProjudiTjgoSource({ fetch: projudiStandIn(LAWSUITS, (url) => (url.searchParams.get("PaginaAtual") === "3" ? response() : null)).run, pauseMs: 0 });
    // An id and a hash that no longer match.
    const refused = `<?xml version="1.0" encoding="iso-8859-1"?><resposta versao='1' operacao=''><situacao>ERRO</situacao><mensagem><{Operação Não Autorizada.}> Local Exception</mensagem></resposta>`;
    await assert.rejects(answering(() => new Response(latin1(refused), { status: 200 })).read(MOVED), ProjudiRefusedError);
    await assert.rejects(
      answering(() => new Response("", { status: 503 })).read(MOVED),
      (error: unknown) => error instanceof ProjudiUnavailableError && error.status === 503,
    );
    await assert.rejects(
      answering(() => new Response(latin1("<resposta><situacao>OK</situacao><mensagem><lista><Movimentacao>"), { status: 200 })).read(MOVED),
      ProjudiUnavailableError,
    );
    // A movement with no id of its own is no movement this can keep: the answer is not whole.
    const odd = `<resposta versao='1' operacao='75'><situacao>OK</situacao><mensagem><lista><Movimentacao><IdMovimentacao></IdMovimentacao><DescricaoMovimentacao>Juntada</DescricaoMovimentacao><DataRealizacao>03/08/2026 10:00:00</DataRealizacao></Movimentacao></lista></mensagem></resposta>`;
    await assert.rejects(answering(() => new Response(latin1(odd), { status: 200 })).read(MOVED), ProjudiUnavailableError);
    const silent = new ProjudiTjgoSource({
      fetch: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
      pauseMs: 0,
    });
    await assert.rejects(silent.read(MOVED), (error: unknown) => error instanceof ProjudiUnavailableError && error.status === null);
  });

  it("asks nothing for a number of another court", async () => {
    const standIn = projudiStandIn(LAWSUITS);
    await new ProjudiTjgoSource({ fetch: standIn.run, pauseMs: 0 }).read(SAO_PAULO);
    assert.equal(standIn.calls.length, 0);
  });
});

/** A lawsuit's number as Escavador and Judit write it in a path: masked or digits. */
const digitsOf = (text: string) => decodeURIComponent(text).replace(/\D/g, "");

/**
 * Escavador's API v2 in the shapes of its OpenAPI document (read on 2026-10-11): the lawsuit with its
 * sources, and its movements in pages followed by a cursor. Movements carry a day and no hour; a gazette's
 * publication is among them.
 */
function escavadorStandIn(lawsuits: FakeProceeding[], answer?: (url: URL) => Response | null, pageSize = 2) {
  const calls: { url: URL; auth: string | null }[] = [];
  const run = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, auth: new Headers(init?.headers).get("authorization") });
    const special = answer?.(url);
    if (special) return special;
    const match = /\/processos\/numero_cnj\/([^/]+)(\/movimentacoes)?$/.exec(url.pathname);
    const lawsuit = match ? lawsuits.find((one) => one.number.replace(/\D/g, "") === digitsOf(match[1])) : undefined;
    if (!match || !lawsuit) return Response.json({ error: "NotFound" }, { status: 404 });
    if (!match[2]) {
      return Response.json({
        numero_cnj: lawsuit.number,
        titulo_polo_ativo: "Parte Autora Inventada",
        fontes: [
          {
            id: 3,
            tipo: "TRIBUNAL",
            sigla: "TJGO",
            grau: 1,
            segredo_justica: lawsuit.secret ? true : null,
            sistema: "PROJUDI",
            capa: {
              classe: lawsuit.className,
              assunto: lawsuit.subjects?.[0] ?? null,
              orgao_julgador: lawsuit.unit,
              situacao: lawsuit.status,
              valor_causa: lawsuit.claimValue ? { valor_formatado: `R$ ${lawsuit.claimValue}` } : null,
              data_distribuicao: lawsuit.distributedOn,
            },
            audiencias: [],
            envolvidos: [
              {
                nome: "Parte Autora Inventada",
                polo: "ATIVO",
                cpf: "00000000000",
                advogados: (lawsuit.lawyers ?? []).map((lawyer) => ({
                  nome: lawyer.name,
                  tipo: "ADVOGADO",
                  oabs: [{ uf: "GO", tipo: "ADVOGADO", numero: Number(lawyer.oab?.replace(/\D/g, "")) }],
                })),
              },
            ],
          },
        ],
      });
    }
    const items = [
      ...(lawsuit.movements ?? []).map((movement) => ({
        id: Number(movement.id),
        data: new Date(Date.parse(movement.at) - 3 * 3_600_000).toISOString().slice(0, 10),
        tipo: "ANDAMENTO",
        conteudo: movement.title,
        fonte: { tipo: "TRIBUNAL", sigla: "TJGO", grau: 1 },
      })),
      { id: 1, data: "2026-08-11", tipo: "PUBLICAÇÃO", conteudo: "Intimação publicada no diário", fonte: { tipo: "DIARIO_OFICIAL", sigla: "DJGO" } },
    ].sort((a, b) => a.data.localeCompare(b.data) || a.id - b.id);
    const cursor = Number(url.searchParams.get("cursor") ?? 0);
    const page = items.slice(cursor, cursor + pageSize);
    const next = cursor + pageSize < items.length ? `${url.origin}${url.pathname}?cursor=${cursor + pageSize}&limit=100` : null;
    return Response.json({ items: page, links: { next }, paginator: { per_page: pageSize } });
  }) as typeof fetch;
  return { run, calls };
}

/**
 * Judit's lawsuits API in the shapes of its OpenAPI document (read on 2026-10-11): the lawsuit from its copy,
 * with its parties (and much of each person, which is never kept), their lawyers and its steps.
 */
function juditStandIn(lawsuits: FakeProceeding[], answer?: (url: URL) => Response | null) {
  const calls: { url: URL; key: string | null }[] = [];
  const run = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ url, key: new Headers(init?.headers).get("api-key") });
    const special = answer?.(url);
    if (special) return special;
    const asked = digitsOf(url.pathname.split("/").pop() ?? "");
    const lawsuit = lawsuits.find((one) => one.number.replace(/\D/g, "") === asked);
    if (!lawsuit) return Response.json({ error: { name: "NotFound", message: "Lawsuit not found" } }, { status: 404 });
    return Response.json({
      code: lawsuit.number,
      instance: 1,
      courts: [{ code: "1", name: lawsuit.unit }],
      tribunal_acronym: "TJGO",
      judge: "JUIZ INVENTADO",
      distribution_date: lawsuit.distributedOn ? `${lawsuit.distributedOn}T00:00:00.000Z` : null,
      situation: lawsuit.status,
      phase: lawsuit.phase,
      amount: 15000,
      secrecy_level: lawsuit.secret ? 1 : 0,
      classifications: [{ code: "436", name: lawsuit.className }],
      subjects: (lawsuit.subjects ?? []).map((name) => ({ code: "1", name })),
      parties: [
        {
          name: "Parte Autora Inventada",
          side: "Active",
          main_document: "00000000000",
          addresses: [{ street: "Rua Inventada", number: "1" }],
          lawyers: (lawsuit.lawyers ?? []).map((lawyer) => ({
            name: lawyer.name,
            documents: [{ document: `GO${lawyer.oab?.replace(/\D/g, "")}`, document_type: "oab" }],
          })),
        },
      ],
      steps: [
        ...(lawsuit.movements ?? []).map((movement) => ({
          lawsuit_cnj: lawsuit.number,
          lawsuit_instance: 1,
          step_id: movement.id,
          step_date: movement.at,
          content: movement.title,
          step_type: "andamento",
          private: false,
        })),
        { step_id: "sigiloso-1", step_date: "2026-08-12T10:00:00.000Z", content: "Documento sigiloso", private: true },
      ],
    });
  }) as typeof fetch;
  return { run, calls };
}

sourceContract("escavador", (lawsuits) => new EscavadorSource({ token: "token-de-teste", fetch: escavadorStandIn(lawsuits).run }), true);
sourceContract("judit", (lawsuits) => new JuditSource({ apiKey: "chave-de-teste", fetch: juditStandIn(lawsuits).run }), true);

describe("the aggregators, beyond the contract", () => {
  it("asks Escavador with its token, follows the cursor and keeps the court's movements only", async () => {
    const standIn = escavadorStandIn(LAWSUITS);
    const read = await new EscavadorSource({ token: "token-de-teste", fetch: standIn.run }).read(MOVED);
    assert.equal(standIn.calls[0].auth, "Bearer token-de-teste");
    assert.equal(standIn.calls[0].url.pathname, "/api/v2/processos/numero_cnj/5000123-60.2099.8.09.0051");
    assert.equal(standIn.calls[1].url.searchParams.get("ordem"), "asc");
    // Four items in pages of two: the cursor is followed to the end.
    assert.equal(standIn.calls.length, 3);
    assert.equal(read.found && read.movements.some((movement) => movement.title.includes("diário")), false);
    assert.equal(read.found && read.movements[0].at, "2026-08-03T15:00:00.000Z");
    assert.equal(read.found && read.proceeding.claimValue, "R$ 15.000,00");
    // Past the pages one reading follows, the reading is not whole.
    await assert.rejects(
      new EscavadorSource({ token: "t", fetch: escavadorStandIn(LAWSUITS, undefined, 1).run, maxPages: 2 }).read(MOVED),
      AggregatorUnavailableError,
    );
  });

  it("asks Judit with its key, for no inferred parties, and keeps no private step", async () => {
    const standIn = juditStandIn(LAWSUITS);
    const read = await new JuditSource({ apiKey: "chave-de-teste", fetch: standIn.run }).read(MOVED);
    assert.equal(standIn.calls[0].key, "chave-de-teste");
    assert.equal(standIn.calls[0].url.searchParams.get("with_inferred_parties"), "false");
    assert.equal(decodeURIComponent(standIn.calls[0].url.pathname), "/lawsuits/5000123-60.2099.8.09.0051");
    assert.equal(read.found && read.movements.length, 3);
    assert.equal(read.found && read.proceeding.claimValue?.replace(/\s/g, " "), "R$ 15.000,00");
    assert.deepEqual(read.found && read.proceeding.responsibles, [{ role: "Juiz", name: "JUIZ INVENTADO", unit: "Goiânia - 3º Juizado Especial Cível" }]);
    assert.equal(JSON.stringify(read).includes("Rua Inventada"), false);
  });

  it("tells a refused key, a balance run out and a vendor out of the air apart from a lawsuit it does not have", async () => {
    const escavador = (response: () => Response) =>
      new EscavadorSource({ token: "t", fetch: escavadorStandIn(LAWSUITS, () => response()).run });
    await assert.rejects(escavador(() => Response.json({ error: "Unauthenticated" }, { status: 401 })).read(MOVED), AggregatorAuthError);
    await assert.rejects(
      escavador(() => Response.json({ error: "Você não possui saldo em crédito da API." }, { status: 402 })).read(MOVED),
      AggregatorNoCreditError,
    );
    await assert.rejects(
      escavador(() => new Response("", { status: 503 })).read(MOVED),
      (error: unknown) => error instanceof AggregatorUnavailableError && error.status === 503,
    );
    const judit = (response: () => Response) => new JuditSource({ apiKey: "k", fetch: juditStandIn(LAWSUITS, () => response()).run });
    await assert.rejects(judit(() => new Response("not json", { status: 200 })).read(MOVED), AggregatorUnavailableError);
    // An answer with no number of the lawsuit is one that cannot be read, never "not found".
    await assert.rejects(judit(() => Response.json({}, { status: 200 })).read(MOVED), AggregatorUnavailableError);
    // A page of movements that is not, after the lawsuit was found, is no answer: never the end of them.
    const lost = new EscavadorSource({
      token: "t",
      fetch: escavadorStandIn(LAWSUITS, (url) => (url.searchParams.get("cursor") === "2" ? Response.json({ error: "NotFound" }, { status: 404 }) : null)).run,
    });
    await assert.rejects(lost.read(MOVED), (error: unknown) => error instanceof AggregatorUnavailableError && error.status === 404);
  });

  it("reads Judit's lawsuit inside `response_data` too, a lawyer's `oab`, and a step's day alone as that day", async () => {
    const wrapped = Response.json({
      response_data: {
        code: "5000123-60.2099.8.09.0051",
        courts: [{ name: "Goiânia - 3º Juizado Especial Cível" }],
        steps: [{ step_id: "s1", step_date: "2026-08-10", content: "Decisão" }, { step_id: "s2", step_date: "2026-08-11T00:00:00.000Z", content: "Citação" }],
      },
      parties: [{ name: "Parte Autora Inventada", side: "Active", lawyers: [{ name: "ANA TESTE SOUZA", oab: "12345/GO" }] }],
    });
    const read = await new JuditSource({ apiKey: "k", fetch: juditStandIn([], () => wrapped).run }).read(MOVED);
    assert.equal(read.found, true);
    if (!read.found) return;
    assert.deepEqual(read.proceeding.lawyers, [{ name: "ANA TESTE SOUZA", oab: "12345/GO", party: "Polo Ativo", receivesNotices: null }]);
    assert.deepEqual(
      read.movements.map((movement) => movement.at),
      ["2026-08-10T15:00:00.000Z", "2026-08-11T15:00:00.000Z"],
    );
    assert.equal(JSON.stringify(read).includes("Parte Autora Inventada"), false);
  });
});

describe("a CNJ number and a moment, as the tribunal writes them", () => {
  it("masks a number, tells TJGO's, and reads Brasília's wall time as the instant it was", () => {
    assert.equal(maskCnj(MOVED), "5000123-60.2099.8.09.0051");
    assert.equal(isTjgoNumber(MOVED), true);
    assert.equal(isTjgoNumber(SAO_PAULO), false);
    assert.equal(isTjgoNumber("5000123-60.2099.8.09.0051"), false);
    assert.equal(brasiliaInstant("18/02/2025 17:36:41"), "2025-02-18T20:36:41.000Z");
    // Brasília kept a summer time until 2019.
    assert.equal(brasiliaInstant("20/12/2018 10:00:00"), "2018-12-20T12:00:00.000Z");
    assert.equal(brasiliaInstant("31/02/2026 10:00"), null);
    assert.equal(brasiliaInstant(""), null);
  });
});

describe("the XML a court answers", () => {
  it("reads elements, text and entities, and takes a stray \"<\" as text", () => {
    const root = parseXml(`<?xml version="1.0"?><resposta versao='1' operacao="75"><a>Decisão -&gt; Outras &amp; mais</a><b><{Não Autorizada.}> fim</b><c/></resposta>`);
    assert.equal(root.name, "resposta");
    assert.equal(root.attributes.operacao, "75");
    assert.equal(textOf(root, "a"), "Decisão -> Outras & mais");
    assert.equal(textOf(root, "b"), "<{Não Autorizada.}> fim");
    assert.equal(textOf(root, "c"), "");
  });

  it("refuses what is not a whole document", () => {
    assert.throws(() => parseXml("<resposta><a>cut"), XmlError);
    assert.throws(() => parseXml("<resposta></a></resposta>"), XmlError);
    assert.throws(() => parseXml("<a></a><b></b>"), XmlError);
  });
});

describe("the comparative test of sources", () => {
  it("scores each source against what all of them saw: found, missed, failed, days seen and how far behind", async () => {
    const movement = (id: string, at: string) => ({ id, at, title: `Movimento ${id}`, detail: null, by: null });
    const lawsuit = (number: string, movements: ReturnType<typeof movement>[]): FakeProceeding => ({ number, movements });
    const fresh = new FakeProceedingSource("fresh", ["809"]);
    fresh.add(lawsuit("5000123-60.2099.8.09.0051", [movement("1", "2026-08-03T13:00:00Z"), movement("2", "2026-08-10T13:00:00Z"), movement("3", "2026-08-20T13:00:00Z")]));
    fresh.add(lawsuit("5000456-12.2099.8.09.0051", [movement("4", "2026-09-01T13:00:00Z")]));
    const late = new FakeProceedingSource("late", ["809"]);
    late.add(lawsuit("5000123-60.2099.8.09.0051", [movement("a", "2026-08-03T14:00:00Z"), movement("b", "2026-08-10T14:00:00Z")]));
    const down = new FakeProceedingSource("down", ["809"]);
    down.unreachable(MOVED);
    let clock = 0;
    const tries = await askAll([fresh, late, down], [MOVED, SECRET, SAO_PAULO], () => (clock += 100));
    // A number no source covers is asked of none.
    assert.equal(tries.some((attempt) => attempt.cnj === SAO_PAULO), false);
    const [freshScore, lateScore, downScore] = compareSources(tries);
    assert.deepEqual(
      { found: freshScore.found, missed: freshScore.missed, coverage: freshScore.dayCoverage, behind: freshScore.behind },
      { found: 2, missed: 0, coverage: 1, behind: 0 },
    );
    assert.equal(lateScore.missed, 1);
    assert.equal(lateScore.dayCoverage, 2 / 3);
    assert.equal(lateScore.behind, 1);
    assert.equal(lateScore.medianLagDays, 10);
    assert.equal(downScore.failed, 1);
    // A failure is never "not found".
    assert.equal(downScore.notFound, 1);
    assert.equal(downScore.medianMs, 100);
  });

  it("counts by the day in Brasília, and a lawsuit found with no movement while another saw some as behind", () => {
    const read = (movements: { id: string; at: string }[]) => ({
      found: true as const,
      proceeding: { number: "x", unit: null, className: null, subjects: [], phase: null, status: null, claimValue: null, distributedOn: null, finalOn: null, secret: false, lawyers: [], responsibles: [], pending: [] },
      movements: movements.map((movement) => ({ ...movement, title: "t", detail: null, by: null })),
    });
    const scores = compareSources([
      // The court's own system gives the hour; a vendor gives the day, at noon: the same day either way.
      { source: "court", cnj: MOVED, ms: 1, error: null, read: read([{ id: "1", at: "2026-08-10T21:00:00.000Z" }]) },
      { source: "vendor", cnj: MOVED, ms: 1, error: null, read: read([{ id: "a", at: "2026-08-10T15:00:00.000Z" }]) },
      { source: "empty", cnj: MOVED, ms: 1, error: null, read: read([]) },
    ]);
    assert.deepEqual(
      scores.map((score) => [score.source, score.behind, score.medianLagDays]),
      [["court", 0, null], ["vendor", 0, null], ["empty", 1, null]],
    );
  });
});
