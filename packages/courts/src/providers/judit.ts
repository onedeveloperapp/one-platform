import {
  AggregatorUnavailableError,
  getJson,
  listOf,
  recordOf,
  textOf,
} from "@flyee/courts/providers/aggregator-http";
import { maskCnj } from "@flyee/courts/providers/projudi";
import type { CourtMovement, CourtProceeding, ProceedingRead, ProceedingSource } from "@flyee/courts/types";

/**
 * The course of a lawsuit of any court, from Judit. Written from its OpenAPI
 * document (lawsuits.production.judit.io/docs/spec, read on 2026-10-11); it
 * has not run against Judit:
 *
 *   GET https://lawsuits.production.judit.io/lawsuits/{number}?with_inferred_parties=false
 *       the lawsuit from Judit's copy ("datalake"): its court, class, subjects, state, phase, judge,
 *       distribution, value (`amount`), secrecy (`secrecy_level`), its parties with their lawyers
 *       (each with `documents` of type "oab"), and its movements (`steps`: `step_id`, `step_date`,
 *       `content`, `step_type`, `private`);
 *
 * with the key in the header `api-key`. A fresh reading asked of the court is
 * another API of Judit's, asynchronous (a request, then its answer): what is
 * read here is its copy, and how far behind it runs is what the comparative
 * test measures. Its document gives no answer for a lawsuit it does not have:
 * a 404 is read as not found, and an answer with no number of the lawsuit
 * as one that cannot be read, never as not found. Its OpenAPI document shows
 * the lawsuit flat, and its pages of examples inside `response_data` (with
 * the parties beside it, and a lawyer's registration as `oab`): both are
 * read. A step dated by its day alone is that day at noon in Brasília. The
 * number goes in the path with its mask, as every example of its writes it.
 *
 * Never kept: the parties (Judit's carry addresses, documents and more of
 * each person), nor a movement Judit marks private.
 */

export const JUDIT_LAWSUITS_URL = "https://lawsuits.production.judit.io";

export type JuditConfig = {
  apiKey: string;
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
};

const money = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

/** A field of an answer, when there is one: the parties Judit's examples put beside `response_data`. */
const pick = (record: Record<string, unknown>, field: string): Record<string, unknown> =>
  record[field] === undefined ? {} : { [field]: record[field] };

/** A step's date as an instant: a day alone (or that day's midnight in UTC) is the day, at noon in Brasília. */
function instantOf(date: string): string {
  const day = /^(\d{4}-\d{2}-\d{2})(?:T00:00(?::00(?:\.0+)?)?Z)?$/.exec(date.trim());
  return new Date(day ? `${day[1]}T12:00:00-03:00` : date).toISOString();
}

/** A side as Judit writes it ("Active", "Passive"), in the words of the courts. */
const sideOf = (side: string | null): string | null =>
  side === null ? null : /^activ/i.test(side) ? "Polo Ativo" : /^passiv/i.test(side) ? "Polo Passivo" : side;

export class JuditSource implements ProceedingSource {
  readonly name = "judit";
  private readonly config: JuditConfig;

  constructor(config: JuditConfig) {
    this.config = config;
  }

  covers(cnj: string): boolean {
    return /^\d{20}$/.test(cnj);
  }

  async read(cnj: string): Promise<ProceedingRead> {
    if (!this.covers(cnj)) return { found: false };
    const base = (this.config.baseUrl ?? JUDIT_LAWSUITS_URL).replace(/\/+$/, "");
    const answer = await getJson(
      "judit",
      `${base}/lawsuits/${maskCnj(cnj)}?with_inferred_parties=false`,
      { "api-key": this.config.apiKey },
      { fetch: this.config.fetch, timeoutMs: this.config.timeoutMs },
    );
    if (answer.status === 404) return { found: false };
    const outer = recordOf(answer.body);
    const body = outer.response_data ? { ...recordOf(outer.response_data), ...pick(outer, "parties") } : outer;
    const code = textOf(body.code)?.replace(/\D/g, "") ?? null;
    // An answer with no number of the lawsuit, or another's, is not one this can read: never "not found".
    if (code !== cnj) throw new AggregatorUnavailableError("judit", null, "unreadable");

    const amount = typeof body.amount === "number" && Number.isFinite(body.amount) ? money.format(body.amount) : null;
    const unit = textOf(recordOf(listOf(body.courts)[0]).name) ?? textOf(body.county);
    const proceeding: CourtProceeding = {
      number: textOf(body.code) ?? cnj,
      unit,
      className: textOf(recordOf(listOf(body.classifications)[0]).name),
      subjects: listOf(body.subjects)
        .map((subject) => textOf(recordOf(subject).name))
        .filter((subject): subject is string => subject !== null),
      phase: textOf(body.phase),
      status: textOf(body.situation) ?? textOf(body.status),
      claimValue: amount,
      distributedOn: textOf(body.distribution_date)?.slice(0, 10) ?? null,
      finalOn: null,
      secret: typeof body.secrecy_level === "number" && body.secrecy_level > 0,
      lawyers: listOf(body.parties)
        .map(recordOf)
        .flatMap((party) =>
          listOf(party.lawyers)
            .map(recordOf)
            .map((lawyer) => ({
              name: textOf(lawyer.name) ?? "",
              oab:
                textOf(lawyer.oab) ??
                listOf(lawyer.documents)
                  .map(recordOf)
                  .filter((document) => /^oab$/i.test(textOf(document.document_type) ?? ""))
                  .map((document) => textOf(document.document))
                  .find((document) => document !== null) ?? null,
              party: sideOf(textOf(party.side)),
              receivesNotices: null,
            })),
        )
        .filter((lawyer) => lawyer.name),
      responsibles: textOf(body.judge) ? [{ role: "Juiz", name: textOf(body.judge) as string, unit }] : [],
      pending: [],
    };

    const movements: CourtMovement[] = [];
    for (const step of listOf(body.steps).map(recordOf)) {
      if (step.private === true) continue;
      const id = textOf(step.step_id);
      const at = textOf(step.step_date);
      const content = textOf(step.content);
      if (!id || !at || Number.isNaN(Date.parse(at)) || !content) {
        throw new AggregatorUnavailableError("judit", null, "movement_unreadable");
      }
      movements.push({ id: id.slice(0, 100), at: instantOf(at), title: content.slice(0, 1000), detail: null, by: null });
    }
    movements.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
    return { found: true, proceeding, movements: proceeding.secret ? [] : movements };
  }
}
