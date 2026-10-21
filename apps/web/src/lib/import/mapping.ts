/**
 * Which column of a firm's spreadsheet is which fact of a lawsuit. Systems
 * name the same thing in their own ways ("Número do processo", "Nº CNJ",
 * "Processo"): each fact has the names it is known by, a column serves one
 * fact, and the person confirms the guess before anything is read by it.
 * Pure.
 */

/** What a line of a portfolio may say of a lawsuit. The first two are what a line cannot go without. */
export const PORTFOLIO_FIELDS = [
  "cnj",
  "client_name",
  "client_document",
  "opponent",
  "unit",
  "comarca",
  "kind",
  "filed_on",
  "status",
  "folder",
  "responsible",
  "claim_value",
  "notes",
] as const;

export type PortfolioField = (typeof PORTFOLIO_FIELDS)[number];

export const REQUIRED_FIELDS: readonly PortfolioField[] = ["cnj", "client_name"];

/** A field to the column it is read from. */
export type ColumnMapping = Partial<Record<PortfolioField, number>>;

/** A header as it is compared: no accents, no case, letters and digits only. */
export const normalizeHeader = (header: string): string =>
  header
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

/** The names each fact is known by, the most telling first. */
const NAMES: Record<PortfolioField, readonly string[]> = {
  cnj: [
    "numero do processo",
    "numero processo",
    "n do processo",
    "n processo",
    "no processo",
    "num processo",
    "numero cnj",
    "numero unico",
    "numeracao unica",
    "cnj",
    "processo",
    "processos",
    "numero",
    "n",
    "num",
  ],
  client_name: [
    "nome do cliente",
    "cliente",
    "clientes",
    "parte cliente",
    "autor",
    "autores",
    "parte autora",
    "requerente",
    "requerentes",
    "polo ativo",
    "nome",
  ],
  client_document: [
    "cpf cnpj do cliente",
    "cpf do cliente",
    "cliente cpf cnpj",
    "cliente cpf",
    "cpf cnpj cliente",
    "cpf cliente",
    "cpf cnpj",
    "cpf",
    "documento do cliente",
    "documento",
  ],
  opponent: [
    "parte contraria",
    "partes contrarias",
    "contrario",
    "adverso",
    "polo passivo",
    "parte re",
    "requerido",
    "requeridos",
    "reu",
    "reus",
    "companhia aerea",
    "companhia",
    "cia aerea",
  ],
  unit: ["orgao julgador", "vara juizo", "juizo", "vara", "serventia", "juizado", "orgao"],
  comarca: ["comarca", "foro", "cidade"],
  kind: ["tipo de acao", "classe processual", "classe", "procedimento", "rito", "acao", "natureza", "tipo"],
  filed_on: [
    "data de distribuicao",
    "data da distribuicao",
    "data distribuicao",
    "distribuido em",
    "distribuicao",
    "data de ajuizamento",
    "data do ajuizamento",
    "ajuizamento",
    "data do protocolo",
    "data de protocolo",
  ],
  status: ["situacao do processo", "situacao", "status do processo", "status", "fase"],
  folder: ["numero da pasta", "pasta", "numero interno", "codigo interno", "controle", "codigo", "id"],
  responsible: ["advogado responsavel", "responsavel", "advogado"],
  claim_value: ["valor da causa", "valor da acao", "valor"],
  notes: ["observacoes", "observacao", "obs", "anotacoes", "descricao", "titulo"],
};

/**
 * Names too short or too common to be read inside a longer header ("Número da pasta" is no lawsuit's
 * number): they name a fact only as the whole header.
 */
const WHOLE_ONLY = new Set(["numero", "n", "num", "orgao", "processos"]);

/**
 * The column of each fact, guessed from the headers: a header that is one of a fact's names first, then one
 * that starts with a name, then one that holds it as a whole word. A column is taken once, by the fact that
 * names it best.
 */
export function guessColumnMapping(headers: readonly string[]): ColumnMapping {
  const plain = headers.map(normalizeHeader);
  const taken = new Set<number>();
  const mapping: ColumnMapping = {};
  const tests: ((header: string, name: string) => boolean)[] = [
    (header, name) => header === name,
    (header, name) => !WHOLE_ONLY.has(name) && header.startsWith(`${name} `),
    (header, name) => !WHOLE_ONLY.has(name) && ` ${header} `.includes(` ${name} `),
  ];
  for (const test of tests) {
    for (const field of PORTFOLIO_FIELDS) {
      if (mapping[field] !== undefined) continue;
      for (const name of NAMES[field]) {
        const index = plain.findIndex((header, column) => !taken.has(column) && header !== "" && test(header, name));
        if (index !== -1) {
          mapping[field] = index;
          taken.add(index);
          break;
        }
      }
    }
  }
  return mapping;
}

/** The facts a line cannot go without that no column gives yet. */
export const missingRequired = (mapping: ColumnMapping): PortfolioField[] =>
  REQUIRED_FIELDS.filter((field) => mapping[field] === undefined);
