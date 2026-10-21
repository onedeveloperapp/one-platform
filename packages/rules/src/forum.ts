/**
 * The forum of a lawsuit of an air passenger: where it is filed.
 *
 * The passenger is a consumer and may sue at their own domicile (Código de
 * Defesa do Consumidor, art. 101, I); in the small-claims court the same
 * holds for the reparation of a damage, beside the place of the fact (Lei
 * 9.099/1995, art. 4, III). ONE's rule, decided by the owner: the forum is
 * the passenger's domicile by default; any other forum needs a link to the
 * flight (a city of an airport of the trip, where the fact happened) and a
 * reason the firm records. A forum with no link to the flight is refused,
 * whatever reason is given.
 *
 * Cities are compared as people write them, without accents or case. Which
 * comarca a city belongs to is data the court publishes, never decided here.
 */

export const FORUM_RULE_VERSION = "foro-v1";

/** How short a recorded reason may be: the same floor as the database's (`proceedings_reason_check`). */
export const FORUM_REASON_MIN = 8;

export type ForumBasis = "domicile" | "event_place" | "defendant_seat" | "other";

export type Place = { city: string; uf: string };

export type ForumInput = {
  basis: ForumBasis;
  /** The domicile of the claimant the lawsuit is for (for a minor, of the guardian who answers for them). */
  domicile: Place | null;
  /** The forum chosen, when it is not the domicile. */
  chosen: Place | null;
  /** The cities of the airports of the trip: where a fact of the flight can have happened. */
  tripPlaces: Place[];
  reason: string | null;
};

export type ForumDecision =
  | { ok: true; basis: ForumBasis; place: Place; rule: typeof FORUM_RULE_VERSION }
  | {
      ok: false;
      /**
       * - `domicile_unknown`: the claimant's city and state are not filled in;
       * - `place_unknown`: another forum was chosen without saying which;
       * - `not_linked_to_flight`: the forum chosen is not a city of an airport of the trip;
       * - `reason_required`: another forum needs the reason written down.
       */
      code: "domicile_unknown" | "place_unknown" | "not_linked_to_flight" | "reason_required";
      rule: typeof FORUM_RULE_VERSION;
    };

/** A city as it is compared: no accents, lower case, single spaces. */
export function cityKey(city: string): string {
  return city
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export const samePlace = (left: Place, right: Place): boolean =>
  left.uf.trim().toUpperCase() === right.uf.trim().toUpperCase() && cityKey(left.city) === cityKey(right.city);

const isPlace = (place: Place | null): place is Place =>
  place !== null && cityKey(place.city) !== "" && /^[A-Z]{2}$/.test(place.uf.trim().toUpperCase());

export function decideForum(input: ForumInput): ForumDecision {
  const rule = FORUM_RULE_VERSION;
  if (input.basis === "domicile") {
    return isPlace(input.domicile)
      ? { ok: true, basis: "domicile", place: input.domicile, rule }
      : { ok: false, code: "domicile_unknown", rule };
  }
  if (!isPlace(input.chosen)) return { ok: false, code: "place_unknown", rule };
  const chosen = input.chosen;
  if (!input.tripPlaces.some((place) => samePlace(place, chosen))) {
    return { ok: false, code: "not_linked_to_flight", rule };
  }
  if ((input.reason ?? "").trim().length < FORUM_REASON_MIN) return { ok: false, code: "reason_required", rule };
  return { ok: true, basis: input.basis, place: chosen, rule };
}
