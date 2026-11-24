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

export function filingFactsOf(sent: ToSend): FilingFacts {
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
  said(
    "processo.assunto_principal",
    "Assunto principal",
    sent.incident ? SUBJECT_OF_INCIDENT[sent.incident] : null,
    false,
  );
  said(
    "processo.assunto_complementar",
    "Assunto complementar (código 7779 na tabela do CNJ)",
    "Indenização por Dano Moral",
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
