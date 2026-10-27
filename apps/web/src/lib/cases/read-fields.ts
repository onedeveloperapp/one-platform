import { PERSON_FIELDS, type PersonField } from "@/lib/cases/forms";

/**
 * What ONE wrote in a person's record from a document of theirs (`people.read_fields`, migration 0063): each
 * field, with the document it came from and the document's kind. Never a value. A field leaves the list when a
 * person or the client writes it. Pure, so the client's link and the case screen read it the same way.
 */
export type ReadFields = Partial<Record<PersonField, { document: string; kind: string }>>;

/** The marks as the database keeps them, read; anything else is no mark. */
export function readFieldsOf(raw: unknown): ReadFields {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const marks: ReadFields = {};
  for (const field of PERSON_FIELDS) {
    const mark = (raw as Record<string, unknown>)[field] as { document?: unknown; kind?: unknown } | undefined;
    if (mark && typeof mark.document === "string" && typeof mark.kind === "string") {
      marks[field] = { document: mark.document, kind: mark.kind };
    }
  }
  return marks;
}

/** What was read, as a person says it: the name, the CPF, the birth date, the nationality, and the address as one. */
export const READ_ITEMS = ["full_name", "cpf", "birth_date", "nationality", "address"] as const;
export type ReadItem = (typeof READ_ITEMS)[number];

const ADDRESS_FIELDS: readonly PersonField[] = [
  "postal_code",
  "street",
  "address_number",
  "complement",
  "district",
  "city",
  "uf",
];

/** The items a record's marks name, in the order of the form. */
export function readItems(marks: ReadFields): ReadItem[] {
  return READ_ITEMS.filter((item) =>
    item === "address" ? ADDRESS_FIELDS.some((field) => marks[field]) : Boolean(marks[item]),
  );
}

/** The words of each item, for a sentence (`product` namespace). */
export const READ_ITEM_KEY: Record<ReadItem, string> = {
  full_name: "read-item-full-name",
  cpf: "read-item-cpf",
  birth_date: "read-item-birth-date",
  nationality: "read-item-nationality",
  address: "read-item-address",
};

/** The kinds of document ONE reads a person's data from. */
export const DATA_KINDS: readonly string[] = ["identity", "address_proof"];

/**
 * Whether ONE is still reading a document of the person that tells their data: an identity or a proof of
 * address of one of their parties the backend has not finished with.
 */
export function beingRead(
  partyIds: readonly (string | null)[],
  documents: readonly { kind: string; party_id: string | null; status: string; processing?: string | null }[],
): boolean {
  return documents.some(
    (document) =>
      DATA_KINDS.includes(document.kind) &&
      document.party_id !== null &&
      partyIds.includes(document.party_id) &&
      document.status === "received" &&
      (document.processing === "pending" || document.processing === "working"),
  );
}
