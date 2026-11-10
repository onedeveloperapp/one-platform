/**
 * What ONE read of a document a person of the firm sends to start a registration (migration 0085), as a form shows
 * it for the person to confirm: a person of a case (from an identity, a child's birth certificate included, and a
 * proof of address), the legs of a trip (from a ticket, a boarding pass, a screenshot of the booking or a photo of a
 * printed one), a new case (both) and the receipt of a filing (the lawsuit's number and the day). The reading
 * decides nothing: what does not pass the form's own checks (a CPF whose digits do not check, a day that is no day,
 * an airport that is no code) is left out here, for the person to write.
 *
 * Pure: the backend's half is `document-prefill-work.ts`, the browser's the forms.
 */
import type { PersonField } from "@/lib/cases/forms";
import { isValidCpf, onlyDigits } from "@flyee/fields";
import { formatCnj, isValidCnj } from "@flyee/rules/cnj";

/** What a person may send to start a registration, each read by its task. */
export const PREFILL_READINGS = ["identity", "address_proof", "ticket", "filing_receipt", "case_cost"] as const;
export type PrefillReading = (typeof PREFILL_READINGS)[number];

export const DOCUMENT_READING_TASK = "caso.documento.leitura";
export const RECEIPT_READING_TASK = "caso.protocolo.leitura";
export const COST_READING_TASK = "caso.custo.leitura";

export const PREFILL_TASK: Record<PrefillReading, string> = {
  identity: DOCUMENT_READING_TASK,
  address_proof: DOCUMENT_READING_TASK,
  ticket: DOCUMENT_READING_TASK,
  filing_receipt: RECEIPT_READING_TASK,
  case_cost: COST_READING_TASK,
};

/** What the model is told the document was said to be, in its own language. */
export const PREFILL_KIND_FOR_MODEL: Record<PrefillReading, string> = {
  identity:
    "documento de identidade com foto (RG, CNH, passaporte ou outro documento oficial) ou certidão de nascimento de uma criança",
  address_proof: "comprovante de endereço (conta de água, luz, telefone, internet, banco ou contrato de aluguel)",
  ticket:
    "bilhete, cartão de embarque ou confirmação de reserva da passagem aérea, que pode vir como print de tela do aplicativo, do site ou do e-mail, ou como foto do documento impresso",
  filing_receipt: "recibo ou comprovante do protocolo de uma ação no sistema de um tribunal",
  case_cost:
    "comprovante de um custo do processo (guia de custas, recibo, nota fiscal, boleto ou comprovante de pagamento)",
};

/** The briefing the model reads beside the file: only what the document was said to be. */
export const prefillBriefing = (reading: PrefillReading): string =>
  `Tipo de documento que foi dito: ${PREFILL_KIND_FOR_MODEL[reading]}.`;

const UFS = [
  "AC",
  "AL",
  "AM",
  "AP",
  "BA",
  "CE",
  "DF",
  "ES",
  "GO",
  "MA",
  "MG",
  "MS",
  "MT",
  "PA",
  "PB",
  "PE",
  "PI",
  "PR",
  "RJ",
  "RN",
  "RO",
  "RR",
  "RS",
  "SC",
  "SE",
  "SP",
  "TO",
] as const;

type Raw = Record<string, unknown>;
const record = (value: unknown): Raw =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Raw) : {};
const text = (value: unknown, most = 200): string =>
  typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, most) : "";

/** A day of the calendar (`YYYY-MM-DD`), or "". */
function dayOf(value: unknown, notAfter: string | null): string {
  const day = text(value, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return "";
  const date = new Date(`${day}T12:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== day) return "";
  if (day < "1900-01-01" || (notAfter && day > notAfter)) return "";
  return day;
}

/** A local time as a form takes it (`YYYY-MM-DDTHH:MM`), or "". */
function localTimeOf(value: unknown): string {
  const time = text(value, 25).replace(" ", "T").slice(0, 16);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(time)) return "";
  const [hours, minutes] = time.slice(11).split(":").map(Number);
  return dayOf(time.slice(0, 10), null) && hours < 24 && minutes < 60 ? time : "";
}

/** A person of a case as the shared form holds them, and which fields came from the document. */
export type PrefillPerson = { values: Partial<Record<PersonField, string>>; read: PersonField[] };

/** A leg of a trip as the case's form takes it. */
export type PrefillLeg = {
  flight_number: string;
  booking_reference: string;
  origin_iata: string;
  destination_iata: string;
  scheduled_departure_local: string;
  scheduled_arrival_local: string;
};

/** What ONE read of an identity, a proof of address or a trip's document. */
export type DocumentReading = {
  /** The file is the kind it was sent as. */
  matches: boolean;
  legible: boolean;
  /** What the file is, in ONE's words ("RG", "print da reserva"). */
  identified: string;
  nameOnDocument: string;
  /** What the person should know of the document, in a sentence of ONE's. */
  note: string;
  person: PrefillPerson;
  legs: PrefillLeg[];
};

/** A flight as the platform writes it ("LA 3456" is "LA3456"), or "". */
export function flightOf(value: unknown): string {
  const flight = text(value, 20).toUpperCase().replace(/[\s-]/g, "");
  const match = /^([A-Z0-9]{2})0*([1-9][0-9]{0,3})([A-Z]?)$/.exec(flight);
  return match ? `${match[1]}${match[2]}${match[3]}` : "";
}

const airportOf = (value: unknown): string => {
  const code = text(value, 10).toUpperCase();
  return /^[A-Z]{3}$/.test(code) ? code : "";
};

/**
 * The answer of `caso.documento.leitura`, read for a form. `today` bounds a birth date (a reading may take the day
 * of issue for it). A field that does not pass the form's checks is left out, never written as read.
 */
export function documentReadingOf(raw: unknown, today: string): DocumentReading {
  const answer = record(raw);
  const data = record(answer.dados_lidos);
  const values: Partial<Record<PersonField, string>> = {};
  const put = (field: PersonField, value: string) => {
    if (value) values[field] = value;
  };

  const name = text(data.nome_completo);
  put("full_name", name.length >= 3 && /\p{L}/u.test(name) ? name : "");
  const cpf = onlyDigits(text(data.cpf, 20));
  put("cpf", cpf.length === 11 && isValidCpf(cpf) ? cpf : "");
  put("birth_date", dayOf(data.data_nascimento, today));
  put("nationality", text(data.nacionalidade, 60).toLocaleLowerCase("pt-BR"));

  // An address only whole enough to be one: a CEP, the street, the city and the state.
  const postal = onlyDigits(text(data.cep, 20));
  const street = text(data.logradouro);
  const city = text(data.cidade, 120);
  const uf = text(data.uf, 2).toUpperCase();
  if (postal.length === 8 && street && city && (UFS as readonly string[]).includes(uf)) {
    put("postal_code", postal);
    put("street", street);
    put("address_number", text(data.numero, 20));
    put("complement", text(data.complemento, 120));
    put("district", text(data.bairro, 120));
    put("city", city);
    put("uf", uf);
  }

  const legs: PrefillLeg[] = [];
  for (const item of Array.isArray(answer.trechos) ? answer.trechos.slice(0, 8) : []) {
    const leg = record(item);
    const flight = flightOf(leg.voo);
    const origin = airportOf(leg.origem);
    const destination = airportOf(leg.destino);
    if (!flight && !origin && !destination) continue;
    legs.push({
      flight_number: flight,
      booking_reference: text(leg.reserva, 8)
        .toUpperCase()
        .replace(/[^A-Z0-9]/g, ""),
      origin_iata: origin,
      destination_iata: destination,
      scheduled_departure_local: localTimeOf(leg.saida_prevista),
      scheduled_arrival_local: localTimeOf(leg.chegada_prevista),
    });
  }
  legs.sort((a, b) => a.scheduled_departure_local.localeCompare(b.scheduled_departure_local));

  return {
    matches: answer.confere_tipo === "sim",
    legible: answer.legivel === true,
    identified: text(answer.tipo_identificado, 80),
    nameOnDocument: text(answer.nome_no_documento),
    note: text(answer.observacoes, 300),
    person: { values, read: Object.keys(values) as PersonField[] },
    legs,
  };
}

/** A leg the case's form can save as it is: every field it asks for, read. */
export const legComplete = (leg: PrefillLeg): boolean =>
  Boolean(
    leg.flight_number &&
      leg.origin_iata &&
      leg.destination_iata &&
      leg.scheduled_departure_local &&
      leg.scheduled_arrival_local,
  );

/** What a new case takes from its documents: the airline of the first flight, and its day. */
export function caseFactsOf(
  reading: DocumentReading | null,
  airlines: readonly { iata: string }[],
): { airline: string; flightDate: string } {
  const first = reading?.legs.find((leg) => leg.flight_number || leg.scheduled_departure_local) ?? null;
  const code = first?.flight_number.slice(0, 2) ?? "";
  return {
    airline: airlines.some((airline) => airline.iata === code) ? code : "",
    flightDate: first?.scheduled_departure_local.slice(0, 10) ?? "",
  };
}

/** What ONE read of a filing's receipt. */
export type ReceiptReading = {
  matches: boolean;
  legible: boolean;
  /** The lawsuit's number, written as the CNJ writes it, only when its check digits hold. */
  cnj: string;
  /** The number as it was read, when its check digits did not hold: said, never taken. */
  cnjRead: string;
  filedOn: string;
  court: string;
  system: string;
  unit: string;
  caseClass: string;
  note: string;
};

/** The answer of `caso.protocolo.leitura`, read for the receipt's form. A day still to come is no day of filing. */
export function receiptReadingOf(raw: unknown, today: string): ReceiptReading {
  const answer = record(raw);
  const number = text(answer.numero_processo, 40);
  const valid = isValidCnj(number);
  return {
    matches: answer.confere_tipo === "sim",
    legible: answer.legivel === true,
    cnj: valid ? (formatCnj(number) ?? "") : "",
    cnjRead: valid ? "" : number,
    filedOn: dayOf(answer.data_protocolo, today),
    court: text(answer.tribunal, 20).toUpperCase(),
    system: text(answer.sistema, 40),
    unit: text(answer.orgao, 200),
    caseClass: text(answer.classe, 200),
    note: text(answer.observacoes, 300),
  };
}

/** What ONE read of a cost's receipt (0162): only what passes the form's checks. */
export type CostReading = {
  /** It is the receipt of an expense, by the model's word. */
  isCost: boolean;
  legible: boolean;
  description: string;
  /** The value, in cents; 0 when nothing was read. */
  cents: number;
  /** The day it was paid (or issued), never one still to come. */
  spentOn: string;
  note: string;
};

/** The answer of `caso.custo.leitura`, read for the form of a cost. */
export function costReadingOf(raw: unknown, today: string): CostReading {
  const answer = record(raw);
  const cents = typeof answer.valor_centavos === "number" ? Math.trunc(answer.valor_centavos) : 0;
  const description = text(answer.descricao, 200);
  return {
    isCost: typeof answer.tipo === "string" && answer.tipo !== "outro",
    legible: answer.legivel === true,
    description: description.length >= 2 ? description : "",
    cents: cents > 0 && cents <= 999_999_999_999 ? cents : 0,
    spentOn: dayOf(answer.data, today),
    note: text(answer.observacoes, 300)
      .replace(/\s*[\u2013\u2014]\s*/g, ", ")
      .replace(/!/g, "."),
  };
}

/** The words of a refusal of a reading, as the forms say it. */
export function prefillErrorKey(code: string): string {
  switch (code) {
    case "prefill_limit":
      return "prefill-error-limit";
    case "not_allowed_in_support_session":
      return "prefill-error-support";
    case "provider_not_configured":
    case "backend_not_configured":
    case "no_prompt_version":
    case "unknown_task":
      return "prefill-error-off";
    case "type_not_allowed":
    case "image_unreadable":
    case "unsupported_type":
      return "prefill-error-file";
    case "too_large":
    case "invalid_size":
      return "prefill-error-size";
    default:
      return "prefill-error-failed";
  }
}
