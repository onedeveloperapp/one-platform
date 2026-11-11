import type { XlsxSheet } from "@/lib/export/xlsx-write";

/**
 * The migration by the OAB from the DJEN (migration 0208), the pure half: the lawsuits the DJEN already shows of the
 * firm's lawyers, read into a plain shape, and written as a spreadsheet in the import's own columns, for the firm to
 * write each client's name and bring it in through the import, which checks each line again.
 */
export type DjenLawsuit = {
  cnj: string;
  court: string;
  unit: string | null;
  className: string | null;
  firstOn: string | null;
  lastOn: string | null;
  publications: number;
  airlineName: string | null;
};

const day = (value: unknown): string | null =>
  typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;

export function readDjenLawsuits(raw: unknown): { total: number; lawsuits: DjenLawsuit[] } | null {
  if (!raw || typeof raw !== "object") return null;
  const answer = raw as Record<string, unknown>;
  if (answer.ok !== true) return null;
  const lawsuits = (Array.isArray(answer.lawsuits) ? answer.lawsuits : []).flatMap((row): DjenLawsuit[] => {
    if (!row || typeof row !== "object") return [];
    const line = row as Record<string, unknown>;
    if (typeof line.cnj !== "string" || !/^\d{20}$/.test(line.cnj) || typeof line.court !== "string") return [];
    return [
      {
        cnj: line.cnj,
        court: line.court,
        unit: typeof line.unit === "string" ? line.unit : null,
        className: typeof line.class_name === "string" ? line.class_name : null,
        firstOn: day(line.first_on),
        lastOn: day(line.last_on),
        publications: Number(line.publications) || 0,
        airlineName: typeof line.airline_name === "string" ? line.airline_name : null,
      },
    ];
  });
  return { total: Number(answer.total) || lawsuits.length, lawsuits };
}

/** A CNJ number as the court writes it: 0000000-00.0000.0.00.0000. */
export const cnjMasked = (cnj: string): string =>
  `${cnj.slice(0, 7)}-${cnj.slice(7, 9)}.${cnj.slice(9, 13)}.${cnj.slice(13, 14)}.${cnj.slice(14, 16)}.${cnj.slice(16, 20)}`;

/**
 * The spreadsheet to complete: one line per lawsuit, in the columns the import recognises by their names (the
 * client's name and CPF left blank, for the firm), and what the DJEN showed of it beside them.
 */
export function djenLawsuitsSheet(lawsuits: readonly DjenLawsuit[]): XlsxSheet {
  return {
    sheet: "Processos do DJEN",
    columns: [
      { title: "Número do processo", width: 28 },
      { title: "Nome do cliente", width: 32 },
      { title: "CPF do cliente", width: 18 },
      { title: "Parte contrária", width: 32 },
      { title: "Vara", width: 40 },
      { title: "Classe", width: 36 },
      { title: "Observações", width: 48 },
    ],
    rows: lawsuits.map((lawsuit) => [
      cnjMasked(lawsuit.cnj),
      null,
      null,
      lawsuit.airlineName,
      lawsuit.unit,
      lawsuit.className,
      `${lawsuit.court}: ${lawsuit.publications} ${lawsuit.publications === 1 ? "publicação" : "publicações"} no DJEN${
        lawsuit.lastOn ? `, a última em ${lawsuit.lastOn.split("-").reverse().join("/")}` : ""
      }`,
    ]),
  };
}
