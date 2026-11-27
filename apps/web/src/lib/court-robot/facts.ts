import { ageOn } from "@flyee/rules/person";

/**
 * The facts of a lawsuit ONE files on a court's screen (migration 0264, `filing_submission_to_send`), as the robot
 * works with them: each fact by a key and the words that describe it, which is all the AI that reads a screen ever
 * sees of a person ("autor.1.cpf: CPF do autor 1"), and the value of each key, which only the robot's own code types.
 * A fact that is no person's (the class, the rite, the comarca, the subjects, the value of the cause) goes to the AI
 * with its value, so it can choose the right line of the system's own lists. Pure: no I/O.
 */

/** A claimant as `filing_submission_to_send` hands it. */
export type ToSendClaimant = {
  name: string | null;
  cpf: string | null;
  birth_date: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  email: string | null;
  phone: string | null;
  guardian: { name: string | null; cpf: string | null } | null;
};

/** What `filing_submission_to_send` hands the robot of a submission (the keys it reads). */
export type ToSend = {
  submission_id: string;
  claim: number;
  channel: string;
  batch_id: string | null;
  learning: boolean;
  screen_system: string | null;
  org_id: string;
  case_id: string;
  /** The lawsuit filed (`filing_submission_to_send` hands it since 0264). */
  proceeding_id?: string | null;
  incident: string | null;
  package_id: string;
  kind: string;
  court: string;
  court_state: string | null;
  system: string;
  comarca: string | null;
  unit: string | null;
  value_cents: number | null;
  claimants: ToSendClaimant[];
  defendant: { name: string | null; cnpj: string | null; airline: string | null } | null;
  lawyers: { user_id: string; name: string; cpf: string | null; oab: { uf: string; number: string } | null }[];
  items: {
    position: number;
    name: string;
    file_id: string;
    signed_file_id: string | null;
    document_kind: string | null;
    storage_path: string;
    signed_storage_path: string | null;
  }[];
};

/** A fact as the AI reads it: its key, what it is, and its value only when it is no person's. */
export type FactDescriptor = { chave: string; descricao: string; valor?: string };

export type FilingFacts = {
  /** What the AI sees. */
  fatos: FactDescriptor[];
  partes: { autores: string[]; reus: string[]; representados: string[] };
  arquivos: { posicao: number; tipo: string; nome: string }[];
  /** Every value by its key, for the robot's own code to type. Never sent to the AI. */
  values: Record<string, string>;
};

/** The subject of each problem, by the words the courts' tables use for it. */
export const SUBJECT_OF_INCIDENT: Record<string, string> = {
  delay: "Atraso de voo (transporte aéreo)",
  cancellation: "Cancelamento de voo (transporte aéreo)",
  overbooking: "Overbooking, preterição de embarque (transporte aéreo)",
  baggage_lost: "Extravio de bagagem (transporte aéreo)",
  baggage_damaged: "Dano à bagagem (transporte aéreo)",
};

/** The class of each kind of lawsuit, with its code in the CNJ's table, and its rite. */
export const CLASS_OF_KIND: Record<string, { classe: string; codigo: string; rito: string }> = {
  juizado: { classe: "Procedimento do Juizado Especial Cível", codigo: "436", rito: "Juizado Especial" },
  comum: { classe: "Procedimento Comum Cível", codigo: "7", rito: "Comum" },
};

/** The document kinds of a package, as a court's list names them. */
const DOCUMENT: Record<string, string> = {
  petition: "Petição inicial",
  power_of_attorney: "Procuração",
  identity: "Documento de identificação",
  address_proof: "Comprovante de endereço",
  ticket: "Bilhete ou cartão de embarque",
  boarding_pass: "Bilhete ou cartão de embarque",
  receipt: "Comprovante de despesa",
  free_justice_declaration: "Declaração de hipossuficiência",
  residence_declaration: "Declaração de residência",
  fee_contract: "Contrato de honorários",
};

const digits = (value: string | null | undefined): string => String(value ?? "").replace(/\D/g, "");

/** A value in reais as a Brazilian screen takes it: "1.234,56". */
export function brazilianMoney(cents: number): string {
  const whole = String(Math.floor(Math.abs(cents) / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const rest = String(Math.abs(cents) % 100).padStart(2, "0");
  return `${whole},${rest}`;
}

/** A day as a Brazilian screen takes it: "31/12/1980". */
const brazilianDay = (iso: string | null): string => {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? "");
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
};

/**
 * The codes of the CNJ's unified tables the platform keeps (`platform_settings.tpu`, migration 0269): the subject of
 * each problem and the moral damage every lawsuit adds. A problem with no code is named by its words only.
 */
export type TpuCodes = { subjects: Record<string, number>; moral: number | null };

/** The codes as the setting holds them, or none: a code is a whole number, never a guess. */
export function tpuCodesOf(value: unknown): TpuCodes {
  const setting = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const code = (raw: unknown): number | null =>
    typeof raw === "number" && Number.isInteger(raw) && raw > 0 ? raw : null;
  const subjects: Record<string, number> = {};
  const given = setting.subjects;
  if (typeof given === "object" && given !== null) {
    for (const [incident, raw] of Object.entries(given as Record<string, unknown>)) {
      const read = code(raw);
      if (read !== null) subjects[incident] = read;
    }
  }
  return { subjects, moral: code(setting.moral) };
}

/**
 * What the court's screen asks of the lawsuit beside its parties and files (the PJe's "Características" and "Custas
 * judiciais", 2026-11-26): whether free justice is asked (in the civil court, a claimant's answer; in the small-claims
 * court nothing is asked, Lei 9.099/1995, art. 54), whether the petition asks an injunction, read from its text, and
 * the day of the filing, for a claimant's age. Unknown is null, and its fact is left out: the AI asks the lawyer.
 */
export type FilingExtras = {
  freeJustice: boolean | null;
  injunction: boolean | null;
  today: string;
  /**
   * The place of the court that takes the lawsuits of the claimant's neighbourhood inside the comarca of their domicile,
   * as the court names it ("Lagoa", "Regional da Barra da Tijuca"): `forumOfDistrict` over the court's list
   * (`court_forum_areas`, 0309). Absent where the comarca has no such list or the neighbourhood is not in it.
   */
  forum?: string | null;
};

/** The words of a petition that ask an injunction or an anticipated relief. */
const INJUNCTION =
  /(tutela (de urg[eê]ncia|antecipada|provis[oó]ria)|antecipa[cç][aã]o (dos efeitos )?da tutela|liminar)/i;

/** Whether a petition's text asks an injunction: null for no text. */
export const asksInjunction = (text: string | null | undefined): boolean | null =>
  typeof text === "string" && text.trim() ? INJUNCTION.test(text) : null;

export function filingFactsOf(
  sent: ToSend,
  codes: TpuCodes | null = null,
  extras: FilingExtras | null = null,
): FilingFacts {
  const fatos: FactDescriptor[] = [];
  const values: Record<string, string> = {};
  const said = (chave: string, descricao: string, value: string | null | undefined, personal: boolean): void => {
    const clean = String(value ?? "").trim();
    if (!clean) return;
    values[chave] = clean;
    fatos.push(personal ? { chave, descricao } : { chave, descricao, valor: clean });
  };

  const kind = CLASS_OF_KIND[sent.kind] ?? null;
  said("processo.classe", "Classe processual", kind?.classe, false);
  said("processo.classe_codigo", "Código da classe na tabela do CNJ", kind?.codigo, false);
  said("processo.rito", "Rito", kind?.rito, false);
  said("processo.estado", "Estado do tribunal", sent.court_state, false);
  said("processo.comarca", "Comarca, cidade ou localidade onde a ação entra", sent.comarca, false);
  said("processo.unidade", "Unidade judiciária, quando o caso já a tem", sent.unit, false);
  // The place inside the comarca that takes the lawsuits of the claimant's neighbourhood, by the court's own list
  // (2026-11-27: the PJe of TJRJ lists the Capital's places, and ONE chose the Capital's centre for a resident of the
  // Jardim Botânico). A place, never the neighbourhood nor the address.
  said(
    "processo.foro",
    "Foro da comarca que atende o bairro do domicílio do autor, como o tribunal o chama",
    extras?.forum ?? null,
    false,
  );
  said(
    "processo.assunto_principal",
    "Assunto principal",
    sent.incident ? SUBJECT_OF_INCIDENT[sent.incident] : null,
    false,
  );
  // The code of the subject in the CNJ's table, which the courts' searches of subjects take (2026-11-26: the PJe of
  // TJRJ searched by words and ONE asked the lawyer for the code the platform already had).
  const subjectCode = sent.incident ? (codes?.subjects[sent.incident] ?? null) : null;
  said(
    "processo.assunto_principal_codigo",
    "Código do assunto principal na tabela do CNJ",
    subjectCode === null ? null : String(subjectCode),
    false,
  );
  const moral = codes?.moral ?? null;
  said(
    "processo.assunto_complementar",
    moral === null ? "Assunto complementar" : `Assunto complementar (código ${moral} na tabela do CNJ)`,
    "Indenização por Dano Moral",
    false,
  );
  said(
    "processo.assunto_complementar_codigo",
    "Código do assunto complementar na tabela do CNJ",
    moral === null ? null : String(moral),
    false,
  );
  // What the screen asks of the lawsuit itself (the PJe's "Características" and "Custas judiciais").
  const freeJustice = sent.kind === "juizado" ? false : (extras?.freeJustice ?? null);
  said(
    "processo.justica_gratuita",
    "Se a ação pede justiça gratuita (Sim ou Não)",
    freeJustice === null ? null : freeJustice ? "Sim" : "Não",
    false,
  );
  said(
    "processo.liminar",
    "Se a petição pede liminar ou antecipação de tutela (Sim ou Não)",
    extras?.injunction === false ? "Não" : extras?.injunction === true ? "Sim" : null,
    false,
  );
  said("processo.segredo_de_justica", "Se a ação corre em segredo de justiça (Sim ou Não)", "Não", false);
  said(
    "processo.custas",
    "Custas iniciais e a guia de recolhimento",
    sent.kind === "juizado"
      ? "Sem custas no primeiro grau do Juizado Especial Cível (Lei 9.099/1995, art. 54): sem guia, pelo motivo de não gerar custas que diz isso"
      : freeJustice
        ? "Sem guia: a ação pede justiça gratuita"
        : null,
    false,
  );
  // An elderly claimant's priority (Estatuto da Pessoa Idosa, art. 71; above 80, the special one of its § 5º): the
  // kind of priority only, never an age nor a name.
  const ages = extras
    ? sent.claimants
        .map((person) => ageOn(person.birth_date, extras.today))
        .filter((age): age is number => age !== null)
    : [];
  const eldest = ages.length > 0 ? Math.max(...ages) : null;
  said(
    "processo.prioridade",
    "Prioridade de tramitação de um autor idoso",
    eldest === null || eldest < 60 ? null : eldest >= 80 ? "Idoso com mais de 80 anos" : "Idoso(a)",
    false,
  );

  if (typeof sent.value_cents === "number" && sent.value_cents > 0) {
    said("processo.valor_causa", "Valor da causa, em reais", brazilianMoney(sent.value_cents), false);
  } else {
    fatos.push({
      chave: "processo.valor_causa",
      descricao:
        "Valor da causa: o escritório não deu valor, o juiz define (use a opção do sistema para sem valor, se houver)",
      valor: "",
    });
  }

  const autores: string[] = [];
  const representados: string[] = [];
  sent.claimants.forEach((person, index) => {
    const key = `autor.${index + 1}`;
    autores.push(key);
    said(`${key}.tipo_pessoa`, `Tipo de pessoa do autor ${index + 1}`, "Pessoa Física", false);
    said(`${key}.nome`, `Nome completo do autor ${index + 1}`, person.name, true);
    said(`${key}.cpf`, `CPF do autor ${index + 1}, só números`, digits(person.cpf), true);
    said(`${key}.nascimento`, `Data de nascimento do autor ${index + 1}`, brazilianDay(person.birth_date), true);
    said(`${key}.email`, `E-mail do autor ${index + 1}`, person.email, true);
    said(
      `${key}.celular`,
      `Celular do autor ${index + 1}, com DDD, só números`,
      digits(person.phone).replace(/^55(?=\d{10,11}$)/, ""),
      true,
    );
    said(`${key}.cep`, `CEP do endereço do autor ${index + 1}, só números`, digits(person.zip), true);
    said(`${key}.logradouro`, `Rua do endereço do autor ${index + 1}`, person.street, true);
    said(`${key}.numero`, `Número do endereço do autor ${index + 1}`, person.number, true);
    said(`${key}.complemento`, `Complemento do endereço do autor ${index + 1}`, person.complement, true);
    said(`${key}.bairro`, `Bairro do endereço do autor ${index + 1}`, person.district, true);
    said(`${key}.cidade`, `Cidade do endereço do autor ${index + 1}`, person.city, true);
    said(`${key}.uf`, `Estado do endereço do autor ${index + 1}`, person.state, true);
    if (person.guardian?.name) {
      representados.push(key);
      said(
        `${key}.representacao`,
        `Tipo de representação do autor ${index + 1}, menor de idade`,
        "Representado",
        false,
      );
      said(`${key}.representante.nome`, `Nome de quem representa o autor ${index + 1}`, person.guardian.name, true);
      said(
        `${key}.representante.cpf`,
        `CPF de quem representa o autor ${index + 1}, só números`,
        digits(person.guardian.cpf),
        true,
      );
    }
  });

  const reus: string[] = [];
  if (sent.defendant) {
    reus.push("reu.1");
    said("reu.1.tipo_pessoa", "Tipo de pessoa do réu", "Pessoa Jurídica", false);
    said("reu.1.nome", "Razão social da companhia aérea ré", sent.defendant.name, false);
    said("reu.1.cnpj", "CNPJ da companhia aérea ré, só números", digits(sent.defendant.cnpj), false);
  }

  sent.lawyers.forEach((lawyer, index) => {
    const key = `advogado.${index + 1}`;
    said(
      `${key}.oab`,
      `Inscrição na OAB do advogado ${index + 1} (estado e número)`,
      lawyer.oab ? `${lawyer.oab.uf}${lawyer.oab.number}` : null,
      false,
    );
  });

  const arquivos = sent.items.map((item) => ({
    posicao: item.position,
    tipo: DOCUMENT[item.document_kind ?? ""] ?? "Outros documentos",
    nome: item.name,
  }));

  return { fatos, partes: { autores, reus, representados }, arquivos, values };
}
