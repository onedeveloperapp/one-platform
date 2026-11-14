import type { BriefFacts } from "@/lib/hearings/brief";
import { KIND_WORDS } from "@/lib/hearings/brief";

/**
 * The guide of a hearing for who goes for the firm (migration 0246, the owner's request of 2026-11-13: the lawyer
 * prepared for as many of the hearing's questions as the case allows). Beside the brief's lines (0187), what the case
 * holds of the trip and of the client's account, said as it is (`guideFactLines`), and ONE's reading of it (task
 * `audiencia.preparo`): what the airline will likely allege and how to answer it, what the client may be asked and what
 * the case says, what to ask the client, the points of attention and the settlement. The reading may err and says so;
 * every number in it comes from the case or the market's numbers, never from the model. Pure: plain text, the same on
 * the case and in the e-mail.
 */

export const GUIDE_TASK = "audiencia.preparo";

type AnacRecord = {
  scheduledDeparture?: string | null;
  actualDeparture?: string | null;
  scheduledArrival?: string | null;
  actualArrival?: string | null;
  state?: string | null;
  justification?: string | null;
};

export type GuideLeg = {
  position: number;
  flight: string | null;
  from: string | null;
  to: string | null;
  scheduledDeparture: string | null;
  scheduledArrival: string | null;
  actualDeparture: string | null;
  actualArrival: string | null;
  problemLeg: boolean;
  anac: { status: string; record: AnacRecord | null } | null;
};

type MarketNumbers = {
  decisions: number;
  merits: number;
  successPercent: number | null;
  moral: Record<string, { n: number; medianCents: number | null }>;
  from: string | null;
  to: string | null;
};

export type GuideFacts = {
  legs: GuideLeg[];
  weather: { airport: string; at: string; signs: string[]; metar: string }[];
  airlineCause: string | null;
  suspension: string | null;
  account: string | null;
  claimants: { name: string; birthDate: string | null; cents: number | null; guardian: string | null }[];
  defenseInCase: boolean;
  piece: string | null;
  market: { unit: MarketNumbers | null; court: MarketNumbers | null };
};

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const num = (value: unknown): number | null =>
  value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
const obj = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};

function numbersOf(raw: unknown): MarketNumbers | null {
  const row = obj(raw);
  if (num(row.decisions) === null) return null;
  const moral = Object.fromEntries(
    Object.entries(obj(row.moral)).map(([problem, value]) => {
      const entry = obj(value);
      return [problem, { n: num(entry.n) ?? 0, medianCents: num(entry.median_cents) }];
    }),
  );
  return {
    decisions: num(row.decisions) ?? 0,
    merits: num(row.merits) ?? 0,
    successPercent: num(row.success_percent),
    moral,
    from: text(row.from),
    to: text(row.to),
  };
}

/** What the database answers of a hearing's case (`hearing_guide_facts`); null for none. */
export function guideFactsOf(raw: unknown): GuideFacts | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const list = (value: unknown) => (Array.isArray(value) ? value.map(obj) : []);
  return {
    legs: list(row.legs).map((leg) => {
      const anac = obj(leg.anac);
      const record = obj(anac.record);
      return {
        position: num(leg.position) ?? 0,
        flight: text(leg.flight),
        from: text(leg.from),
        to: text(leg.to),
        scheduledDeparture: text(leg.scheduled_departure),
        scheduledArrival: text(leg.scheduled_arrival),
        actualDeparture: text(leg.actual_departure),
        actualArrival: text(leg.actual_arrival),
        problemLeg: leg.problem_leg === true,
        anac: text(anac.status)
          ? {
              status: String(anac.status),
              record: Object.keys(record).length > 0 ? (record as AnacRecord) : null,
            }
          : null,
      };
    }),
    weather: list(row.weather).flatMap((reading) =>
      text(reading.airport) && text(reading.metar)
        ? [
            {
              airport: String(reading.airport),
              at: text(reading.at) ?? "",
              signs: Array.isArray(reading.signs)
                ? reading.signs.filter((sign): sign is string => typeof sign === "string")
                : [],
              metar: String(reading.metar),
            },
          ]
        : [],
    ),
    airlineCause: text(row.airline_cause),
    suspension: text(row.suspension),
    account: text(row.account),
    claimants: list(row.claimants).flatMap((claimant) =>
      text(claimant.name)
        ? [
            {
              name: String(claimant.name),
              birthDate: text(claimant.birth_date),
              cents: num(claimant.cents),
              guardian: text(claimant.guardian),
            },
          ]
        : [],
    ),
    defenseInCase: row.defense_in_case === true,
    piece: text(row.piece),
    market: { unit: numbersOf(obj(row.market).unit), court: numbersOf(obj(row.market).court) },
  };
}

/** "2099-10-25T02:25" or "2099-10-25 02:25:00" as "25/10 02:25"; the text as it is when it is no moment. */
export function momentWords(value: string | null | undefined): string | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value);
  return match ? `${match[3]}/${match[2]} ${match[4]}:${match[5]}` : value;
}

/** Minutes from a moment to another, both written as the record writes them (one zone); null when either is none. */
function minutesBetween(from: string | null | undefined, to: string | null | undefined): number | null {
  const at = (value: string | null | undefined) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value ?? "");
    return match ? Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5]) / 60000 : null;
  };
  const start = at(from);
  const end = at(to);
  return start === null || end === null ? null : end - start;
}

const durationWords = (minutes: number): string => {
  const hours = Math.floor(Math.abs(minutes) / 60);
  const rest = Math.abs(minutes) % 60;
  const said = [hours ? `${hours} h` : null, rest ? `${rest} min` : null].filter(Boolean).join(" ") || "0 min";
  return minutes < 0 ? `${said} antes do previsto` : `${said} depois do previsto`;
};

const brl = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

/** The airline's stated cause as the case keeps it (0025), in words. */
const CAUSE_WORDS: Record<string, string> = {
  weather: "condições do tempo",
  airport_infrastructure: "infraestrutura do aeroporto",
  authority: "determinação de autoridade",
  pandemic: "pandemia",
  maintenance: "manutenção",
  crew: "tripulação",
  network: "malha aérea",
  overbooking: "excesso de reservas",
  none_given: "nenhuma causa dita",
  other: "outra causa",
};

const PROBLEM_WORDS: Record<string, string> = {
  cancellation: "cancelamento",
  change: "mudança do voo",
  delay: "atraso",
  missed_connection: "conexão perdida",
  overbooking: "embarque negado",
  baggage_lost: "bagagem extraviada",
  baggage_damaged: "bagagem danificada",
  baggage_delayed: "bagagem atrasada",
};

/** One leg, said: the flight, the cities, the times on record and ANAC's word. */
function legLine(leg: GuideLeg): string {
  const head = [leg.flight ?? "Voo sem número", leg.from && leg.to ? `de ${leg.from} para ${leg.to}` : null]
    .filter(Boolean)
    .join(", ");
  const planned = [momentWords(leg.scheduledDeparture), momentWords(leg.scheduledArrival)].filter(Boolean).join(" a ");
  const parts = [`${leg.position}. ${head}${leg.problemLeg ? " (o trecho do problema)" : ""}`];
  if (planned) parts.push(`previsto ${planned}`);
  const record = leg.anac?.record;
  if (leg.anac?.status === "found" && record) {
    if (record.state === "cancelado") {
      parts.push("pela ANAC, cancelado");
    } else {
      const real = [momentWords(record.actualDeparture), momentWords(record.actualArrival)].filter(Boolean).join(" a ");
      const late = minutesBetween(record.scheduledArrival, record.actualArrival);
      parts.push(
        `pela ANAC, realizado ${real || "sem horário"}${late !== null ? `, chegada ${durationWords(late)}` : ""}`,
      );
    }
    if (record.justification) parts.push(`justificativa da companhia na ANAC: ${record.justification}`);
  } else if (leg.anac?.status === "not_published") {
    parts.push("o registro da ANAC deste mês ainda não saiu");
  } else if (leg.anac?.status === "not_found") {
    parts.push("a ANAC não tem este voo neste dia (o que não quer dizer que não voou)");
  } else if (leg.actualArrival) {
    parts.push(`chegada real no cadastro ${momentWords(leg.actualArrival)}`);
  }
  return parts.join("; ") + ".";
}

/** A market's numbers, said with their sample; null when there is nothing worth saying. */
function marketLine(label: string, numbers: MarketNumbers | null, incident: string | null): string | null {
  if (!numbers || numbers.decisions === 0) return null;
  const parts = [`${label}: ${numbers.decisions} decisões lidas`];
  if (numbers.successPercent !== null)
    parts.push(`o passageiro ganhou em ${numbers.successPercent}% das ${numbers.merits} com mérito`);
  const moral = incident ? numbers.moral[incident] : undefined;
  if (moral?.medianCents)
    parts.push(
      `dano moral mediano em ${PROBLEM_WORDS[incident ?? ""] ?? "casos assim"}: ${brl(moral.medianCents)} (${moral.n} decisões)`,
    );
  return parts.join("; ") + ".";
}

/** What the case holds of the trip, the weather, the account and the court, said as it is (no reading of ONE's). */
export function guideFactLines(brief: Pick<BriefFacts, "incident" | "kind">, guide: GuideFacts): string[] {
  const lines: string[] = [];
  if (guide.legs.length > 0) {
    lines.push("", "OS VOOS");
    lines.push(...guide.legs.map(legLine));
  }
  const cause = guide.airlineCause ? (CAUSE_WORDS[guide.airlineCause] ?? guide.airlineCause) : null;
  if (cause || guide.weather.length > 0 || guide.suspension) {
    lines.push("", "A CAUSA E O CLIMA");
    if (cause) lines.push(`A companhia alegou ao passageiro: ${cause}.`);
    for (const reading of guide.weather) {
      lines.push(
        `${reading.airport}, ${momentWords(reading.at) ?? reading.at}: ${reading.signs.length > 0 ? `sinais de ${reading.signs.join(", ")}` : "sem sinal de mau tempo"} (${reading.metar}).`,
      );
    }
    if (guide.suspension) {
      lines.push(
        guide.suspension === "hold"
          ? "Tema 1.417 do STJ: o caso aguarda o julgamento do tema."
          : "Tema 1.417 do STJ: o escritório seguiu com a ação.",
      );
    }
  }
  if (guide.account) {
    lines.push("", "O RELATO DO CLIENTE, EM ORDEM");
    lines.push(...guide.account.split("\n").filter((line) => line.trim()));
  }
  const minors = guide.claimants.filter((claimant) => claimant.guardian);
  if (minors.length > 0) {
    lines.push(
      "",
      `Menores na ação: ${minors.map((claimant) => `${claimant.name}, representado por ${claimant.guardian}`).join("; ")}.`,
    );
  }
  lines.push(
    "",
    guide.defenseInCase
      ? "A contestação da companhia está no caso: leia antes da audiência."
      : "A contestação da companhia ainda não está no caso.",
  );
  const unit = marketLine("A unidade", guide.market.unit, brief.incident);
  const court = marketLine("O tribunal", guide.market.court, brief.incident);
  if (unit || court) {
    lines.push("", "COMO O JUÍZO DECIDE CASOS ASSIM");
    if (unit) lines.push(unit);
    if (court) lines.push(court);
    lines.push("Números das decisões públicas do mercado, para preparar e projetar, nunca para escolher juízo.");
  }
  return lines;
}

/** What the task is handed: the hearing, the case's facts and its piece, with no number the model may make up. */
export function guideInput(brief: BriefFacts, guide: GuideFacts): Record<string, unknown> {
  return {
    audiencia: { tipo: KIND_WORDS[brief.kind] ?? brief.kind, modo: brief.mode, quando: brief.startsAt },
    problema: PROBLEM_WORDS[brief.incident ?? ""] ?? brief.incident,
    companhia: brief.airline,
    quem_pede: guide.claimants.map((claimant) => ({
      nome: claimant.name,
      nascimento: claimant.birthDate,
      pede: claimant.cents ? brl(claimant.cents) : null,
      representado_por: claimant.guardian,
    })),
    voos: guide.legs.map((leg) => ({
      ordem: leg.position,
      voo: leg.flight,
      de: leg.from,
      para: leg.to,
      previsto: { saida: leg.scheduledDeparture, chegada: leg.scheduledArrival },
      no_cadastro: { saida: leg.actualDeparture, chegada: leg.actualArrival },
      trecho_do_problema: leg.problemLeg,
      anac: leg.anac,
    })),
    clima: guide.weather,
    causa_alegada_pela_companhia: guide.airlineCause,
    tema_1417: guide.suspension,
    relato_do_cliente: guide.account,
    fatos_confirmados_pelo_cliente: brief.facts,
    documentos_aceitos: brief.documents,
    contestacao_no_caso: guide.defenseInCase,
    peca: guide.piece,
    acordo: {
      piso_do_escritorio: brief.floorCents ? brl(brief.floorCents) : null,
      unidade: guide.market.unit,
      tribunal: guide.market.court,
    },
  };
}

export type GuideReading = {
  summary: string;
  strengths: { point: string; proof: string }[];
  defenses: { claim: string; answer: string; proof: string }[];
  clientQuestions: { question: string; answer: string }[];
  lawyerQuestions: string[];
  attention: { point: string; how: string }[];
  settlement: string;
};

/** No dash nor exclamation mark in what reaches a person (the copy rules), whatever the model wrote. */
const clean = (value: unknown): string =>
  (typeof value === "string" ? value : "")
    .replace(/\s*[—–]\s*/g, ", ")
    .replace(/!/g, ".")
    .replace(/\s+/g, " ")
    .trim();

/** The task's answer, read; null when it is no answer. */
export function guideReadingOf(raw: unknown): GuideReading | null {
  if (!raw || typeof raw !== "object") return null;
  const row = raw as Record<string, unknown>;
  const list = (value: unknown) => (Array.isArray(value) ? value.map(obj) : []);
  const reading: GuideReading = {
    summary: clean(row.resumo),
    strengths: list(row.pontos_fortes)
      .map((item) => ({ point: clean(item.ponto), proof: clean(item.prova) }))
      .filter((item) => item.point),
    defenses: list(row.alegacoes_da_re)
      .map((item) => ({ claim: clean(item.alegacao), answer: clean(item.resposta), proof: clean(item.prova) }))
      .filter((item) => item.claim),
    clientQuestions: list(row.perguntas_ao_cliente)
      .map((item) => ({ question: clean(item.pergunta), answer: clean(item.resposta_pelo_caso) }))
      .filter((item) => item.question),
    lawyerQuestions: (Array.isArray(row.perguntas_do_advogado) ? row.perguntas_do_advogado : [])
      .map(clean)
      .filter(Boolean),
    attention: list(row.pontos_de_atencao)
      .map((item) => ({ point: clean(item.ponto), how: clean(item.como_tratar) }))
      .filter((item) => item.point),
    settlement: clean(row.acordo),
  };
  return reading.summary || reading.defenses.length > 0 || reading.clientQuestions.length > 0 ? reading : null;
}

/** ONE's reading, said in sections; it opens saying ONE may err. */
export function guideReadingLines(reading: GuideReading): string[] {
  const lines = [
    "",
    "A LEITURA DO ONE PARA A AUDIÊNCIA",
    "O ONE pode errar: confira cada ponto no caso antes da audiência.",
  ];
  if (reading.summary) lines.push(reading.summary);
  const section = (title: string, items: string[]) => {
    if (items.length === 0) return;
    lines.push("", title, ...items.map((item) => `· ${item}`));
  };
  section(
    "PONTOS FORTES",
    reading.strengths.map((item) => (item.proof ? `${item.point} Prova: ${item.proof}` : item.point)),
  );
  section(
    "O QUE A COMPANHIA DEVE ALEGAR, E COMO RESPONDER",
    reading.defenses.map((item) =>
      [item.claim, item.answer ? `Resposta: ${item.answer}` : null, item.proof ? `Prova: ${item.proof}` : null]
        .filter(Boolean)
        .join(" "),
    ),
  );
  section(
    "O QUE PODEM PERGUNTAR AO CLIENTE",
    reading.clientQuestions.map((item) =>
      item.answer ? `${item.question} O caso diz: ${item.answer}` : item.question,
    ),
  );
  section("O QUE PERGUNTAR AO CLIENTE NA INSTRUÇÃO", reading.lawyerQuestions);
  section(
    "PONTOS DE ATENÇÃO",
    reading.attention.map((item) => (item.how ? `${item.point} Como tratar: ${item.how}` : item.point)),
  );
  if (reading.settlement) lines.push("", "PARA O ACORDO", reading.settlement);
  return lines;
}
