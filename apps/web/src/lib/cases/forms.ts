import { localTimeForField, type PersonData, phoneForField } from "@/lib/cases/cases";
import { onlyDigits } from "@flyee/fields";

/**
 * What the forms of a case hold and send, as pure functions: the person's
 * fields (`components/cases/person-fields.tsx`) and a leg of the trip
 * (`components/cases/segment-fields.tsx`), shared by the client's link and
 * the case screen. The database checks every value again (migration 0022).
 */

export type PersonField = keyof Omit<PersonData, "person_id" | "party_id">;
export type PersonValues = Record<PersonField, string>;

export const PERSON_FIELDS: readonly PersonField[] = [
  "full_name",
  "cpf",
  "birth_date",
  "nationality",
  "marital_status",
  "profession",
  "email",
  "phone",
  "postal_code",
  "street",
  "address_number",
  "complement",
  "district",
  "city",
  "uf",
];

/** What an adult is asked: who they are, how to reach them, where they live. */
export const ADULT_FORM: readonly PersonField[] = PERSON_FIELDS;
/** What a minor is asked. */
export const MINOR_FORM: readonly PersonField[] = ["full_name", "cpf", "birth_date"];

export const emptyPerson = (): PersonValues =>
  Object.fromEntries(PERSON_FIELDS.map((field) => [field, ""])) as PersonValues;

export function personValues(person: Partial<PersonData> | null | undefined): PersonValues {
  const values = emptyPerson();
  if (!person) return values;
  for (const field of PERSON_FIELDS) values[field] = String(person[field] ?? "");
  values.phone = phoneForField(person.phone);
  return values;
}

/**
 * What a form sends: the fields it shows, digits for the masked ones, null
 * for an empty one (which clears it). Only the fields that changed, when the
 * values it started from are given.
 */
export function personFields(
  values: PersonValues,
  shown: readonly PersonField[],
  initial?: PersonValues,
): Record<string, string | null> {
  // A masked field holds the same number with or without its dots: compare what is sent.
  const sent = (field: PersonField, raw: string) => {
    const value = field === "cpf" || field === "phone" || field === "postal_code" ? onlyDigits(raw.trim()) : raw.trim();
    return value === "" ? null : value;
  };
  const fields: Record<string, string | null> = {};
  for (const field of shown) {
    const value = sent(field, values[field]);
    if (initial && value === sent(field, initial[field])) continue;
    fields[field] = value;
  }
  return fields;
}

export type SegmentField =
  | "flight_number"
  | "origin_iata"
  | "destination_iata"
  | "scheduled_departure_local"
  | "scheduled_arrival_local"
  | "actual_departure_local"
  | "actual_arrival_local"
  | "booking_reference";

export type SegmentValues = Record<SegmentField, string> & { affected: boolean };

const TEXT_FIELDS: readonly SegmentField[] = [
  "flight_number",
  "origin_iata",
  "destination_iata",
  "scheduled_departure_local",
  "scheduled_arrival_local",
  "actual_departure_local",
  "actual_arrival_local",
  "booking_reference",
];

export type SegmentData = Partial<Record<SegmentField, string | null>> & { affected?: boolean | null };

export function segmentValues(segment: SegmentData | null | undefined): SegmentValues {
  return {
    flight_number: segment?.flight_number ?? "",
    origin_iata: segment?.origin_iata ?? "",
    destination_iata: segment?.destination_iata ?? "",
    scheduled_departure_local: localTimeForField(segment?.scheduled_departure_local),
    scheduled_arrival_local: localTimeForField(segment?.scheduled_arrival_local),
    actual_departure_local: localTimeForField(segment?.actual_departure_local),
    actual_arrival_local: localTimeForField(segment?.actual_arrival_local),
    booking_reference: segment?.booking_reference ?? "",
    affected: segment?.affected ?? true,
  };
}

/** What a form sends: every field, null for an empty one. */
export function segmentFields(values: SegmentValues): Record<string, string | boolean | null> {
  const fields: Record<string, string | boolean | null> = { affected: values.affected };
  for (const field of TEXT_FIELDS) {
    const value = values[field].trim();
    fields[field] = value === "" ? null : value;
  }
  return fields;
}
