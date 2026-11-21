import { onlyDigits } from "@flyee/fields";

/**
 * Where the firm is, as the power of attorney says it (migration 0217): its address, its professional e-mail and,
 * when it is a society of lawyers, its registration at the bar (CPC, art. 105, §§ 2º and 3º, and art. 287). Pure: what
 * the database answers, read into what the form edits, and the payload `set_firm_office` takes. Since 0271 what ONE
 * read of the firm from one of its documents comes with it (`read`), until a person saves the office, and the lawyers
 * the firm's papers name who are not of the team (`lawyers`), whom the form may leave out.
 */

/** What a document of the firm wrote in its record (0271). */
export const OFFICE_READ_FIELDS = ["address", "email", "society", "cnpj", "phone", "lawyers"] as const;
export type OfficeReadField = (typeof OFFICE_READ_FIELDS)[number];

/** What ONE read of the firm from one of its documents, until a person saves the office (0271). */
export type OfficeRead = {
  /** What the document is: a paper, a petition, the letterhead. */
  source: string;
  fields: OfficeReadField[];
  /** An address read without its CEP: the form opens with it and asks the CEP. */
  left: { street: string; number: string; complement: string; district: string; city: string; uf: string } | null;
};

/** A lawyer a paper of the firm names as its own who is not of the team (0271). */
export type OfficeLawyer = { name: string; uf: string; number: string };

export type FirmOffice = {
  postalCode: string;
  street: string;
  number: string;
  complement: string;
  district: string;
  city: string;
  uf: string;
  email: string;
  societyUf: string;
  societyNumber: string;
  /** The firm's CNPJ, digits: the billing profile's document when it has fourteen (0054). Shown, never edited here. */
  cnpj: string;
  /** Never edited here but by leaving one out. */
  lawyers: OfficeLawyer[];
  /** What ONE read, never edited: saving confirms it. */
  read: OfficeRead | null;
};

/** The columns of `organizations` the office is read from. */
export const OFFICE_COLUMNS =
  "office_postal_code, office_street, office_number, office_complement, office_district, office_city, office_uf, office_email, oab_society_uf, oab_society_number, office_lawyers, office_read, billing_cpf_cnpj";

export const EMPTY_OFFICE: FirmOffice = {
  postalCode: "",
  street: "",
  number: "",
  complement: "",
  district: "",
  city: "",
  uf: "",
  email: "",
  societyUf: "",
  societyNumber: "",
  cnpj: "",
  lawyers: [],
  read: null,
};

const text = (value: unknown): string => (typeof value === "string" ? value : "");

/** What ONE read, as the database keeps it, or null. */
export function officeReadOf(value: unknown): OfficeRead | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const read = value as Record<string, unknown>;
  const fields = (Array.isArray(read.fields) ? read.fields : []).filter((field): field is OfficeReadField =>
    (OFFICE_READ_FIELDS as readonly unknown[]).includes(field),
  );
  const place = typeof read.left === "object" && read.left !== null ? (read.left as Record<string, unknown>) : null;
  const left =
    place && text(place.street) && text(place.city)
      ? {
          street: text(place.street),
          number: text(place.number),
          complement: text(place.complement),
          district: text(place.district),
          city: text(place.city),
          uf: text(place.uf),
        }
      : null;
  return fields.length > 0 || left ? { source: text(read.source), fields, left } : null;
}

/** The lawyers of the firm's papers, as the database keeps them. */
export function officeLawyersOf(value: unknown): OfficeLawyer[] {
  return (Array.isArray(value) ? value : []).flatMap((item) => {
    const lawyer = (item ?? {}) as Record<string, unknown>;
    return text(lawyer.name) && /^[A-Z]{2}$/.test(text(lawyer.uf)) && /^\d{1,10}$/.test(text(lawyer.number))
      ? [{ name: text(lawyer.name), uf: text(lawyer.uf), number: text(lawyer.number) }]
      : [];
  });
}

/** The office as the database answers it; empty fields where it has none. */
export function officeOf(row: unknown): FirmOffice {
  const value = (row ?? {}) as Record<string, unknown>;
  return {
    postalCode: text(value.office_postal_code),
    street: text(value.office_street),
    number: text(value.office_number),
    complement: text(value.office_complement),
    district: text(value.office_district),
    city: text(value.office_city),
    uf: text(value.office_uf),
    email: text(value.office_email),
    societyUf: text(value.oab_society_uf),
    societyNumber: text(value.oab_society_number),
    cnpj: /^\d{14}$/.test(text(value.billing_cpf_cnpj)) ? text(value.billing_cpf_cnpj) : "",
    lawyers: officeLawyersOf(value.office_lawyers),
    read: officeReadOf(value.office_read),
  };
}

/** Whether the power of attorney has the office's address: the CEP, the street, the city and the state. */
export function officeAddressGiven(office: FirmOffice): boolean {
  return (
    onlyDigits(office.postalCode).length === 8 &&
    office.street.trim() !== "" &&
    office.city.trim() !== "" &&
    /^[A-Z]{2}$/.test(office.uf.trim().toUpperCase())
  );
}

/** What the form can save: the address whole or empty, the registration with both parts or none, a valid e-mail. */
export function officeProblem(office: FirmOffice): "address" | "society" | "email" | null {
  const addressParts = [onlyDigits(office.postalCode), office.street.trim(), office.city.trim(), office.uf.trim()];
  const someAddress = addressParts.some((part) => part !== "");
  if (someAddress && !officeAddressGiven(office)) return "address";
  if ((office.societyUf.trim() === "") !== (onlyDigits(office.societyNumber) === "")) return "society";
  if (office.email.trim() !== "" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(office.email.trim())) return "email";
  return null;
}

/** The payload of `set_firm_office`: the lawyers of the papers the firm keeps go by state and number (0271). */
export function officePayload(office: FirmOffice): Record<string, unknown> {
  return {
    postal_code: onlyDigits(office.postalCode),
    street: office.street,
    number: office.number,
    complement: office.complement,
    district: office.district,
    city: office.city,
    uf: office.uf.trim().toUpperCase(),
    email: office.email.trim(),
    society_uf: office.societyUf.trim().toUpperCase(),
    society_number: onlyDigits(office.societyNumber),
    lawyers: office.lawyers.map((lawyer) => ({ uf: lawyer.uf, number: lawyer.number })),
  };
}
