import assert from "node:assert/strict";
import test from "node:test";

import { specificitiesOf, SPECIFICITIES_RULE } from "./specificities.ts";

// Every person here is invented.

const TODAY = "2099-10-22";

test("a claimant of 60 or more has the priority of processing, one of 80 or more the special one", () => {
  assert.deepEqual(specificitiesOf([{ name: "Ana", birthDate: "2039-10-22" }], TODAY), {
    rule: SPECIFICITIES_RULE,
    priority: "elderly",
    people: [{ name: "Ana", age: 60, priority: "elderly" }],
    grounds: ["Lei 10.741/2003, art. 71", "CPC, art. 1.048, I"],
  });
  const both = specificitiesOf(
    [
      { name: "Ana", birthDate: "2035-01-01" },
      { name: "Rui", birthDate: "2018-05-01" },
      { name: "Lia", birthDate: "2019-10-21" },
    ],
    TODAY,
  );
  assert.equal(both.priority, "elderly_80");
  assert.deepEqual(
    both.people.map((person) => [person.name, person.priority]),
    [
      ["Rui", "elderly_80"],
      ["Lia", "elderly_80"],
      ["Ana", "elderly"],
    ],
  );
  assert.deepEqual(both.grounds, ["Lei 10.741/2003, art. 71, § 5º", "CPC, art. 1.048, I"]);
});

test("a day short of 60, or no birth date, is no priority", () => {
  assert.equal(specificitiesOf([{ name: "Ana", birthDate: "2039-10-23" }], TODAY).priority, "none");
  assert.deepEqual(specificitiesOf([{ name: "Rui", birthDate: null }], TODAY), {
    rule: SPECIFICITIES_RULE,
    priority: "none",
    people: [],
    grounds: [],
  });
});
