import type { CourtMovement, CourtProceeding, ProceedingRead, ProceedingSource } from "@flyee/courts/types";
import { childNamed, childrenNamed, parseXml, textOf, type XmlElement, XmlError } from "@flyee/courts/xml";

/**
 * The course of TJGO's lawsuits, from the public webservice of its Projudi
 * (the tribunal also calls it PJD). Written from what the tribunal publishes
 * (its page "Acesso automatizado por sistemas externos" and the list of its
 * webservices, read on 2026-10-08) and checked against the service itself on
 * 2026-10-11, by the shape of its answers only:
 *
 *   GET https://projudi.tjgo.jus.br/ServicosPublicos?PaginaAtual=2&PosicaoPaginaAtual=0&a=<number>
 *       operation 74, a lawsuit by its number with its mask (whole, or up to the year): its id and a
 *       hash, which the other three ask for, and its data;
 *   GET ...?PaginaAtual=3&a=<id>&b=<hash>   operation 75, its movements;
 *   GET ...?PaginaAtual=4&a=<id>&b=<hash>   operation 76, what waits in it: pendencies, conclusions,
 *                                            hearings;
 *   GET ...?PaginaAtual=6&a=<id>&b=<hash>   operation 77, who answers for it and the lawyers on record.
 *
 * No key and no login. What the check found, and what this reads by: every
 * answer is XML in Latin-1 (`iso-8859-1`), `<resposta versao='1'
 * operacao='74'>`; a number the tribunal does not have answers an empty
 * `<processos>`; the number in digits alone is refused (an error); a lawsuit in
 * secret ("segredoJustica" Sim) comes with no id and no hash, so nothing of
 * its course is public; an id and a hash that do not match answer
 * `<situacao>ERRO</situacao>` with "Operação Não Autorizada" (and a message
 * whose "<{...}>" is no XML); operation 75 answers `<situacao>OK</situacao>`
 * and every movement at once, oldest first, each with its own id
 * (`IdMovimentacao`), its words (`DescricaoMovimentacao`, `Complemento`, with
 * "->" written "-&gt;"), its moment (`DataRealizacao`, "dd/mm/aaaa hh:mm:ss",
 * the tribunal's time, Brasília's) and who did it; a registration at the bar
 * is written "12345 A". The hearings and conclusions of operation 76 came
 * empty in every lawsuit seen, so their entries are read by whatever fields
 * they carry.
 *
 * The parties are not kept (the firm has its clients), nor the name of a
 * party a lawyer acts for (only the side, "Polo Ativo"), nor the name of who
 * an intimation is for (only "Intimação"). Calls are paced, one
 * at a time: the tribunal serves the public with the same machines.
 */

export const PROJUDI_TJGO_URL = "https://projudi.tjgo.jus.br/ServicosPublicos";

/** The tribunal did not answer, or answered what cannot be read whole. */
export class ProjudiUnavailableError extends Error {
  readonly status: number | null;
  constructor(status: number | null, reason = "no_answer") {
    super(status === null ? `projudi_${reason}` : `projudi_http_${status}`);
    this.name = "ProjudiUnavailableError";
    this.status = status;
  }
}

/** The tribunal refused what was asked ("Operação Não Autorizada"): an id and a hash that no longer match. */
export class ProjudiRefusedError extends Error {
  constructor(message: string) {
    super(`projudi_refused: ${message.slice(0, 120)}`);
    this.name = "ProjudiRefusedError";
  }
}

/** A lawsuit of TJGO: the state courts' segment (8) and the tribunal's code (09) in its number. */
export const isTjgoNumber = (cnj: string): boolean => /^\d{20}$/.test(cnj) && cnj.slice(13, 16) === "809";

/** A CNJ number with its mask: NNNNNNN-DD.AAAA.J.TR.OOOO. */
export function maskCnj(digits: string): string {
  return `${digits.slice(0, 7)}-${digits.slice(7, 9)}.${digits.slice(9, 13)}.${digits.slice(13, 14)}.${digits.slice(14, 16)}.${digits.slice(16, 20)}`;
}

/** The instant of a wall time of Brasília, "dd/mm/aaaa hh:mm[:ss]", as ISO; null when it is not one. */
export function brasiliaInstant(value: string): string | null {
  const match = /^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?$/.exec(value.trim());
  if (!match) return null;
  const [, day, month, year, hour = "00", minute = "00", second = "00"] = match;
  const asUtc = Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second));
  const back = new Date(asUtc);
  if (back.getUTCDate() !== Number(day) || back.getUTCMonth() !== Number(month) - 1 || back.getUTCHours() !== Number(hour)) {
    return null;
  }
  // Brasília's offset of that day, asked of the platform's zone data (it kept a summer time until 2019).
  const offsetAt = (instant: number) => {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Sao_Paulo",
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(new Date(instant));
    const get = (type: string) => Number(parts.find((part) => part.type === type)?.value);
    return Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second")) - instant;
  };
  let instant = asUtc - offsetAt(asUtc);
  instant = asUtc - offsetAt(instant);
  return new Date(instant).toISOString();
}

/** "dd/mm/aaaa[ ...]" as "YYYY-MM-DD"; null when it is not a day. */
function dayOf(value: string): string | null {
  const instant = brasiliaInstant(value.trim().slice(0, 10));
  return instant ? `${value.slice(6, 10)}-${value.slice(3, 5)}-${value.slice(0, 2)}` : null;
}

const orNull = (text: string): string | null => (text ? text : null);
const yes = (text: string): boolean | null => (/^sim$/i.test(text) ? true : /^n[aã]o$/i.test(text) ? false : null);

export type ProjudiConfig = {
  baseUrl?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
  /** The pause between two calls. */
  pauseMs?: number;
  /** The clock's wait, for a test. */
  sleep?: (ms: number) => Promise<void>;
};

/** What a lawsuit's data (operation 74) says, without what operations 76 and 77 add. */
function readProceeding(data: XmlElement): CourtProceeding {
  const more = childNamed(data, "outrasInformacoes");
  return {
    number: textOf(data, "numero"),
    unit: orNull(textOf(more, "serventia")),
    className: orNull(textOf(more, "classe")),
    subjects: childrenNamed(childNamed(more, "assuntos"), "assunto")
      .map((subject) => subject.text.replace(/\s+/g, " ").replace(/[\s-]+$/, "").trim())
      .filter(Boolean),
    phase: orNull(textOf(more, "faseProcessual")),
    status: orNull(textOf(more, "status")),
    claimValue: orNull(textOf(more, "valorCausa")),
    distributedOn: dayOf(textOf(more, "dataDistribuicao")),
    finalOn: dayOf(textOf(more, "dataTransitoJulgado")),
    secret: yes(textOf(more, "segredoJustica")) === true,
    lawyers: [],
    responsibles: [],
    pending: [],
  };
}

/** The movements of operation 75, oldest first. One that cannot be read makes the answer not whole. */
function readMovements(answer: XmlElement): CourtMovement[] {
  const listed = childrenNamed(childNamed(childNamed(answer, "mensagem"), "lista"), "Movimentacao");
  const movements = listed.map((movement) => {
    const id = textOf(movement, "IdMovimentacao");
    const at = brasiliaInstant(textOf(movement, "DataRealizacao"));
    const title = textOf(movement, "DescricaoMovimentacao");
    if (!/^\d{1,20}$/.test(id) || !at || !title) throw new ProjudiUnavailableError(null, "movement_unreadable");
    return {
      id,
      at,
      title,
      detail: orNull(textOf(movement, "Complemento")),
      by: orNull(textOf(movement, "NomeUsuarioRealizador")),
    };
  });
  return movements.sort((a, b) => a.at.localeCompare(b.at) || Number(a.id) - Number(b.id));
}

/** An entry of operation 76 read by whatever fields it carries (hearings and conclusions were never seen whole). */
function readEntry(kind: CourtProceeding["pending"][number]["kind"], entry: XmlElement): CourtProceeding["pending"][number] {
  const fields = Object.fromEntries(entry.children.map((child) => [child.name, child.text.replace(/\s+/g, " ").trim()]));
  const first = (...names: string[]) => names.map((name) => fields[name]).find((value) => value) ?? null;
  const dated = Object.values(fields).filter((value) => brasiliaInstant(value));
  const start = first("dataInicio", "dataAgendada", "dataAudiencia", "data", "dataHora") ?? dated[0] ?? null;
  const end = first("dataFim", "dataLimite");
  return {
    kind,
    // "Intimação - <who was intimated>": the kind is kept, never the person's name.
    title: (first("pendenciaTipo", "audienciaTipo", "conclusaoTipo", "tipo", "descricao") ?? entry.name).split(" - ")[0].trim(),
    status: first("status", "situacao"),
    start: start ? brasiliaInstant(start) : null,
    end: end ? brasiliaInstant(end) : null,
  };
}

export class ProjudiTjgoSource implements ProceedingSource {
  readonly name = "projudi";
  private readonly config: ProjudiConfig;
  private last = 0;

  constructor(config: ProjudiConfig = {}) {
    this.config = config;
  }

  covers(cnj: string): boolean {
    return isTjgoNumber(cnj);
  }

  async read(cnj: string): Promise<ProceedingRead> {
    if (!isTjgoNumber(cnj)) return { found: false };
    const data = await this.ask({ PaginaAtual: "2", PosicaoPaginaAtual: "0", a: maskCnj(cnj) });
    const found = childrenNamed(childNamed(data, "processos"), "dadosProcesso").find(
      (candidate) => textOf(candidate, "numero").replace(/\D/g, "") === cnj,
    );
    if (!found) return { found: false };
    const proceeding = readProceeding(found);
    const id = textOf(found, "idProcesso");
    const hash = textOf(found, "hashProcesso");
    // In secret, the tribunal gives no way to its course: nothing of it is public.
    if (proceeding.secret || !/^\d+$/.test(id) || !/^\d+$/.test(hash)) {
      return { found: true, proceeding: { ...proceeding, secret: true }, movements: [] };
    }
    const asked = { a: id, b: hash };
    const moved = await this.ask({ PaginaAtual: "3", ...asked });
    if (textOf(moved, "situacao").toUpperCase() !== "OK") throw new ProjudiRefusedError(textOf(moved, "mensagem"));
    const movements = readMovements(moved);
    const waiting = await this.ask({ PaginaAtual: "4", ...asked });
    const responsible = await this.ask({ PaginaAtual: "6", ...asked });
    return {
      found: true,
      proceeding: {
        ...proceeding,
        pending: [
          ...childrenNamed(childNamed(waiting, "pendencias"), "pendencia").map((entry) => readEntry("pendency", entry)),
          ...(childNamed(waiting, "conclusoes")?.children ?? []).map((entry) => readEntry("conclusion", entry)),
          ...(childNamed(waiting, "audiencias")?.children ?? []).map((entry) => readEntry("hearing", entry)),
        ],
        responsibles: childrenNamed(childNamed(responsible, "responsaveis"), "responsavel").map((person) => ({
          role: textOf(person, "cargo"),
          name: textOf(person, "nome"),
          unit: orNull(textOf(person, "serventia")),
        })),
        lawyers: childrenNamed(childNamed(responsible, "advogados"), "advogado").map((lawyer) => ({
          // The lawyer's name is an element of the same name inside the entry.
          name: textOf(lawyer, "advogado"),
          oab: orNull(textOf(lawyer, "oabMatricula")),
          // Only the side: the party's own name is not kept.
          party: /^Polo (Ativo|Passivo)$/.exec(textOf(lawyer, "parte").split(" - ").at(-1)?.trim() ?? "")?.[0] ?? null,
          receivesNotices: yes(textOf(lawyer, "recebeIntimacao")),
        })),
      },
      movements,
    };
  }

  /** One call, paced, its answer decoded as the tribunal writes it and read whole, or an error. */
  private async ask(query: Record<string, string>): Promise<XmlElement> {
    const pause = this.config.pauseMs ?? 1000;
    const wait = this.last + pause - Date.now();
    if (this.last > 0 && wait > 0) await (this.config.sleep ?? ((ms) => new Promise((done) => setTimeout(done, ms))))(wait);
    this.last = Date.now();
    const url = `${(this.config.baseUrl ?? PROJUDI_TJGO_URL).replace(/\/+$/, "")}?${new URLSearchParams(query)}`;
    let response: Response;
    try {
      response = await (this.config.fetch ?? fetch)(url, { signal: AbortSignal.timeout(this.config.timeoutMs ?? 30_000) });
    } catch {
      throw new ProjudiUnavailableError(null);
    }
    if (!response.ok) throw new ProjudiUnavailableError(response.status);
    let text: string;
    try {
      const bytes = new Uint8Array(await response.arrayBuffer());
      // The encoding the answer declares in its first line decides; then the header's; Latin-1 when neither says.
      const head = new TextDecoder("windows-1252").decode(bytes.subarray(0, 200));
      const declared = /encoding=["']([\w-]+)["']/i.exec(head)?.[1]?.toLowerCase();
      const charset = declared ?? /charset=([\w-]+)/i.exec(response.headers.get("content-type") ?? "")?.[1]?.toLowerCase();
      text = new TextDecoder(charset === "utf-8" ? "utf-8" : "windows-1252").decode(bytes);
    } catch {
      throw new ProjudiUnavailableError(null, "cut");
    }
    let root: XmlElement;
    try {
      root = parseXml(text);
    } catch (error) {
      if (error instanceof XmlError) throw new ProjudiUnavailableError(null, "unreadable");
      throw error;
    }
    if (root.name !== "resposta") throw new ProjudiUnavailableError(null, "unreadable");
    if (textOf(root, "situacao").toUpperCase() === "ERRO") throw new ProjudiRefusedError(textOf(root, "mensagem"));
    return root;
  }
}
