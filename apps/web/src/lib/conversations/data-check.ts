import { choiceOf, type IntakeOption, optionsText } from "@/lib/conversations/intake";
import { isValidCpf, onlyDigits } from "@flyee/fields";

/**
 * The client checks their data in the chat (migration 0232, the chat's script of 2026-11-12): what ONE read in their
 * identity and proof of address, in one message, to confirm or correct; then, one at a time, what the papers need and
 * no document gives. Pure: the database says what the record has (`conversation_person`) and keeps where the
 * conversation stands (`wa_conversations.chat_step`); these rules write the messages and read the answers.
 */

export type DataStep =
  | "dados"
  | "campo"
  | "valor"
  | "cep"
  | "numero"
  | "nacionalidade"
  | "nacionalidade_outra"
  | "estado_civil"
  | "profissao";

const STEPS: readonly DataStep[] = [
  "dados",
  "campo",
  "valor",
  "cep",
  "numero",
  "nacionalidade",
  "nacionalidade_outra",
  "estado_civil",
  "profissao",
];

export type CorrectableField = "full_name" | "cpf" | "birth_date";

export type PersonData = {
  caseId: string;
  personId: string;
  fullName: string;
  cpf: string | null;
  birthDate: string | null;
  minor: boolean;
  nationality: string | null;
  maritalStatus: string | null;
  profession: string | null;
  postalCode: string | null;
  street: string | null;
  addressNumber: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  uf: string | null;
  documentsIn: boolean;
  checked: boolean;
  step: DataStep | null;
  field: CorrectableField | null;
};

const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/** The database's answer, or null when the conversation gathers no case. */
export function personDataOf(raw: unknown): PersonData | null {
  if (typeof raw !== "object" || raw === null) return null;
  const row = raw as Record<string, unknown>;
  if (!text(row.case_id) || !text(row.person_id)) return null;
  const step = (row.step && typeof row.step === "object" ? row.step : {}) as Record<string, unknown>;
  const field = ["full_name", "cpf", "birth_date"].find((item) => item === step.field) as CorrectableField | undefined;
  return {
    caseId: String(row.case_id),
    personId: String(row.person_id),
    fullName: text(row.full_name) ?? "",
    cpf: text(row.cpf),
    birthDate: text(row.birth_date),
    minor: row.minor === true,
    nationality: text(row.nationality),
    maritalStatus: text(row.marital_status),
    profession: text(row.profession),
    postalCode: text(row.postal_code),
    street: text(row.street),
    addressNumber: text(row.address_number),
    complement: text(row.complement),
    district: text(row.district),
    city: text(row.city),
    uf: text(row.uf),
    documentsIn: row.documents_in === true,
    checked: row.checked === true,
    step: STEPS.find((item) => item === step.step) ?? null,
    field: field ?? null,
  };
}

const first = (name: string): string => name.trim().split(/\s+/)[0] ?? "";

const cpfWords = (cpf: string): string => {
  const digits = onlyDigits(cpf);
  return digits.length === 11
    ? `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`
    : cpf;
};

const dayWords = (day: string): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(day);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : day;
};

/** The address as one line, from what the record has. */
export function addressWords(data: PersonData): string | null {
  const street = [data.street, data.addressNumber].filter(Boolean).join(", ");
  const place = data.city ? `${data.city}${data.uf ? ` (${data.uf})` : ""}` : null;
  const cep =
    data.postalCode && /^\d{8}$/.test(data.postalCode)
      ? `CEP ${data.postalCode.slice(0, 5)}-${data.postalCode.slice(5)}`
      : null;
  const parts = [street || null, data.complement, data.district, place, cep].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

export const DATA_OPTIONS: readonly IntakeOption[] = [
  {
    value: "certo",
    label: "Está tudo certo",
    words: ["sim", "certo", "esta certo", "tudo certo", "ok", "confere", "correto"],
  },
  { value: "corrigir", label: "Corrigir algo", words: ["corrigir", "nao", "errado", "tem erro", "esta errado"] },
];

export const FIELD_OPTIONS: readonly IntakeOption[] = [
  { value: "full_name", label: "Nome", words: ["nome", "o nome"] },
  { value: "cpf", label: "CPF", words: ["cpf", "o cpf"] },
  { value: "birth_date", label: "Data de nascimento", words: ["nascimento", "data de nascimento", "data"] },
  { value: "address", label: "Endereço", words: ["endereco", "o endereco", "cep"] },
];

export const NATIONALITY_OPTIONS: readonly IntakeOption[] = [
  { value: "brasileira", label: "Brasileira", words: ["brasileira", "brasileiro", "brasil", "sim"] },
  { value: "outra", label: "Outra", words: ["outra", "estrangeira", "estrangeiro"] },
];

export const MARITAL_OPTIONS: readonly IntakeOption[] = [
  { value: "solteiro", label: "Solteiro(a)", words: ["solteiro", "solteira", "solteiro a"] },
  { value: "casado", label: "Casado(a)", words: ["casado", "casada", "casado a"] },
  { value: "uniao_estavel", label: "União estável", words: ["uniao estavel", "uniao", "junto"] },
  { value: "divorciado", label: "Divorciado(a)", words: ["divorciado", "divorciada", "divorciado a"] },
  { value: "separado", label: "Separado(a)", words: ["separado", "separada", "separado a"] },
  { value: "viuvo", label: "Viúvo(a)", words: ["viuvo", "viuva", "viuvo a"] },
];

/** The data ONE read, in one message, for the client to confirm or correct. */
export function dataSummary(data: PersonData): string {
  const lines = [`Confira os seus dados, ${first(data.fullName)}, que li nos documentos:`, `Nome: ${data.fullName}`];
  if (data.cpf) lines.push(`CPF: ${cpfWords(data.cpf)}`);
  if (data.birthDate) lines.push(`Nascimento: ${dayWords(data.birthDate)}`);
  const address = addressWords(data);
  if (address) lines.push(`Endereço: ${address}`);
  return `${lines.join("\n")}\n${optionsText(DATA_OPTIONS)}`;
}

export const FIELD_QUESTION = `Qual dado está errado?\n${optionsText(FIELD_OPTIONS)}`;

const FIELD_ASK: Record<CorrectableField, string> = {
  full_name: "Escreva o seu nome completo, como está no documento.",
  cpf: "Escreva o seu CPF.",
  birth_date: "Escreva a sua data de nascimento, como 14/03/1990.",
};

export const valueQuestion = (field: CorrectableField): string => FIELD_ASK[field];

export const CEP_QUESTION = "Qual é o CEP do seu endereço?";
export const NUMBER_QUESTION = "Qual é o número? Se tiver complemento, como apartamento ou bloco, escreva junto.";
export const CEP_NOT_FOUND = "Não achei esse CEP. Confira e mande de novo, só os 8 números.";

/** A value the client wrote for a field, read and checked; or why it does not serve. */
export function readValue(
  field: CorrectableField,
  reply: string,
): { ok: true; value: string } | { ok: false; why: string } {
  const said = reply.trim();
  if (field === "cpf") {
    const digits = onlyDigits(said);
    return digits.length === 11 && isValidCpf(digits)
      ? { ok: true, value: digits }
      : { ok: false, why: "Esse CPF não confere. Escreva os 11 números de novo, por favor." };
  }
  if (field === "birth_date") {
    const match = /^(\d{1,2})[/.\-\s](\d{1,2})[/.\-\s](\d{4})$/.exec(said);
    if (match) {
      const [day, month, year] = [Number(match[1]), Number(match[2]), Number(match[3])];
      const date = new Date(Date.UTC(year, month - 1, day));
      if (
        date.getUTCFullYear() === year &&
        date.getUTCMonth() === month - 1 &&
        date.getUTCDate() === day &&
        year > 1900
      ) {
        return { ok: true, value: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` };
      }
    }
    return { ok: false, why: "Não entendi a data. Escreva como 14/03/1990, por favor." };
  }
  const name = said.replace(/\s+/g, " ");
  return name.length >= 3 && name.length <= 200 && /\p{L}/u.test(name) && name.includes(" ")
    ? { ok: true, value: name }
    : { ok: false, why: "Escreva o nome completo, com o sobrenome, por favor." };
}

/** The CEP a reply gives, its 8 numbers; null when it does not. */
export function cepOf(reply: string): string | null {
  const digits = onlyDigits(reply);
  return digits.length === 8 ? digits : null;
}

/** The number and the complement of an address, from one reply ("120, apto 31", "s/n"). */
export function numberOf(reply: string): { number: string; complement: string | null } | null {
  const said = reply.trim().replace(/\s+/g, " ");
  if (!said) return null;
  const match = /^(s\/?n|sem n[uú]mero|\d+[A-Za-z]?)\b[\s,.-]*(.*)$/i.exec(said);
  if (!match) return null;
  const number = /^s/i.test(match[1]) ? "S/N" : match[1];
  const complement = match[2].trim().slice(0, 120) || null;
  return { number, complement };
}

const NATIONALITY_QUESTION = `Qual é a sua nacionalidade?\n${optionsText(NATIONALITY_OPTIONS)}`;
const MARITAL_QUESTION = `Qual é o seu estado civil?\n${optionsText(MARITAL_OPTIONS)}`;
const PROFESSION_QUESTION = "Qual é a sua profissão?";

/** What the papers still need of the client that no document gives, the next one to ask; null when none. */
export function missingAsk(data: PersonData): { step: DataStep; question: string } | null {
  if (data.minor) return null;
  if (!data.nationality) return { step: "nacionalidade", question: NATIONALITY_QUESTION };
  if (!data.maritalStatus) return { step: "estado_civil", question: MARITAL_QUESTION };
  if (!data.profession) return { step: "profissao", question: PROFESSION_QUESTION };
  return null;
}

export const OTHER_NATIONALITY_QUESTION = "Qual é a sua nacionalidade?";

/**
 * The question a check of data left open, asked again (the owner's test of 2026-11-23): a turn that finds the check
 * waiting for an answer repeats its question, never the word that the link to sign comes, since the papers wait for
 * that answer and its message may never have reached the client. Null when no check waits.
 */
export function openDataAsk(data: PersonData): string | null {
  if (data.checked || data.minor) return null;
  switch (data.step) {
    case "dados":
      return dataSummary(data);
    case "campo":
      return FIELD_QUESTION;
    case "valor":
      return data.field ? valueQuestion(data.field) : dataSummary(data);
    case "cep":
      return CEP_QUESTION;
    case "numero":
      return NUMBER_QUESTION;
    case "nacionalidade":
      return NATIONALITY_QUESTION;
    case "nacionalidade_outra":
      return OTHER_NATIONALITY_QUESTION;
    case "estado_civil":
      return MARITAL_QUESTION;
    case "profissao":
      return PROFESSION_QUESTION;
    default:
      return null;
  }
}

/** What ONE says once the data is checked and complete. */
export const dataDone = (fullName: string): string => `Obrigado, ${first(fullName)}. Os seus dados estão completos.`;

/** The client's choice among the options of a step; null when the reply is something else. */
export const choose = (options: readonly IntakeOption[], reply: string): string | null => choiceOf(options, reply);
