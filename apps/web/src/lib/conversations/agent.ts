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
 * every identifier taken out.
 */

export const CONVERSATION_TASK = "atendimento.conversa";

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

/** The message after a yes: the case's number (marked `{caso}`, the database writes it), the link and the next steps. */
export function caseStepsMessage(input: { passengerName: string; url: string; minors: string[] }): string {
  const name = firstNameOf(input.passengerName) || input.passengerName;
  const others = input.minors.map((minor) => firstNameOf(minor) || minor).filter(Boolean);
  const data =
    others.length === 0
      ? "Preencha os seus dados."
      : `Preencha os seus dados e os ${others.length === 1 ? "de" : "de cada uma das crianças:"} ${others.join(" e ")}.`;
  return [
    `Pronto, ${name}. O escritório abriu o seu caso, número {caso}. Os próximos passos:`,
    `1. Abra o seu link: ${input.url}`,
    `2. ${data}`,
    "3. Envie a foto do documento de identidade, um comprovante de endereço e o cartão de embarque ou o bilhete.",
    "4. Conte o que aconteceu, por texto ou por áudio.",
    "O link é só seu. Se alguém mais viajou com você, me diga aqui.",
  ].join("\n");
}

/** The case opened with no link: the firm sends it. */
export const caseOpenedNoLinkMessage = (passengerName: string): string =>
  `Pronto, ${firstNameOf(passengerName) || passengerName}. O escritório abriu o seu caso, número {caso}. Uma pessoa do escritório vai te enviar o link para os próximos passos.`;

/** A yes the firm keeps to a person. */
export const byPersonMessage = (passengerName: string): string =>
  `Obrigado, ${firstNameOf(passengerName) || passengerName}. Uma pessoa do escritório vai confirmar e te escreve por aqui.`;

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

/** The passenger's messages since ONE's last word: what the turn answers. */
export function lastClientWords(messages: readonly TurnMessage[]): string[] {
  const words: string[] = [];
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.author !== "cliente") break;
    if (message.text.trim()) words.unshift(message.text.trim());
  }
  return words;
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
