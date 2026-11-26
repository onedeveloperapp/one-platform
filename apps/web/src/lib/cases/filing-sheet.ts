import { type FilingFiles, filingStepKey } from "@/lib/cases/filing";
import { brazilianMoney, CLASS_OF_KIND, SUBJECT_OF_INCIDENT } from "@/lib/court-robot/facts";
import { formatCep, formatCnpj, formatCpf, formatPhoneBr, normalizeMobileBr, onlyDigits } from "@flyee/fields";
import { formatDayBr, isMinorOn } from "@flyee/rules/person";
import { specificitiesOf } from "@flyee/rules/specificities";

/**
 * The guide of who files a package by hand (migration 0269, the third of the three ways to file): what the court's
 * screen asks, in the order of its own steps, each value read from the case and ready to copy as the court's field
 * takes it (a CPF's digits, a value in reais as "1.234,56"). The eproc's steps are TJSP's and TJRJ's manuals for
 * lawyers (TJSP, "Da distribuição de inicial", 13/04/2026 and 20/07/2026; TJRJ, v1.0); the PJe's are the words the
 * card had for it; a system whose screens no manual gave (the Projudi of TJGO) is guided by what every filing asks.
 * What the court's screen asks and the case does not have is said missing, never filled in: a claimant's e-mail and
 * mobile where the screen refuses a claimant without them (`asks_contact`, the eproc of TJSP), a represented minor's
 * being who answers for them. Pure: the database's answer (`filing_package_sheet`) in, the guide out.
 */

export type SheetPerson = {
  partyId: string;
  name: string | null;
  cpf: string | null;
  birthDate: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  email: string | null;
  phone: string | null;
  /** The claimant's answer on free justice, when one was given: asks it, or not. */
  freeJustice: boolean | null;
  /** Who answers for a minor. */
  guardian: { name: string | null; cpf: string | null; email: string | null; phone: string | null } | null;
};

export type SheetScreen = {
  key: string;
  name: string;
  host: string;
  /** How the lawyer signs in: the certificate where the court signs by it (the PJe, 0304). */
  loginKind: "password_app" | "password_email" | "certificate";
  /** The screen refuses a claimant with no e-mail and mobile. */
  asksContact: boolean;
};

/** What `filing_package_sheet` answers of a package ready to file, read. */
export type FilingSheetData = {
  packageId: string;
  kind: "juizado" | "comum";
  court: string;
  courtState: string | null;
  system: string;
  screen: SheetScreen | null;
  comarca: string | null;
  unit: string | null;
  incident: string | null;
  valueCents: number | null;
  codes: { class: number | null; subject: number | null; moral: number | null };
  claimants: SheetPerson[];
  defendant: { name: string | null; cnpj: string | null; address: string | null } | null;
  lawyers: { userId: string; name: string; oab: { uf: string; number: string } | null }[];
};

const text = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value.trim() : null;
const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const list = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value) ? value.filter((item) => item && typeof item === "object").map(record) : [];
const code = (value: unknown): number | null =>
  typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;

/** The database's answer, read; null when it is not one (a package no longer ready). */
export function filingSheetOf(raw: unknown): FilingSheetData | null {
  const row = record(raw);
  const packageId = text(row.package_id);
  const court = text(row.court);
  const system = text(row.system);
  if (!packageId || !court || !system || (row.kind !== "juizado" && row.kind !== "comum")) return null;
  const screen = record(row.screen);
  const codes = record(row.codes);
  const defendant = row.defendant ? record(row.defendant) : null;
  return {
    packageId,
    kind: row.kind,
    court,
    courtState: text(row.court_state),
    system,
    screen:
      text(screen.key) && text(screen.name) && text(screen.host)
        ? {
            key: text(screen.key) ?? "",
            name: text(screen.name) ?? "",
            host: text(screen.host) ?? "",
            loginKind:
              screen.login_kind === "password_email" || screen.login_kind === "certificate"
                ? screen.login_kind
                : "password_app",
            asksContact: screen.asks_contact === true,
          }
        : null,
    comarca: text(row.comarca),
    unit: text(row.unit),
    incident: text(row.incident),
    valueCents: typeof row.value_cents === "number" && row.value_cents > 0 ? row.value_cents : null,
    codes: { class: code(codes.class), subject: code(codes.subject), moral: code(codes.moral) },
    claimants: list(row.claimants).flatMap((person) => {
      const partyId = text(person.party_id);
      if (!partyId) return [];
      const guardian = person.guardian ? record(person.guardian) : null;
      return [
        {
          partyId,
          name: text(person.name),
          cpf: text(person.cpf),
          birthDate: text(person.birth_date),
          street: text(person.street),
          number: text(person.number),
          complement: text(person.complement),
          district: text(person.district),
          city: text(person.city),
          state: text(person.state),
          zip: text(person.zip),
          email: text(person.email),
          phone: text(person.phone),
          freeJustice: typeof person.free_justice === "boolean" ? person.free_justice : null,
          guardian:
            guardian && text(guardian.name)
              ? {
                  name: text(guardian.name),
                  cpf: text(guardian.cpf),
                  email: text(guardian.email),
                  phone: text(guardian.phone),
                }
              : null,
        },
      ];
    }),
    defendant:
      defendant && (text(defendant.name) || text(defendant.cnpj))
        ? { name: text(defendant.name), cnpj: text(defendant.cnpj), address: text(defendant.address) }
        : null,
    lawyers: list(row.lawyers).flatMap((lawyer) => {
      const userId = text(lawyer.user_id);
      if (!userId) return [];
      const oab = record(lawyer.oab);
      return [
        {
          userId,
          name: text(lawyer.name) ?? "",
          oab: text(oab.uf) && text(oab.number) ? { uf: text(oab.uf) ?? "", number: text(oab.number) ?? "" } : null,
        },
      ];
    }),
  };
}

// ---------- The guide ----------

/** A message key of the `product` namespace and its values, written where the guide is drawn. */
export type SheetWords = { key: string; values?: Record<string, string | number> };

/** One value the court's screen asks. */
export type SheetRow = {
  id: string;
  label: SheetWords;
  /** The value as a person reads it: the case's own (a name, a number), or the words of a choice ("Requerida"). */
  shown: string | SheetWords | null;
  /** What the copy button writes, as the court's field takes it; null where the screen has a list to choose from. */
  copy: string | null;
  /** Whose the value is, when it is not the claimant's own (a minor's contact is who answers for them). */
  note?: SheetWords;
  /** The court's screen asks it and the case does not have it: which of a claimant's contact, and whose. */
  missing?: { field: "email" | "mobile"; whose: string };
  /** A long value (an address) takes two columns where there are three. */
  wide?: boolean;
};

/** Values of one thing on a step: the lawsuit, a claimant, the defendant. */
export type SheetGroup = { id: string; title: SheetWords | null; rows: SheetRow[] };

/** A step of the court's screen, by its own name, with what to do there and the values it asks. */
export type GuideStep = { id: string; title: SheetWords; hint: SheetWords; groups: SheetGroup[] };

const row = (
  id: string,
  label: string,
  shown: string | SheetWords | null,
  copy: string | null = typeof shown === "string" ? shown : null,
  extra: Partial<SheetRow> = {},
): SheetRow => ({ id, label: { key: label }, shown, copy, ...extra });

/** A Brazilian mobile as the screen takes it (eleven digits, no country), and as a person reads it. */
function mobileOf(phone: string | null): { shown: string; copy: string } | null {
  if (!phone) return null;
  const mobile = normalizeMobileBr(phone);
  const digits = mobile.ok ? mobile.digits : onlyDigits(phone).replace(/^55(?=\d{10,11}$)/, "");
  return digits ? { shown: formatPhoneBr(digits), copy: digits } : null;
}

/** A name of a court's table with its code there, when the platform has it: "Procedimento comum, código 7". */
const coded = (name: string, codeOf: number | null): string | SheetWords =>
  codeOf ? { key: "filing-sheet-coded", values: { name, code: codeOf } } : name;

const cpfRow = (id: string, label: string, cpf: string | null): SheetRow | null => {
  const digits = onlyDigits(cpf ?? "");
  return digits ? row(id, label, digits.length === 11 ? formatCpf(digits) : digits, digits) : null;
};

/** The rows of the lawsuit itself: where it goes, its kind, its class, its value, its other lawyers. */
function lawsuitRows(sheet: FilingSheetData): SheetRow[] {
  const kind = CLASS_OF_KIND[sheet.kind] ?? null;
  const rows: (SheetRow | null)[] = [
    sheet.comarca ? row("processo.comarca", "filing-sheet-comarca", sheet.comarca) : null,
    sheet.unit ? row("processo.unidade", "filing-sheet-unit", sheet.unit) : null,
    row("processo.rito", "filing-sheet-rite", { key: `filing-sheet-rite-${sheet.kind}` }, null),
    row("processo.area", "filing-sheet-area", { key: "filing-sheet-area-civil" }, null),
    kind ? row("processo.classe", "filing-sheet-class", coded(kind.classe, sheet.codes.class), kind.classe) : null,
    sheet.valueCents
      ? row(
          "processo.valor",
          "filing-sheet-value",
          `R$ ${brazilianMoney(sheet.valueCents)}`,
          brazilianMoney(sheet.valueCents),
        )
      : row("processo.valor", "filing-sheet-value", { key: "filing-sheet-value-none" }, null),
  ];
  return rows.filter((item): item is SheetRow => item !== null);
}

/** The lawyers of the lawsuit, by their registration at the bar, as the screen includes "outros advogados". */
function lawyerRows(sheet: FilingSheetData): SheetRow[] {
  return sheet.lawyers.flatMap((lawyer) =>
    lawyer.oab
      ? [
          {
            id: `advogado.${lawyer.userId}`,
            label: { key: "filing-sheet-lawyer", values: { name: lawyer.name } },
            shown: `OAB/${lawyer.oab.uf} ${lawyer.oab.number}`,
            copy: `${lawyer.oab.uf}${onlyDigits(lawyer.oab.number)}`,
          },
        ]
      : [],
  );
}

/** The subjects: the problem's, with its code in the CNJ's table where the platform has it, and the moral damage. */
function subjectRows(sheet: FilingSheetData): SheetRow[] {
  const main = sheet.incident ? (SUBJECT_OF_INCIDENT[sheet.incident] ?? null) : null;
  const rows: SheetRow[] = [];
  if (main) {
    rows.push(
      row(
        "processo.assunto_principal",
        "filing-sheet-subject-main",
        coded(main, sheet.codes.subject),
        sheet.codes.subject ? String(sheet.codes.subject) : main,
      ),
    );
  }
  const moral = "Indenização por Dano Moral";
  rows.push(
    row(
      "processo.assunto_complementar",
      "filing-sheet-subject-extra",
      coded(moral, sheet.codes.moral),
      sheet.codes.moral ? String(sheet.codes.moral) : moral,
    ),
  );
  return rows;
}

/**
 * The values of one claimant: who they are, who answers for a minor, their address and their contact. A represented
 * minor's contact is who answers for them; where the screen asks a contact the case does not have, it is missing.
 */
function claimantGroup(person: SheetPerson, index: number, sheet: FilingSheetData, today: string): SheetGroup {
  const key = `autor.${index + 1}`;
  const minor = isMinorOn(person.birthDate, today) === true;
  const asks = sheet.screen?.asksContact === true;
  const rows: (SheetRow | null)[] = [
    cpfRow(`${key}.cpf`, "filing-sheet-cpf", person.cpf),
    person.name ? row(`${key}.nome`, "filing-sheet-name", person.name) : null,
    person.birthDate
      ? row(`${key}.nascimento`, "filing-sheet-birth", formatDayBr(person.birthDate) ?? person.birthDate)
      : null,
    person.freeJustice === null
      ? null
      : row(
          `${key}.justica_gratuita`,
          "filing-sheet-free-justice",
          { key: person.freeJustice ? "filing-sheet-requested" : "filing-sheet-not-requested" },
          null,
        ),
  ];
  if (minor && person.guardian) {
    rows.push(row(`${key}.representante.nome`, "filing-sheet-guardian", person.guardian.name));
    rows.push(cpfRow(`${key}.representante.cpf`, "filing-sheet-guardian-cpf", person.guardian.cpf));
  }
  const zip = onlyDigits(person.zip ?? "");
  rows.push(
    zip ? row(`${key}.cep`, "filing-sheet-zip", zip.length === 8 ? formatCep(zip) : zip, zip) : null,
    person.street ? row(`${key}.logradouro`, "filing-sheet-street", person.street) : null,
    person.number ? row(`${key}.numero`, "filing-sheet-number", person.number) : null,
    person.complement ? row(`${key}.complemento`, "filing-sheet-complement", person.complement) : null,
    person.district ? row(`${key}.bairro`, "filing-sheet-district", person.district) : null,
    person.city ? row(`${key}.cidade`, "filing-sheet-city", person.city) : null,
    person.state ? row(`${key}.uf`, "filing-sheet-state", person.state) : null,
  );
  // A represented minor's contact is who answers for them, by rule; anybody else's is their own.
  const contact = minor && person.guardian ? person.guardian : person;
  const fromGuardian = contact !== person;
  const note: SheetWords | undefined = fromGuardian ? { key: "filing-sheet-from-guardian" } : undefined;
  // Whose a missing contact is: who answers for a minor, the claimant otherwise.
  const whose = (fromGuardian ? person.guardian?.name : person.name) ?? "";
  const mobile = mobileOf(contact.phone);
  rows.push(
    contact.email
      ? row(`${key}.email`, "filing-sheet-email", contact.email, contact.email, note ? { note } : {})
      : asks
        ? row(`${key}.email`, "filing-sheet-email", null, null, { missing: { field: "email", whose } })
        : null,
    mobile
      ? row(`${key}.celular`, "filing-sheet-mobile", mobile.shown, mobile.copy, note ? { note } : {})
      : asks
        ? row(`${key}.celular`, "filing-sheet-mobile", null, null, { missing: { field: "mobile", whose } })
        : null,
  );
  return {
    id: key,
    title: {
      key: minor ? "filing-sheet-claimant-minor" : "filing-sheet-claimant",
      values: { position: index + 1, name: person.name ?? "" },
    },
    rows: rows.filter((item): item is SheetRow => item !== null),
  };
}

/** The airline that answers in court: its registered name, its CNPJ and its address in Brazil. */
function defendantGroup(sheet: FilingSheetData): SheetGroup | null {
  const defendant = sheet.defendant;
  if (!defendant) return null;
  const cnpj = onlyDigits(defendant.cnpj ?? "");
  const rows: (SheetRow | null)[] = [
    cnpj ? row("reu.1.cnpj", "filing-sheet-cnpj", cnpj.length === 14 ? formatCnpj(cnpj) : cnpj, cnpj) : null,
    defendant.name ? row("reu.1.nome", "filing-sheet-defendant", defendant.name) : null,
    defendant.address
      ? row("reu.1.endereco", "filing-sheet-address", defendant.address, defendant.address, { wide: true })
      : null,
  ];
  return { id: "reu.1", title: null, rows: rows.filter((item): item is SheetRow => item !== null) };
}

/** The priority of processing of an elderly claimant (`especificidades-v1`), as the screen's list names it. */
function priorityRows(sheet: FilingSheetData, today: string): SheetRow[] {
  const { priority, people } = specificitiesOf(
    sheet.claimants.map((person) => ({ name: person.name ?? "", birthDate: person.birthDate })),
    today,
  );
  if (priority === "none") return [];
  return [
    row(
      "processo.prioridade",
      "filing-sheet-priority",
      { key: priority === "elderly_80" ? "filing-sheet-priority-elderly-80" : "filing-sheet-priority-elderly" },
      null,
      { note: { key: "filing-sheet-priority-who", values: { names: people.map((person) => person.name).join(", ") } } },
    ),
  ];
}

/** The words of how a lawyer signs in at a court's screen, by how it asks. */
const ACCESS_KEY: Record<"password_app" | "password_email" | "certificate", string> = {
  password_app: "filing-guide-access-app",
  password_email: "filing-guide-access-email",
  certificate: "filing-guide-access-certificate",
};

/** How a lawyer gets into the court's screen: where, and the second factor it asks. */
function accessHint(sheet: FilingSheetData): SheetWords {
  if (sheet.screen) {
    return {
      key: ACCESS_KEY[sheet.screen.loginKind],
      values: { host: sheet.screen.host },
    };
  }
  return { key: filingStepKey(sheet.system, "access") };
}

/** The words of how the files go, as the card always said them, by how they are signed. */
const FILES_KEY: Record<Exclude<FilingFiles, "court">, { files: string; sign: string }> = {
  signed: { files: "filing-step-files-signed", sign: "filing-step-sign-signed" },
  sign_first: { files: "filing-step-files-sign-first", sign: "filing-step-sign-sign-first" },
};

const filesHint = (sheet: FilingSheetData, files: FilingFiles): SheetWords => ({
  key: files === "court" ? filingStepKey(sheet.system, "files") : FILES_KEY[files].files,
});
const signHint = (sheet: FilingSheetData, files: FilingFiles): SheetWords => ({
  key: files === "court" ? filingStepKey(sheet.system, "sign") : FILES_KEY[files].sign,
});

const group = (id: string, rows: SheetRow[]): SheetGroup[] => (rows.length > 0 ? [{ id, title: null, rows }] : []);

/**
 * The guide of a package, step by step, as its court's system shows them: the system's own steps where a manual gave
 * them, the steps of every filing otherwise. `files` is how the files go (signed on the court's screen, signed by
 * ONE, or signed by the lawyer first); `today` decides who is a minor and who has the priority of the elderly.
 */
export function filingGuideOf(sheet: FilingSheetData, input: { files: FilingFiles; today: string }): GuideStep[] {
  const systemName = sheet.screen?.name ?? null;
  const claimants = sheet.claimants.map((person, index) => claimantGroup(person, index, sheet, input.today));
  const defendant = defendantGroup(sheet);
  const access: GuideStep = {
    id: "access",
    title: systemName
      ? { key: "filing-guide-step-access", values: { system: systemName } }
      : { key: "filing-guide-step-access-plain" },
    hint: accessHint(sheet),
    groups: [],
  };
  const receipt: GuideStep = {
    id: "receipt",
    title: { key: "filing-guide-step-receipt" },
    hint: { key: "filing-step-receipt" },
    groups: [],
  };
  const tjrj = sheet.court === "TJRJ";

  if (sheet.system === "eproc") {
    return [
      access,
      {
        id: "info",
        title: { key: "filing-guide-step-eproc-info" },
        hint: { key: tjrj ? "filing-guide-eproc-info-tjrj" : "filing-guide-eproc-info" },
        groups: [...group("processo", lawsuitRows(sheet)), ...group("advogados", lawyerRows(sheet))],
      },
      {
        id: "subjects",
        title: { key: "filing-guide-step-eproc-subjects" },
        hint: { key: "filing-guide-eproc-subjects" },
        groups: group("assuntos", subjectRows(sheet)),
      },
      {
        id: "claimants",
        title: { key: "filing-guide-step-eproc-claimants" },
        hint: {
          key: sheet.screen?.asksContact ? "filing-guide-eproc-claimants-contact" : "filing-guide-eproc-claimants",
        },
        groups: claimants,
      },
      {
        id: "defendants",
        title: { key: "filing-guide-step-eproc-defendants" },
        hint: { key: "filing-guide-eproc-defendants" },
        groups: defendant ? [defendant] : [],
      },
      {
        id: "documents",
        title: { key: "filing-guide-step-eproc-documents" },
        hint: { key: tjrj ? "filing-guide-eproc-documents-tjrj" : "filing-guide-eproc-documents" },
        groups: group("prioridade", priorityRows(sheet, input.today)),
      },
      {
        id: "finish",
        title: { key: "filing-guide-step-eproc-finish" },
        hint: { key: "filing-guide-eproc-finish" },
        groups: [],
      },
      receipt,
    ];
  }

  if (sheet.system === "pje") {
    return [
      access,
      {
        id: "info",
        title: { key: "filing-guide-step-pje-initial" },
        hint: { key: "filing-guide-pje-initial" },
        groups: group(
          "processo",
          lawsuitRows(sheet).filter((item) => item.id !== "processo.valor"),
        ),
      },
      {
        id: "subjects",
        title: { key: "filing-guide-step-pje-subjects" },
        hint: { key: "filing-guide-pje-subjects" },
        groups: group("assuntos", subjectRows(sheet)),
      },
      {
        id: "parties",
        title: { key: "filing-guide-step-pje-parties" },
        hint: { key: "filing-guide-pje-parties" },
        groups: [...claimants, ...(defendant ? [defendant] : [])],
      },
      {
        id: "features",
        title: { key: "filing-guide-step-pje-features" },
        hint: { key: "filing-guide-pje-features" },
        groups: group("caracteristicas", [
          ...lawsuitRows(sheet).filter((item) => item.id === "processo.valor"),
          ...priorityRows(sheet, input.today),
        ]),
      },
      {
        id: "documents",
        title: { key: "filing-guide-step-pje-documents" },
        hint: filesHint(sheet, input.files),
        groups: [],
      },
      { id: "finish", title: { key: "filing-guide-step-pje-finish" }, hint: signHint(sheet, input.files), groups: [] },
      receipt,
    ];
  }

  // A system whose screens no manual gave: what every filing asks, in its usual order.
  return [
    access,
    {
      id: "info",
      title: { key: "filing-guide-step-process" },
      hint: { key: "filing-guide-process" },
      groups: [
        ...group("processo", [...lawsuitRows(sheet), ...priorityRows(sheet, input.today)]),
        ...group("assuntos", subjectRows(sheet)),
        ...group("advogados", lawyerRows(sheet)),
      ],
    },
    {
      id: "parties",
      title: { key: "filing-guide-step-parties" },
      hint: { key: "filing-guide-parties" },
      groups: [...claimants, ...(defendant ? [defendant] : [])],
    },
    { id: "documents", title: { key: "filing-guide-step-files" }, hint: filesHint(sheet, input.files), groups: [] },
    { id: "finish", title: { key: "filing-guide-step-finish" }, hint: signHint(sheet, input.files), groups: [] },
    receipt,
  ];
}

/** Every row the court's screen asks that the case does not have, for the line that says it before the guide. */
export const missingRows = (steps: readonly GuideStep[]): NonNullable<SheetRow["missing"]>[] =>
  steps.flatMap((step) =>
    step.groups.flatMap((item) => item.rows.flatMap((one) => (one.missing ? [one.missing] : []))),
  );

/** Every message key the guide may use, for the test that the catalog has them all. */
export const GUIDE_KEYS: readonly string[] = [
  "filing-guide-step-access",
  "filing-guide-step-access-plain",
  "filing-guide-access-app",
  "filing-guide-access-email",
  "filing-guide-step-receipt",
  "filing-guide-step-eproc-info",
  "filing-guide-eproc-info",
  "filing-guide-eproc-info-tjrj",
  "filing-guide-step-eproc-subjects",
  "filing-guide-eproc-subjects",
  "filing-guide-step-eproc-claimants",
  "filing-guide-eproc-claimants",
  "filing-guide-eproc-claimants-contact",
  "filing-guide-step-eproc-defendants",
  "filing-guide-eproc-defendants",
  "filing-guide-step-eproc-documents",
  "filing-guide-eproc-documents",
  "filing-guide-eproc-documents-tjrj",
  "filing-guide-step-eproc-finish",
  "filing-guide-eproc-finish",
  "filing-guide-step-pje-initial",
  "filing-guide-pje-initial",
  "filing-guide-step-pje-subjects",
  "filing-guide-pje-subjects",
  "filing-guide-step-pje-parties",
  "filing-guide-pje-parties",
  "filing-guide-step-pje-features",
  "filing-guide-pje-features",
  "filing-guide-step-pje-documents",
  "filing-guide-step-pje-finish",
  "filing-guide-step-process",
  "filing-guide-process",
  "filing-guide-step-parties",
  "filing-guide-parties",
  "filing-guide-step-files",
  "filing-guide-step-finish",
  "filing-sheet-comarca",
  "filing-sheet-unit",
  "filing-sheet-rite",
  "filing-sheet-rite-juizado",
  "filing-sheet-rite-comum",
  "filing-sheet-area",
  "filing-sheet-area-civil",
  "filing-sheet-class",
  "filing-sheet-coded",
  "filing-sheet-value",
  "filing-sheet-value-none",
  "filing-sheet-lawyer",
  "filing-sheet-subject-main",
  "filing-sheet-subject-extra",
  "filing-sheet-claimant",
  "filing-sheet-claimant-minor",
  "filing-sheet-cpf",
  "filing-sheet-name",
  "filing-sheet-birth",
  "filing-sheet-free-justice",
  "filing-sheet-requested",
  "filing-sheet-not-requested",
  "filing-sheet-guardian",
  "filing-sheet-guardian-cpf",
  "filing-sheet-zip",
  "filing-sheet-street",
  "filing-sheet-number",
  "filing-sheet-complement",
  "filing-sheet-district",
  "filing-sheet-city",
  "filing-sheet-state",
  "filing-sheet-email",
  "filing-sheet-mobile",
  "filing-sheet-from-guardian",
  "filing-sheet-cnpj",
  "filing-sheet-defendant",
  "filing-sheet-address",
  "filing-sheet-priority",
  "filing-sheet-priority-elderly",
  "filing-sheet-priority-elderly-80",
  "filing-sheet-priority-who",
];
