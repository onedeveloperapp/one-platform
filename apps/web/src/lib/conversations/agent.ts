import { firstNameOf } from "@/lib/cases/cases";
import { maskIdentifiers } from "@/lib/cases/drafts";

/**
 * ONE in a conversation of the firm's WhatsApp (migration 0048): the pure
 * rules of a turn. What the passenger answered to ONE's first word is read
 * here when it is one of the answers the message offers (SIM, NÃO, SAIR,
 * however it is typed); anything else is the model's to read. The messages
 * ONE writes by itself (the next steps after a yes, the end of a no) are
 * these words, never a model's; a model's answer is cleaned to the firm's
 * rules of copy before it goes. What the model reads of the conversation has
 * every identifier taken out. A file the passenger sends (0050) joins their
 * case: what paper it is, read by a task that decides nothing, and ONE's words
 * of what became of it, are here too.
 */

export const CONVERSATION_TASK = "atendimento.conversa";

/** The task that says what paper a file of the conversation is (0050). It decides nothing: the check does. */
export const FILE_KIND_TASK = "atendimento.arquivo.tipo";

export type QuickAnswer = "yes" | "no" | "stop";

/** A text as an answer is compared: lower case, no accent, no punctuation, one space. */
const plain = (text: string): string =>
  text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

const YES = new Set(["sim", "s", "quero", "sim quero", "pode", "pode sim", "sim pode", "ok", "aceito", "quero sim"]);
const NO = new Set(["nao", "n", "nao quero", "nao obrigado", "nao obrigada", "agora nao"]);
const STOP = new Set(["sair", "parar", "pare", "stop", "cancelar", "descadastrar"]);

/** The answer a passenger gave to the alert, when it is plainly one of the three; null for anything else. */
export function quickAnswer(text: string | null | undefined): QuickAnswer | null {
  const said = plain(String(text ?? ""));
  if (!said) return null;
  if (STOP.has(said)) return "stop";
  if (YES.has(said)) return "yes";
  if (NO.has(said)) return "no";
  return null;
}

/**
 * The message after a yes: the link and the next steps (no case number since 0227: it says nothing to the client), the documents first: the firm reads each person's data in them (migration 0063), and the passenger
 * confirms what was read and completes the rest. A passenger of a partner agency (0071) sent nothing yet but has
 * it all: the agency's data and documents came with the case, so the steps are to check them, tell what happened
 * and say they finished, which ONE waits for before it goes on.
 */
export function caseStepsMessage(input: {
  passengerName: string;
  url: string;
  minors: string[];
  /** The partner agency whose record came with the case; null for a passenger of the firm's own. */
  agency?: string | null;
  /** ONE sends the power of attorney once the documents are accepted, and asks its questions after it is signed (0181). */
  signFirst?: boolean;
}): string {
  const questions = input.signFirst
    ? "Assine a procuração que vai aparecer no seu link. Depois disso, vou fazer aqui algumas perguntas sobre o que aconteceu, uma de cada vez."
    : "Responda aqui as perguntas que vou fazer agora sobre o que aconteceu, uma de cada vez.";
  const name = firstNameOf(input.passengerName) || input.passengerName;
  const others = input.minors.map((minor) => firstNameOf(minor) || minor).filter(Boolean);
  const list = new Intl.ListFormat("pt-BR", { style: "long", type: "conjunction" });
  if (input.agency) {
    const theirs = others.length === 0 ? "os seus dados" : `os seus dados e os de ${list.format(others)}`;
    return [
      `Pronto, ${name}. O escritório abriu o seu caso com os dados e os documentos que vieram de ${input.agency}. Os próximos passos:`,
      `1. Abra o seu link: ${input.url}`,
      `2. Confira ${theirs} e os documentos que vieram da agência, e corrija o que estiver errado.`,
      `3. ${questions}`,
      "4. Quando estiver tudo certo, avise no fim da página que terminou: o escritório só segue com o seu caso depois disso.",
      "O link é só seu. Se alguém mais viajou com você, me diga aqui.",
    ].join("\n");
  }
  const identities =
    others.length === 0
      ? "a foto do seu documento de identidade"
      : `a foto do documento de identidade de cada um (${list.format(["o seu", ...others.map((other) => `o de ${other}`)])})`;
  const whose = others.length === 0 ? "os seus dados" : `os seus dados e os de ${list.format(others)}`;
  return [
    `Pronto, ${name}. O escritório abriu o seu caso. Os próximos passos:`,
    `1. Abra o seu link: ${input.url}`,
    `2. Envie ${identities}, um comprovante de endereço e o cartão de embarque ou o bilhete.`,
    `3. Confira ${whose}, que o escritório leu nos documentos, e complete o que faltar.`,
    `4. ${questions}`,
    "O link é só seu. Se alguém mais viajou com você, me diga aqui.",
  ].join("\n");
}

/**
 * The case an intake opened at the person's "Quero seguir" (0227): no case number (it says nothing to the client),
 * the documents asked here in the chat, the identity first, and the link only as another place to do the same.
 */
export function intakeOpenedMessage(input: {
  passengerName: string;
  firm: string;
  url: string;
  companions: boolean;
}): string {
  const name = firstNameOf(input.passengerName) || input.passengerName;
  const firm = input.firm.trim() ? `no escritório ${input.firm.trim()}` : "no escritório";
  return [
    `Pronto, ${name}. O seu caso está aberto ${firm}. Agora preciso de alguns documentos, um de cada vez, e você pode mandar as fotos aqui mesmo.`,
    "Primeiro, a foto do seu documento de identidade, RG ou CNH, com a frente e o verso.",
    input.companions ? "Depois vou pedir também os documentos de quem viajou com você." : null,
    `Se preferir uma tela, o seu link mostra o mesmo: ${input.url}. O link é só seu.`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** The case opened with no link: the firm sends it. */
export const caseOpenedNoLinkMessage = (passengerName: string): string =>
  `Pronto, ${firstNameOf(passengerName) || passengerName}. O escritório abriu o seu caso. Uma pessoa do escritório vai te enviar o link para os próximos passos.`;

/** A yes the firm keeps to a person. */
export const byPersonMessage = (passengerName: string): string =>
  `Obrigado, ${firstNameOf(passengerName) || passengerName}. Uma pessoa do escritório vai confirmar e te escreve por aqui.`;

/**
 * A yes to a problem the rule does not qualify (0147): no case is opened, said in the firm's name, with no promise
 * and no advice, and the way to a person kept open.
 */
export const notQualifiedMessage = (passengerName: string): string =>
  `Obrigado por responder, ${firstNameOf(passengerName) || passengerName}. Pelo que vimos deste voo, o escritório não vai abrir um caso agora. Se quiser falar com uma pessoa do escritório, é só escrever aqui.`;

/** The end of a no. */
export const declinedMessage = (passengerName: string): string =>
  `Tudo bem, ${firstNameOf(passengerName) || passengerName}. O escritório não vai seguir com este caso. Se mudar de ideia, é só escrever aqui.`;

/** What ONE says when it calls a person and the model said nothing. */
export const calledMessage = "Uma pessoa do escritório vai continuar esta conversa com você.";

/** What the model answered, read; null when it is not the object the task asks for. */
export type ModelAnswer = {
  intent: "sim" | "nao" | "parar" | "documentos" | "pergunta" | "outra";
  reply: string | null;
  callPerson: string | null;
};

const INTENTS: readonly ModelAnswer["intent"][] = ["sim", "nao", "parar", "documentos", "pergunta", "outra"];

export function modelAnswerOf(output: unknown): ModelAnswer | null {
  if (typeof output !== "object" || output === null) return null;
  const row = output as Record<string, unknown>;
  if (!INTENTS.includes(row.intencao as ModelAnswer["intent"])) return null;
  const reply = typeof row.resposta === "string" && row.resposta.trim() ? row.resposta : null;
  const callPerson =
    typeof row.chamar_pessoa === "string" && row.chamar_pessoa.trim() ? row.chamar_pessoa.trim() : null;
  return { intent: row.intencao as ModelAnswer["intent"], reply, callPerson };
}

/**
 * A model's answer as the firm's copy rules want it: no dash (a comma), no
 * exclamation (a full stop), no emoji, one space, no more than the setting's
 * length. Null when nothing is left.
 */
export function cleanReply(text: string | null | undefined, most = 700): string | null {
  const cleaned = String(text ?? "")
    .replace(/\s*[–—]\s*/g, ", ")
    .replace(/!+/g, ".")
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}]/gu, "")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\.{2,}/g, ".")
    .trim();
  if (!cleaned) return null;
  return cleaned.length > most ? `${cleaned.slice(0, most - 1).trimEnd()}.` : cleaned;
}

/** A message of the conversation as the database hands it to the turn. */
export type TurnMessage = { author: "cliente" | "one" | "escritorio"; kind: string; text: string; at: string };

/** What the turn is about, as the database answers it (`conversation_turn_context`). */
export type TurnContext = {
  orgId: string;
  firm: string;
  contactName: string | null;
  through: string;
  test: boolean;
  answersLastHour: number;
  modes: { replyClient: string; openCaseFromChat: string; sendClientLink: string };
  alert: {
    alertId: string;
    kind: string;
    delayMinutes: number | null;
    passengerName: string;
    companions: { name: string; birthDate: string | null }[];
  } | null;
  cases: { seq: number; status: string; linkSent: boolean; clientFinished: boolean }[];
  messages: TurnMessage[];
};

const text = (value: unknown): string | null => (typeof value === "string" ? value : null);

export function turnContextOf(raw: unknown): TurnContext | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  if (row.ok !== true || !text(row.org_id) || !text(row.through)) return null;
  const modes = (row.modes ?? {}) as Record<string, unknown>;
  const alert = row.alert && typeof row.alert === "object" ? (row.alert as Record<string, unknown>) : null;
  return {
    orgId: String(row.org_id),
    firm: text(row.firm) ?? "",
    contactName: text(row.contact_name),
    through: String(row.through),
    test: row.test === true,
    answersLastHour: typeof row.answers_last_hour === "number" ? row.answers_last_hour : 0,
    modes: {
      replyClient: text(modes.reply_client) ?? "auto",
      openCaseFromChat: text(modes.open_case_from_chat) ?? "auto",
      sendClientLink: text(modes.send_client_link) ?? "auto",
    },
    alert:
      alert && text(alert.alert_id)
        ? {
            alertId: String(alert.alert_id),
            kind: text(alert.kind) ?? "",
            delayMinutes: typeof alert.delay_minutes === "number" ? alert.delay_minutes : null,
            passengerName: text(alert.passenger_name) ?? "",
            companions: (Array.isArray(alert.companions) ? alert.companions : []).flatMap((companion) => {
              const c = (companion ?? {}) as Record<string, unknown>;
              return text(c.name) ? [{ name: String(c.name), birthDate: text(c.birth_date) }] : [];
            }),
          }
        : null,
    cases: (Array.isArray(row.cases) ? row.cases : []).flatMap((item) => {
      const c = (item ?? {}) as Record<string, unknown>;
      return typeof c.seq === "number"
        ? [
            {
              seq: c.seq,
              status: text(c.status) ?? "",
              linkSent: c.link_sent === true,
              clientFinished: c.client_finished === true,
            },
          ]
        : [];
    }),
    messages: (Array.isArray(row.messages) ? row.messages : []).flatMap((item): TurnMessage[] => {
      const m = (item ?? {}) as Record<string, unknown>;
      const author = m.author === "cliente" || m.author === "one" || m.author === "escritorio" ? m.author : null;
      return author ? [{ author, kind: text(m.kind) ?? "text", text: text(m.text) ?? "", at: text(m.at) ?? "" }] : [];
    }),
  };
}

/** The kinds of message that carry a file: they join the case, and their caption is no question to answer. */
const FILE_MESSAGES = new Set(["image", "document", "audio", "video", "sticker"]);

/** The passenger's messages since ONE's last word: what the turn answers. A file is taken apart, as a file. */
export function lastClientWords(messages: readonly TurnMessage[]): string[] {
  const words: string[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.author !== "cliente") break;
    if (FILE_MESSAGES.has(message.kind)) continue;
    if (message.text.trim()) words.unshift(message.text.trim());
  }
  return words;
}

/** The kinds of paper a file of the conversation joins a case as (the kinds of `case_documents`). */
export const PAPER_KINDS = [
  "identity",
  "address_proof",
  "ticket",
  "boarding_pass",
  "receipt",
  "evidence",
  "other",
] as const;
export type PaperKind = (typeof PAPER_KINDS)[number];

const isPaperKind = (value: unknown): value is PaperKind => (PAPER_KINDS as readonly unknown[]).includes(value);

/** What the task said of a file: its kind (`other` for anything it did not say clearly) and the name written on it. */
export function paperOf(output: unknown): { kind: PaperKind; name: string } {
  const answer = (typeof output === "object" && output !== null ? output : {}) as Record<string, unknown>;
  const name = typeof answer.nome === "string" ? answer.nome.replace(/\s+/g, " ").trim().slice(0, 200) : "";
  return { kind: isPaperKind(answer.tipo) ? answer.tipo : "other", name };
}

/** A file of the turn, as the database hands it (`conversation_media_to_join`). */
export type TurnFile = {
  messageId: string;
  /** The kind of message it came in: `image`, `document`, `audio`, `video`. */
  kind: string;
  /** `stored`: in the firm's files, to be read. `failed`: the backend could not bring it. */
  state: "stored" | "failed";
  fileId: string | null;
  storagePath: string | null;
  /** What its bytes say it is. */
  mime: string | null;
  bytes: number | null;
  sha256: string | null;
};

export function turnFilesOf(raw: unknown): TurnFile[] {
  return (Array.isArray(raw) ? raw : []).flatMap((item): TurnFile[] => {
    const row = (item ?? {}) as Record<string, unknown>;
    if (!text(row.message_id)) return [];
    const stored = row.state === "stored" && text(row.file_id) && text(row.storage_path) && text(row.mime);
    return [
      {
        messageId: String(row.message_id),
        kind: text(row.kind) ?? "",
        state: stored ? "stored" : "failed",
        fileId: stored ? String(row.file_id) : null,
        storagePath: stored ? String(row.storage_path) : null,
        mime: stored ? String(row.mime) : null,
        bytes: typeof row.bytes === "number" ? row.bytes : null,
        sha256: text(row.sha256),
      },
    ];
  });
}

/** What a file is to ONE: a paper it reads, the passenger's account (an audio), or one it does not take. */
export function fileRole(file: TurnFile): "paper" | "statement" | "not_taken" | "failed" {
  if (file.state !== "stored" || !file.mime) return "failed";
  if (file.mime.startsWith("audio/")) return "statement";
  if (file.mime.startsWith("image/") || file.mime === "application/pdf") return "paper";
  return "not_taken";
}

/** What became of a file of the turn, for ONE's words of it. */
export type FileOutcome =
  | { kind: "paper"; paper: PaperKind; status: "accepted" | "rejected" | "waiting"; reason: string | null }
  | { kind: "statement" }
  | { kind: "no_case" }
  | { kind: "failed" }
  | { kind: "not_taken" };

/** Each kind of paper as ONE names it in a sentence. */
const PAPER_WORDS: Record<PaperKind, string> = {
  identity: "o documento de identidade",
  address_proof: "o comprovante de endereço",
  ticket: "o bilhete",
  boarding_pass: "o cartão de embarque",
  receipt: "o recibo",
  evidence: "a foto",
  other: "o arquivo",
};

/** ONE's words of one file, as the firm's rules of copy want them. */
export function fileLine(outcome: FileOutcome): string {
  switch (outcome.kind) {
    case "paper": {
      const paper = PAPER_WORDS[outcome.paper];
      if (outcome.status === "accepted") return `Recebi ${paper} e já juntei ao seu caso. Está tudo certo.`;
      if (outcome.status === "rejected") {
        const reason = cleanReply(outcome.reason, 400);
        return reason
          ? `Não deu para aceitar ${paper}. ${reason}`
          : `Não deu para aceitar ${paper}. Envie de novo, por favor.`;
      }
      return `Recebi ${paper} e juntei ao seu caso. O escritório confere e avisa se precisar de outro.`;
    }
    case "statement":
      return "Recebi o seu áudio e juntei ao seu caso como o relato do que aconteceu. Depois você vai ver os fatos em ordem no seu link, para confirmar.";
    case "no_case":
      return "Recebi o arquivo. Ele fica aqui na conversa para o escritório ver.";
    case "not_taken":
      return "Recebi o arquivo, mas ao caso eu junto só fotos, PDFs e áudios. O escritório vai ver o que você mandou.";
    case "failed":
      return "Não consegui receber um arquivo. Envie de novo, por aqui ou pelo link do seu caso.";
  }
}

/** ONE's message of the files of a turn: a line each, in the order they came; null for none. */
export function filesMessage(outcomes: readonly FileOutcome[]): string | null {
  return outcomes.length > 0 ? outcomes.map(fileLine).join("\n") : null;
}

/** Whether a person of the date is a minor on a day (both `YYYY-MM-DD`). */
const minorOn = (birthDate: string | null, today: string): boolean => {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return false;
  const [y, m, d] = birthDate.split("-").map(Number);
  const [ty, tm, td] = today.split("-").map(Number);
  const age = ty - y - (tm < m || (tm === m && td < d) ? 1 : 0);
  return age < 18;
};

/** The children who travel with the passenger, by name. */
export function minorsOf(context: TurnContext, today: string): string[] {
  return (context.alert?.companions ?? [])
    .filter((companion) => minorOn(companion.birthDate, today))
    .map((c) => c.name);
}

/**
 * What the model reads: the firm, the passenger's first name, the alert and
 * the choice it waits for, the cases and their link, and the conversation,
 * each text with every e-mail, CPF, CEP and telephone taken out.
 */
export function modelInput(context: TurnContext): Record<string, unknown> {
  return {
    escritorio: context.firm,
    passageiro: firstNameOf(context.alert?.passengerName || context.contactName || "") || null,
    aviso: context.alert
      ? {
          o_que_aconteceu: context.alert.kind,
          atraso_minutos: context.alert.delayMinutes,
          espera_a_escolha: true,
          viaja_com: context.alert.companions.map((companion) => firstNameOf(companion.name) || companion.name),
        }
      : null,
    casos: context.cases.map((item) => ({
      numero: item.seq,
      etapa: item.status,
      link_enviado: item.linkSent,
      cliente_terminou_o_link: item.clientFinished,
    })),
    mensagens: context.messages.map((message) => ({
      quem: message.author,
      tipo: message.kind,
      texto: maskIdentifiers(message.text).slice(0, 2000),
    })),
  };
}
