import { ageOn } from "@flyee/rules/person";

/**
 * What a case's people bring to its lawsuit by who they are (`especificidades-v1`, item 3.3 of the case journey
 * plan), read from the birth date ONE read of their documents. A claimant of 60 years or more has the priority of
 * processing (Estatuto da Pessoa Idosa, Lei 10.741/2003, art. 71; CPC, art. 1.048, I), and one of 80 or more the
 * special priority among them (Estatuto, art. 71, § 5º). A minor is what the case already knows (the civil court,
 * who answers for them, the public prosecutor), and is not this rule's. Pure: the day is given.
 */

export const SPECIFICITIES_RULE = "especificidades-v1";

export const ELDERLY_AGE = 60;
export const SPECIAL_PRIORITY_AGE = 80;

export type Priority = "none" | "elderly" | "elderly_80";

export type SpecificitiesInput = { name: string; birthDate: string | null }[];

export type Specificities = {
  rule: typeof SPECIFICITIES_RULE;
  /** The case's priority: the highest of its claimants'. */
  priority: Priority;
  /** Each claimant with a priority, oldest first. */
  people: { name: string; age: number; priority: Exclude<Priority, "none"> }[];
  /** The law each priority rests on, in the words a piece cites. */
  grounds: string[];
};

const GROUNDS: Record<Exclude<Priority, "none">, string[]> = {
  elderly: ["Lei 10.741/2003, art. 71", "CPC, art. 1.048, I"],
  elderly_80: ["Lei 10.741/2003, art. 71, § 5º", "CPC, art. 1.048, I"],
};

/** The priority of a case's claimants on a day. */
export function specificitiesOf(claimants: SpecificitiesInput, today: string): Specificities {
  const people = claimants
    .flatMap((claimant) => {
      const age = ageOn(claimant.birthDate, today);
      if (age === null || age < ELDERLY_AGE) return [];
      const priority: Exclude<Priority, "none"> = age >= SPECIAL_PRIORITY_AGE ? "elderly_80" : "elderly";
      return [{ name: claimant.name, age, priority }];
    })
    .sort((a, b) => b.age - a.age);
  const priority: Priority = people.some((person) => person.priority === "elderly_80")
    ? "elderly_80"
    : people.length > 0
      ? "elderly"
      : "none";
  return { rule: SPECIFICITIES_RULE, priority, people, grounds: priority === "none" ? [] : GROUNDS[priority] };
}
