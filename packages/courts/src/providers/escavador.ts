import { maskCnj } from "@flyee/courts/providers/projudi";
import {
  AggregatorUnavailableError,
  getJson,
  listOf,
  recordOf,
  textOf,
} from "@flyee/courts/providers/aggregator-http";
import type { CourtMovement, CourtProceeding, ProceedingRead, ProceedingSource } from "@flyee/courts/types";

/**
 * The course of a lawsuit of any court, from Escavador's API v2. Written from
 * its OpenAPI document (api.escavador.com/v2/docs, read on 2026-10-11); it
 * has not run against Escavador:
 *
 *   GET https://api.escavador.com/api/v2/processos/numero_cnj/{number}
 *       the lawsuit as Escavador last read it, with each of its sources (`fontes`: a court and its
 *       instance, or a gazette), the cover of each (`capa`), its parties and lawyers (`envolvidos`,
 *       each lawyer with `oabs`), and its hearings (`audiencias`); 404 `{"error": "NotFound"}`;
 *   GET .../movimentacoes?limit=100&ordem=asc
 *       its movements, 100 a page, followed by `links.next` (a cursor): each with `id`, `data` (a day,
 *       no hour), `tipo` (ANDAMENTO, or PUBLICAÇÃO for a gazette's), `conteudo` and its `fonte`;
 *
 * with `Authorization: Bearer <token>`; 401 for a key refused, 402 for a
 * balance that ran out. What is read is Escavador's copy, which it refreshes
 * by itself (a refresh asked of the court is another endpoint, paid, and
 * asynchronous): how far behind that copy runs is what the comparative test
 * measures.
 *
 * Kept: the court's movements (ANDAMENTO), each by Escavador's id, dated by
 * its day at noon in Brasília (the source gives no hour); the gazette's
 * publications are left out, since the DJEN is read for the firm's lawyers
 * directly. Never kept: the parties, nor any CPF the answer carries.
 */

export const ESCAVADOR_BASE_URL = "https://api.escavador.com/api/v2";

export type EscavadorConfig = {
  token: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** The most pages of movements one reading follows: past them the reading is not whole, and fails. */
  maxPages?: number;
};

/** A day, "YYYY-MM-DD", as noon of that day in Brasília, an ISO instant; null when it is not a day. */
const noonOf = (day: string | null): string | null =>
  day && /^\d{4}-\d{2}-\d{2}$/.test(day) && !Number.isNaN(Date.parse(`${day}T12:00:00-03:00`))
    ? new Date(`${day}T12:00:00-03:00`).toISOString()
    : null;

const SIDE: Record<string, string> = { ATIVO: "Polo Ativo", PASSIVO: "Polo Passivo" };

/** The next page's address, its page size kept (the cursor its document shows carries none). */
function withPageSize(next: string | null): string | null {
  if (!next) return null;
  try {
    const url = new URL(next);
    if (!url.searchParams.has("limit")) url.searchParams.set("limit", "100");
    return url.toString();
  } catch {
    return null;
  }
}

export class EscavadorSource implements ProceedingSource {
  readonly name = "escavador";
  private readonly config: EscavadorConfig;

  constructor(config: EscavadorConfig) {
    this.config = config;
  }

  covers(cnj: string): boolean {
    return /^\d{20}$/.test(cnj);
  }

  async read(cnj: string): Promise<ProceedingRead> {
    if (!this.covers(cnj)) return { found: false };
    const base = (this.config.baseUrl ?? ESCAVADOR_BASE_URL).replace(/\/+$/, "");
    const headers = { authorization: `Bearer ${this.config.token}` };
    const options = { fetch: this.config.fetch, timeoutMs: this.config.timeoutMs };
    const lawsuit = await getJson("escavador", `${base}/processos/numero_cnj/${maskCnj(cnj)}`, headers, options);
    if (lawsuit.status === 404) return { found: false };
    const body = recordOf(lawsuit.body);
    if (textOf(body.numero_cnj)?.replace(/\D/g, "") !== cnj) throw new AggregatorUnavailableError("escavador", null, "unreadable");

    // The court's first instance speaks for the lawsuit; failing that, the first court, then the first source.
    const sources = listOf(body.fontes).map(recordOf);
    const courts = sources.filter((source) => source.tipo === "TRIBUNAL");
    const main = courts.find((source) => source.grau === 1) ?? courts[0] ?? sources[0] ?? {};
    const cover = recordOf(main.capa);
    const proceeding: CourtProceeding = {
      number: textOf(body.numero_cnj) ?? maskCnj(cnj),
      unit: textOf(cover.orgao_julgador) ?? textOf(recordOf(body.unidade_origem).nome),
      className: textOf(cover.classe),
      subjects: [textOf(cover.assunto)].filter((subject): subject is string => subject !== null),
      phase: null,
      status: textOf(cover.situacao) ?? textOf(main.status_predito),
      claimValue: textOf(recordOf(cover.valor_causa).valor_formatado),
      distributedOn: textOf(cover.data_distribuicao)?.slice(0, 10) ?? null,
      finalOn: null,
      secret: courts.some((source) => source.segredo_justica === true),
      lawyers: listOf(main.envolvidos)
        .map(recordOf)
        .flatMap((party) =>
          listOf(party.advogados)
            .map(recordOf)
            .map((lawyer) => {
              const oab = recordOf(listOf(lawyer.oabs)[0]);
              const number = textOf(oab.numero);
              return {
                name: textOf(lawyer.nome) ?? "",
                oab: number ? `${number}${textOf(oab.uf) ? `/${textOf(oab.uf)}` : ""}` : null,
                party: SIDE[textOf(party.polo) ?? ""] ?? null,
                receivesNotices: null,
              };
            }),
        )
        .filter((lawyer) => lawyer.name),
      responsibles: [],
      pending: listOf(main.audiencias)
        .map(recordOf)
        .map((hearing) => ({
          kind: "hearing" as const,
          title: textOf(hearing.tipo) ?? "Audiência",
          status: textOf(hearing.situacao),
          start: noonOf(textOf(hearing.data)),
          end: null,
        })),
    };

    const movements: CourtMovement[] = [];
    let next: string | null = `${base}/processos/numero_cnj/${maskCnj(cnj)}/movimentacoes?limit=100&ordem=asc`;
    for (let page = 0; next; page += 1) {
      if (page >= (this.config.maxPages ?? 50)) throw new AggregatorUnavailableError("escavador", null, "too_long");
      const answer = await getJson("escavador", next, headers, options);
      // The lawsuit was found: a page of its movements that is not is no answer, never the end of them.
      if (answer.status === 404) throw new AggregatorUnavailableError("escavador", 404);
      const listing = recordOf(answer.body);
      if (!Array.isArray(listing.items)) throw new AggregatorUnavailableError("escavador", null, "unreadable");
      for (const item of listing.items.map(recordOf)) {
        if (item.tipo !== "ANDAMENTO") continue;
        const id = textOf(item.id);
        const at = noonOf(textOf(item.data));
        const title = textOf(item.conteudo);
        if (!id || !at || !title) throw new AggregatorUnavailableError("escavador", null, "movement_unreadable");
        movements.push({ id, at, title: title.slice(0, 1000), detail: null, by: null });
      }
      next = withPageSize(textOf(recordOf(listing.links).next));
    }
    movements.sort((a, b) => a.at.localeCompare(b.at) || Number(a.id) - Number(b.id));
    return { found: true, proceeding, movements: proceeding.secret ? [] : movements };
  }
}
