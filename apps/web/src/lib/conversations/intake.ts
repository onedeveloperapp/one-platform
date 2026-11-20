import { maskIdentifiers } from "@/lib/cases/drafts";
import type { TurnContext } from "@/lib/conversations/agent";
import {
  isQualificationProblem,
  type NoticeStanding,
  type QualificationInput,
  type QualificationProblem,
} from "@flyee/rules/qualification";

/**
 * Who writes to the firm's WhatsApp with no alert of ONE's and no case (migration 0176, item 2.1 of the case journey
 * plan), as the chat's script of 2026-11-12 has it (migration 0227) with the owner's changes of 2026-11-13 (0239): ONE
 * says who it is and asks first what decides the right, one question at a time, each choice in numbered options (what
 * happened, the day of the flight, when the airline told of a cancellation or a change, when the passenger should have
 * arrived and did), stopping at the first answer that rules it out; it sums up for the person to confirm, and offers to
 * go on with the firm's own words on its fees. Only after their "Quero seguir" does it ask how to call them and who
 * travelled along, and the case opens. The airline and the flight's number come from the documents, never asked. The
 * task `atendimento.entrada` reads what they told; these rules say what is still missing, what a reply chose and what
 * ONE writes. Pure.
 */

export const INTAKE_TASK = "atendimento.entrada";

/**
 * Where an intake stands once nothing of the right is missing: the summary sent, a correction asked, the offer, the
 * doubts, a no, or the person's "Quero seguir" while their name and who travelled along are asked (0239).
 */
export type IntakeStep = "resumo" | "corrigir" | "oferta" | "duvidas" | "recusou" | "seguir";

export type IntakeFacts = {
  problema?: string;
  companhia?: string;
  voo?: string;
  data?: string;
  origem?: string;
  destino?: string;
  atraso_horas?: string;
  /** When the passenger should have arrived at the final destination, and did (`AAAA-MM-DDTHH:MM` or `HH:MM`, 0239). */
  chegada_prevista?: string;
  chegada_real?: string;
  /** For a cancellation or a change: "nao" when the passenger did not travel after it, "sim" when they did (0239). */
  viajou?: string;
  /** How late they arrived, as the question's options have it (the owner, 2026-11-13, 0242): `menos_4` or `mais_4`. */
  atraso_faixa?: string;
  aviso?: string;
  /** How the person is called: the first name is enough, the full name comes from the identity document. */
  nome?: string;
  /** Who referred the person, as they said it (0183). */
  indicado_por?: string;
  /** Who else travelled on the booking, as told ("Pedro, 8 anos"); `nenhum` when nobody; `mais` while names are asked. */
  acompanhantes?: string;
  etapa?: IntakeStep;
  result?: { outcome?: string };
};

/** What the task reads of the conversation. The step is ONE's own, never read. */
const KEYS = [
  "problema",
  "companhia",
  "voo",
  "data",
  "origem",
  "destino",
  "atraso_horas",
  "chegada_prevista",
  "chegada_real",
  "viajou",
  "atraso_faixa",
  "aviso",
  "nome",
  "indicado_por",
  "acompanhantes",
] as const;

const STEPS: readonly IntakeStep[] = ["resumo", "corrigir", "oferta", "duvidas", "recusou", "seguir"];

/** What the task read: whether it is a problem with a flight, and the facts it found. Null for an answer that is not. */
export function intakeReadingOf(
  raw: unknown,
): { flight: boolean; facts: Record<string, string>; question: string | null } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  if (row.assunto !== "problema_voo" && row.assunto !== "outro") return null;
  const facts: Record<string, string> = {};
  for (const key of KEYS) {
    const value = typeof row[key] === "string" ? String(row[key]).trim() : "";
    // A mark of a masked identifier is never a fact of the passenger's.
    if (value && !/\[[a-z]+ \d+\]/i.test(value)) facts[key] = value;
  }
  // The doubt the person asked in their last message (0249), ONE's to answer before going on; never a fact.
  const question = typeof row.pergunta === "string" ? row.pergunta.trim().slice(0, 300) : "";
  return { flight: row.assunto === "problema_voo", facts, question: question || null };
}

/** The facts as the database keeps them. */
export function intakeFactsOf(raw: unknown): IntakeFacts {
  if (typeof raw !== "object" || raw === null) return {};
  const row = raw as Record<string, unknown>;
  const facts: IntakeFacts = {};
  for (const key of KEYS) if (typeof row[key] === "string" && row[key]) facts[key] = String(row[key]);
  const step = STEPS.find((item) => item === row.etapa);
  if (step) facts.etapa = step;
  if (row.result && typeof row.result === "object") facts.result = row.result as { outcome?: string };
  return facts;
}

export type IntakeAsk =
  | "problema"
  | "data"
  | "aviso"
  | "chegada"
  | "chegada_prevista"
  | "chegada_real"
  | "nome"
  | "acompanhantes"
  | "nomes";

const LATE: readonly string[] = ["delay", "missed_connection"];
const TOLD: readonly string[] = ["cancellation", "change"];

const DATE_TIME = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})$/;
const TIME = /^(\d{1,2}):(\d{2})$/;

/** A moment as the task writes it, in minutes since the epoch; a time alone falls on the flight's day. Null when not one. */
function momentOf(value: string | undefined, day: string | undefined): { minutes: number; dated: boolean } | null {
  const text = (value ?? "").trim();
  const full = DATE_TIME.exec(text);
  const time = full ? null : TIME.exec(text);
  const date = full ? full[1] : day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
  const hour = Number(full ? full[2] : time?.[1]);
  const minute = Number(full ? full[3] : time?.[2]);
  if (!date || (!full && !time) || hour > 23 || minute > 59) return null;
  const [y, m, d] = date.split("-").map(Number);
  return { minutes: Date.UTC(y, m - 1, d, hour, minute) / 60000, dated: Boolean(full) };
}

/** The band of the arrival's question as minutes the rule reads: "more than four hours" is the rule's own 4 hours. */
const BAND_MINUTES: Record<string, number> = { menos_4: 0, mais_4: 240 };

/**
 * How late the passenger arrived at the final destination, in minutes (0239): the two times they told when both are
 * read (an arrival past midnight with no day told falls on the next one), else the band they chose (0242), else the
 * hours of delay they told; null when none is known. Arithmetic only: the rule of qualification decides what it means.
 */
export function arrivalDelayMinutes(facts: IntakeFacts): number | null {
  const scheduled = momentOf(facts.chegada_prevista, facts.data);
  const arrived = momentOf(facts.chegada_real, facts.data);
  if (scheduled && arrived) {
    let late = arrived.minutes - scheduled.minutes;
    if (late < 0 && !arrived.dated) late += 24 * 60;
    return Math.round(late);
  }
  if (facts.atraso_faixa && facts.atraso_faixa in BAND_MINUTES) return BAND_MINUTES[facts.atraso_faixa];
  const hours = facts.atraso_horas ? Number(facts.atraso_horas.replace(",", ".")) : NaN;
  return Number.isFinite(hours) ? Math.round(hours * 60) : null;
}

/** Whether the passenger did not travel after a cancellation or a change: the notice alone decides then (0239). */
const didNotTravel = (facts: IntakeFacts): boolean =>
  Boolean(facts.problema && TOLD.includes(facts.problema)) && facts.viajou === "nao";

/**
 * What the intake still lacks to decide the right, in the order it is asked (0239): what happened, the day of the
 * flight (5 years decide it), when the airline told of a cancellation or a change, and the arrival at the final
 * destination (4 hours decide it). The airline and the flight's number come from the documents.
 */
export function intakeMissing(facts: IntakeFacts): IntakeAsk[] {
  const missing: IntakeAsk[] = [];
  if (!facts.problema) missing.push("problema");
  if (!facts.data) missing.push("data");
  if (facts.problema && TOLD.includes(facts.problema) && !facts.aviso) missing.push("aviso");
  const arrival = facts.problema && (LATE.includes(facts.problema) || TOLD.includes(facts.problema));
  // One question with its options (0242): how late they arrived, or that they did not travel.
  if (arrival && !didNotTravel(facts) && arrivalDelayMinutes(facts) === null) missing.push("chegada");
  return missing;
}

/** What is asked once the person said "Quero seguir" (0239): how to call them, then who travelled along. */
export function intakePersonalMissing(facts: IntakeFacts): IntakeAsk[] {
  const missing: IntakeAsk[] = [];
  if (!facts.nome) missing.push("nome");
  if (!facts.acompanhantes) missing.push("acompanhantes");
  else if (facts.acompanhantes === "mais") missing.push("nomes");
  return missing;
}

/** The next question of an intake: of the right before the "Quero seguir", of the person after it. */
export const intakeNextAsk = (facts: IntakeFacts): IntakeAsk | null =>
  (facts.etapa === "seguir" ? intakePersonalMissing(facts) : facts.etapa ? [] : intakeMissing(facts))[0] ?? null;

// ---------- The options of a question, and what a reply chose ----------

export type IntakeOption = { value: string; label: string; words: readonly string[] };

const PROBLEM_OPTIONS: readonly IntakeOption[] = [
  { value: "cancellation", label: "Foi cancelado", words: ["cancelado", "cancelou", "cancelamento", "cancelaram"] },
  { value: "delay", label: "Atrasou", words: ["atrasou", "atraso", "atrasado"] },
  { value: "missed_connection", label: "Perdi a conexão", words: ["conexao", "perdi a conexao"] },
  { value: "overbooking", label: "Não consegui embarcar", words: ["nao consegui embarcar", "overbooking", "lotado"] },
  { value: "baggage_lost", label: "A bagagem foi extraviada", words: ["extraviada", "extravio", "perderam a mala"] },
  { value: "baggage_damaged", label: "Bagagem danificada", words: ["danificada", "quebrada", "rasgada"] },
  { value: "baggage_delayed", label: "A bagagem chegou depois", words: ["chegou depois", "bagagem atrasou"] },
];

const NOTICE_OPTIONS: readonly IntakeOption[] = [
  { value: "at_airport", label: "No aeroporto", words: ["aeroporto", "no aeroporto", "na hora"] },
  { value: "late", label: "Menos de 72 horas antes", words: ["menos de 72", "menos de 72h"] },
  { value: "early", label: "Com mais antecedência", words: ["mais antecedencia", "antecedencia", "mais de 72"] },
];

/**
 * The options of the arrival's question (the owner, 2026-11-13, 0242): how late they arrived at the final destination,
 * and, after a cancellation or a change, that they did not travel. A reply in words (the times, the hours) is the
 * task's to read.
 */
const ARRIVAL_BANDS: readonly IntakeOption[] = [
  {
    value: "menos_4",
    label: "Menos de quatro horas",
    words: ["menos de quatro horas", "menos de 4 horas", "menos de 4h", "menos de quatro", "menos"],
  },
  {
    value: "mais_4",
    label: "Mais de quatro horas",
    words: ["mais de quatro horas", "mais de 4 horas", "mais de 4h", "mais de quatro", "mais"],
  },
];
const ARRIVAL_OPTIONS: readonly IntakeOption[] = [
  ...ARRIVAL_BANDS,
  {
    value: "nao",
    label: "Não cheguei a viajar",
    words: ["nao cheguei a viajar", "nao viajei", "nao fui", "desisti", "desisti da viagem", "pedi reembolso"],
  },
];

/** The arrival's options for a problem: "Não cheguei a viajar" only after a cancellation or a change. */
export const arrivalOptions = (problem: string | undefined): readonly IntakeOption[] =>
  problem && TOLD.includes(problem) ? ARRIVAL_OPTIONS : ARRIVAL_BANDS;

/** The arrival's question, in the words of each problem (0242). */
const ARRIVAL_QUESTION: Record<string, string> = {
  cancellation: "O cancelamento gerou quanto tempo de atraso até você chegar ao destino final?",
  change: "A mudança do voo gerou quanto tempo de atraso até você chegar ao destino final?",
  delay: "O atraso foi de quanto tempo até você chegar ao destino final?",
  missed_connection: "A conexão perdida gerou quanto tempo de atraso até você chegar ao destino final?",
};

const COMPANION_OPTIONS: readonly IntakeOption[] = [
  { value: "nenhum", label: "Só eu", words: ["so eu", "sozinho", "sozinha", "ninguem", "nao", "viajei sozinho"] },
  { value: "mais", label: "Sim, mais pessoas", words: ["sim", "mais pessoas", "sim mais pessoas"] },
];

/** The options of each step, and of the questions that offer them. */
export const OPTIONS = {
  problema: PROBLEM_OPTIONS,
  aviso: NOTICE_OPTIONS,
  chegada: ARRIVAL_OPTIONS,
  acompanhantes: COMPANION_OPTIONS,
  resumo: [
    { value: "certo", label: "Está certo", words: ["sim", "certo", "isso", "correto", "esta certo", "ok", "confere"] },
    { value: "corrigir", label: "Corrigir", words: ["corrigir", "nao", "errado", "esta errado"] },
  ],
  oferta: [
    {
      value: "seguir",
      label: "Quero seguir",
      words: ["quero seguir", "quero", "sim", "seguir", "pode seguir", "aceito"],
    },
    { value: "duvidas", label: "Tenho dúvidas", words: ["tenho duvidas", "duvida", "duvidas"] },
    { value: "agora_nao", label: "Agora não", words: ["agora nao", "nao", "nao quero"] },
  ],
  duvidas: [
    {
      value: "seguir",
      label: "Quero seguir",
      words: ["quero seguir", "quero", "sim", "seguir", "pode seguir", "aceito"],
    },
    {
      value: "pessoa",
      label: "Falar com uma pessoa",
      words: ["falar com uma pessoa", "pessoa", "atendente", "humano"],
    },
    { value: "agora_nao", label: "Agora não", words: ["agora nao", "nao", "nao quero"] },
  ],
} satisfies Record<string, readonly IntakeOption[]>;

/** A text as a reply is compared: lower case, no accent, no punctuation, one space. */
const plain = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The option a reply chose: its number ("2", "2."), its label, or one of its words said alone or in a short reply
 * ("foi cancelado sim"). Null when the reply says something else, which the task reads then.
 */
export function choiceOf(options: readonly IntakeOption[], reply: string): string | null {
  const said = plain(reply);
  if (!said) return null;
  const number = /^(?:opcao )?(\d{1,2})$/.exec(said);
  if (number) return options[Number(number[1]) - 1]?.value ?? null;
  const exact = options.find((option) => plain(option.label) === said || option.words.includes(said));
  if (exact) return exact.value;
  if (said.split(" ").length > 5) return null;
  const found = options.filter((option) =>
    option.words.some((word) => word.includes(" ") && ` ${said} `.includes(` ${word} `)),
  );
  return found.length === 1 ? found[0].value : null;
}

/** The options as the message lists them, one numbered line each. */
export const optionsText = (options: readonly IntakeOption[]): string =>
  options.map((option, index) => `${index + 1}. ${option.label}`).join("\n");

// ---------- What ONE writes ----------

/**
 * The first word of an intake, before its first question: who speaks, for what, how long. Who ONE already greeted
 * (0257) is not told again who speaks.
 */
export const intakeOpening = (firm: string, greeted = false): string =>
  `${greeted ? "" : `Oi, aqui é o assistente virtual ${firm.trim() ? `do escritório ${firm.trim()}` : "do escritório"}. `}Vou te ajudar a ver se o escritório pode cuidar do seu caso. São poucas perguntas, uns 2 minutos.`;

/** A word of care for each problem, said once, when it is first told. */
const CARE: Record<string, string> = {
  cancellation: "Sinto muito pelo cancelamento",
  change: "Sinto muito pela mudança do voo",
  delay: "Sinto muito pelo atraso",
  missed_connection: "Sinto muito pela conexão perdida",
  overbooking: "Sinto muito pelo embarque negado",
  baggage_lost: "Sinto muito pela bagagem extraviada",
  baggage_damaged: "Sinto muito pela bagagem danificada",
  baggage_delayed: "Sinto muito pela demora da bagagem",
  downgrade: "Sinto muito pelo que aconteceu",
  other: "Sinto muito pelo que aconteceu",
};

const first = (name: string | undefined): string => (name ?? "").trim().split(/\s+/)[0] ?? "";

/** What ONE says before its question when the reply brought the name or the problem: thanks, or care, once. */
export function intakeLead(before: IntakeFacts, after: IntakeFacts): string | null {
  const name = !before.nome && after.nome ? first(after.nome) : null;
  const care = !before.problema && after.problema ? (CARE[after.problema] ?? CARE.other) : null;
  if (care && name) return `${care}, ${name}.`;
  if (care) return `${care}.`;
  if (name) return `Obrigado, ${name}.`;
  return null;
}

/** The question of what is missing, with its options. */
export function questionText(ask: IntakeAsk, facts: IntakeFacts = {}): string {
  // After a cancellation or a change the passenger may not have travelled at all: the notice decides then (0239).
  const notTravelled =
    facts.problema && TOLD.includes(facts.problema) ? `\n${optionsText(OPTIONS.chegada.slice(2))}` : "";
  switch (ask) {
    case "nome":
      return "Como posso te chamar?";
    case "problema":
      return `O que aconteceu com o voo?\n${optionsText(OPTIONS.problema)}`;
    case "data":
      return "Em que dia era o voo?";
    case "chegada":
      return `${ARRIVAL_QUESTION[facts.problema ?? ""] ?? ARRIVAL_QUESTION.delay}\n${optionsText(arrivalOptions(facts.problema))}`;
    case "chegada_prevista":
      return "E a que horas você deveria chegar ao destino final?";
    case "chegada_real":
      return `E a que horas você chegou ao destino final? Se foi em outro dia, diga o dia também.${notTravelled}`;
    case "aviso":
      return `Quando a companhia avisou ${facts.problema === "change" ? "da mudança" : "do cancelamento"}?\n${optionsText(OPTIONS.aviso)}`;
    case "acompanhantes":
      return `Mais alguém viajou com você nessa reserva?\n${optionsText(OPTIONS.acompanhantes)}`;
    case "nomes":
      return "Diga o nome de cada pessoa que viajou com você. Se for criança ou adolescente, diga também a idade.";
  }
}

/** ONE's message of a turn that asks: the opening on the first, the thanks or care the reply earned, the question. */
export function intakeQuestion(input: {
  ask: IntakeAsk;
  first: boolean;
  firm: string;
  before: IntakeFacts;
  after: IntakeFacts;
  /** ONE already greeted the person (0257). */
  greeted?: boolean;
}): string {
  const lead = intakeLead(input.before, input.after);
  return [input.first ? intakeOpening(input.firm, input.greeted) : null, lead, questionText(input.ask, input.after)]
    .filter(Boolean)
    .join(" ")
    .replace(/ \n/g, "\n");
}

/** What the summary names: the airline and the two cities as the platform's tables have them, null when unknown. */
export type IntakeNames = {
  airline: string | null;
  origin: string | null;
  destination: string | null;
  /** The airline's code, when the platform's table knows it (0249: the market's forecast reads it). */
  airlineIata?: string | null;
};

const dayWords = (day: string | undefined): string | null => {
  if (!day || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const [y, m, d] = day.split("-");
  return `${d}/${m}/${y}`;
};

const NOTICE_WORDS: Record<string, string> = {
  at_airport: "com aviso só no aeroporto",
  late: "com aviso menos de 72 horas antes",
  early: "com aviso 72 horas ou mais antes",
};

/** How late the passenger arrived, in the summary's words ("6 horas", "4 horas e 30 minutos"). */
function lateWords(minutes: number): string {
  if (minutes <= 0) return "no horário previsto ou antes";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const h = hours === 1 ? "1 hora" : `${hours} horas`;
  const m = rest === 1 ? "1 minuto" : `${rest} minutos`;
  const said = hours === 0 ? m : rest === 0 ? h : `${h} e ${m}`;
  return `${said} depois do previsto`;
}

/** The arrival at the final destination, in the summary's words; null when not known. */
function arrivalWords(facts: IntakeFacts): string | null {
  if (didNotTravel(facts)) return "e você não chegou a viajar";
  // The band chosen, in its own words, when no time was told (0242).
  if (!(momentOf(facts.chegada_prevista, facts.data) && momentOf(facts.chegada_real, facts.data))) {
    if (facts.atraso_faixa === "mais_4")
      return "e você chegou ao destino final mais de quatro horas depois do previsto";
    if (facts.atraso_faixa === "menos_4")
      return "e você chegou ao destino final menos de quatro horas depois do previsto";
  }
  const late = arrivalDelayMinutes(facts);
  return late === null ? null : `e você chegou ao destino final ${lateWords(late)}`;
}

/** What happened, in the summary's words. */
function eventWords(facts: IntakeFacts): string {
  const notice = facts.aviso ? NOTICE_WORDS[facts.aviso] : null;
  const arrival = arrivalWords(facts);
  const joined = (...parts: (string | null)[]) => parts.filter(Boolean).join(", ").replace(/, e /g, " e ");
  switch (facts.problema) {
    case "cancellation":
      return joined("cancelado", notice, arrival);
    case "change":
      return joined("mudado pela companhia", notice, arrival);
    case "delay":
      return joined("atrasou", arrival);
    case "missed_connection":
      return joined("conexão perdida", arrival);
    case "overbooking":
      return "embarque negado";
    case "baggage_lost":
      return "bagagem extraviada";
    case "baggage_damaged":
      return "bagagem danificada";
    case "baggage_delayed":
      return "bagagem entregue depois";
    case "downgrade":
      return "mudança para uma classe pior";
    default:
      return "outro problema";
  }
}

/**
 * The summary ONE asks the person to confirm before the rule decides: what decides the right, with the airline, the
 * flight and the cities only when the person told them (the documents bring them later, 0239).
 */
export function intakeSummary(facts: IntakeFacts, names: IntakeNames): string {
  const flight = [
    facts.voo ? `Voo ${facts.voo.toUpperCase()}` : "Voo",
    names.airline ? ` da ${names.airline}` : "",
    names.origin && names.destination ? `, de ${names.origin} para ${names.destination}` : "",
  ].join("");
  const day = dayWords(facts.data);
  // With nothing of the flight told, it is "O seu voo de 22/10/2099"; with the airline or the cities, ", em" the day.
  const told = flight !== "Voo";
  const when = day ? (told ? `, em ${day}` : ` de ${day}`) : "";
  const lines = [
    "Confere o que eu entendi.",
    `${told ? flight : "O seu voo"}${when}: ${eventWords(facts)}.`,
    "Está certo?",
  ];
  return `${lines.join(" ")}\n${optionsText(OPTIONS.resumo)}`;
}

/** What ONE asks after "Corrigir". */
export const CORRECTION_QUESTION = "O que está errado? Pode escrever do seu jeito.";

/**
 * The offer once the rule qualifies the problem: what the firm may do, the firm's own words on its fees when it wrote
 * them, and the question. ONE never promises a result, a value or a time.
 */
export function intakeOffer(input: { airline: string | null; fees: string | null }): string {
  const against = input.airline ? `contra a ${input.airline}` : "contra a companhia aérea";
  return [
    `Pelo que você contou, o escritório pode entrar com uma ação ${against} por você.`,
    input.fees?.trim() || null,
    "Quer que o escritório siga com o seu caso?",
  ]
    .filter(Boolean)
    .join(" ")
    .concat(`\n${optionsText(OPTIONS.oferta)}`);
}

/** The firm's answers to the common doubts, and the question again, now with a person one choice away. */
export const intakeDoubts = (faq: string): string =>
  `${faq.trim()}\n\nQuer seguir com o seu caso?\n${optionsText(OPTIONS.duvidas)}`;

/**
 * The follow-up of a lead who stopped answering (migration 0207): the question still missing, said again, opened
 * with a word that does not press. Null when nothing is missing (the intake is the database's to decide then).
 */
export function leadFollowupText(facts: IntakeFacts, count: number): string | null {
  const ask = intakeNextAsk(facts);
  if (!ask) return null;
  const opening =
    count === 0
      ? "Oi, ainda posso te ajudar com o que aconteceu no seu voo."
      : "Sigo por aqui, se quiser continuar a avaliação do seu caso. Se preferir não receber mais mensagens, responda SAIR.";
  return `${opening} ${questionText(ask, facts)}`;
}

/** What the rule of qualification reads of an intake (`qualificacao-v2`). */
export function intakeQualificationInput(facts: IntakeFacts, today: string): QualificationInput {
  const problem: QualificationProblem = isQualificationProblem(facts.problema) ? facts.problema : "other";
  const notice = (["at_airport", "late", "early"] as const).includes(facts.aviso as NoticeStanding)
    ? (facts.aviso as NoticeStanding)
    : null;
  return {
    problem,
    flightDay: facts.data && /^\d{4}-\d{2}-\d{2}$/.test(facts.data) ? facts.data : null,
    today,
    international: null,
    arrivalDelayMinutes: arrivalDelayMinutes(facts),
    travelled: facts.viajou === "nao" ? false : facts.viajou === "sim" ? true : null,
    notice,
  };
}

/** What the task is handed: the conversation, with every identifier taken out, the facts so far and today. */
export function intakeInput(context: TurnContext, facts: IntakeFacts, today: string): Record<string, unknown> {
  const known = Object.fromEntries(Object.entries(facts).filter(([key]) => key !== "result" && key !== "etapa"));
  return {
    escritorio: context.firm,
    hoje: today,
    fatos_anotados: known,
    mensagens: context.messages.map((message) => ({
      quem: message.author,
      tipo: message.kind,
      texto: maskIdentifiers(message.text).slice(0, 2000),
    })),
  };
}

/** Who travelled along, as the intake keeps it ("Pedro, 8 anos; Ana"): each name, and the age when told. */
export type Companion = { name: string; age: number | null };

/** The companions told in the intake, one per part; nobody for "nenhum" or while names are still asked. */
export function companionsOf(told: string | undefined): Companion[] {
  if (!told || told === "nenhum" || told === "mais") return [];
  return told
    .split(/;|\n|\s+e\s+(?=\p{Lu})/u)
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part): Companion[] => {
      const age = /(\d{1,2})\s*(?:anos?|a)\b/i.exec(part);
      const name = part
        .replace(/,?\s*(?:de\s+)?\d{1,2}\s*(?:anos?|a)\b.*$/i, "")
        .replace(/[,.]+$/, "")
        .trim();
      return name.length >= 2 && /\p{L}/u.test(name) ? [{ name, age: age ? Number(age[1]) : null }] : [];
    });
}

/** A companion under 18: the case takes them in as a claimant the passenger answers for. */
export const isChild = (companion: Companion): boolean => companion.age !== null && companion.age < 18;
