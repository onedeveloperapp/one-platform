import { onlyDigits } from "@flyee/fields";

/**
 * Where the firm is, as the power of attorney says it (migration 0217): its address, its professional e-mail and,
 * when it is a society of lawyers, its registration at the bar (CPC, art. 105, §§ 2º and 3º, and art. 287). Pure: what
 * the database answers, read into what the form edits, and the payload `set_firm_office` takes.
 */

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
};

/** The columns of `organizations` the office is read from. */
export const OFFICE_COLUMNS =
  "office_postal_code, office_street, office_number, office_complement, office_district, office_city, office_uf, office_email, oab_society_uf, oab_society_number";

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
};

const text = (value: unknown): string => (typeof value === "string" ? value : "");

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

/** The payload of `set_firm_office`. */
export function officePayload(office: FirmOffice): Record<string, string> {
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
  };
}
