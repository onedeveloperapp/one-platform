import assert from "node:assert/strict";
import test from "node:test";

import { cnjCheckDigits, composeCnj, formatCnj, isValidCnj, parseCnj } from "./cnj.ts";
import {
  arrivalDelayMinutes,
  formatFlightNumber,
  isAirlineDesignator,
  normalizeAirportCode,
  normalizeBookingReference,
  parseFlightNumber,
} from "./flight.ts";
import { formatOab, parseOab } from "./oab.ts";
import { ageOn, formatDayBr, isMinorOn, parseDayBr, readDay } from "./person.ts";

/**
 * The check digits computed the second way Annex VIII of Resolução CNJ
 * 65/2008 describes (V: in three steps, for machines without the precision
 * for 20 digits), with plain numbers. It is written apart from `cnj.ts`, so
 * the two have to agree.
 */
function annexFactored(sequence: string, yearSegmentCourt: string, origin: string): string {
  const r1 = Number(sequence) % 97;
  const r2 = Number(`${r1}${yearSegmentCourt}`) % 97;
  const r3 = Number(`${r2}${origin}00`) % 97;
  return String(98 - r3).padStart(2, "0");
}

// Every number here is made by the rule itself: no real case's number is in a test.
test("the check digits follow Annex VIII, computed whole or in its three steps", () => {
  for (const [sequence, year, court, origin] of [
    ["0000001", "2026", "09", "0051"],
    ["1234567", "2025", "26", "0100"],
    ["9999999", "2008", "07", "0000"],
    ["0004200", "2024", "19", "0001"],
    ["5012345", "2026", "16", "0014"],
  ]) {
    const whole = cnjCheckDigits(`${sequence}${year}8${court}${origin}`);
    assert.equal(whole, annexFactored(sequence, `${year}8${court}`, origin), `${sequence} ${court}`);
    // VI: the whole number with its check digits at the end, modulo 97, is 1.
    assert.equal(BigInt(`${sequence}${year}8${court}${origin}${whole}`) % 97n, 1n);
  }
});

test("a number is read with or without its mask, and one with a wrong digit is not a number", () => {
  const digits = composeCnj({ sequence: 1234567, year: 2026, court: "09", origin: 51 });
  assert.equal(digits.length, 20);
  const masked = formatCnj(digits);
  assert.match(masked ?? "", /^1234567-\d{2}\.2026\.8\.09\.0051$/);
  assert.deepEqual(parseCnj(masked), parseCnj(` ${digits} `));
  assert.deepEqual(
    (({ sequence, year, segment, court, origin }) => ({ sequence, year, segment, court, origin }))(parseCnj(digits)!),
    { sequence: "1234567", year: "2026", segment: "8", court: "09", origin: "0051" },
  );

  // Every single digit changed, anywhere, breaks the check.
  for (let position = 0; position < 20; position += 1) {
    const wrong = digits.slice(0, position) + String((Number(digits[position]) + 1) % 10) + digits.slice(position + 1);
    assert.equal(isValidCnj(wrong), false, `position ${position}`);
  }
  // So does swapping two neighbours, the commonest typing slip.
  const swapped = digits.slice(0, 2) + digits[3] + digits[2] + digits.slice(4);
  if (swapped !== digits) assert.equal(isValidCnj(swapped), false);

  for (const nothing of [null, undefined, "", "123", "1234567-89.2026.8.09", "a".repeat(20)]) {
    assert.equal(parseCnj(nothing), null);
    assert.equal(formatCnj(nothing), null);
  }
  assert.throws(() => cnjCheckDigits("123"));
});

test("a flight is the designator and up to four digits, as tickets print it", () => {
  assert.deepEqual(parseFlightNumber("g3 1234"), { airline: "G3", number: "1234", suffix: null, normalized: "G31234" });
  assert.deepEqual(parseFlightNumber("AD-04512"), { airline: "AD", number: "4512", suffix: null, normalized: "AD4512" });
  assert.deepEqual(parseFlightNumber("2Z 2201a"), { airline: "2Z", number: "2201", suffix: "A", normalized: "2Z2201A" });
  assert.equal(formatFlightNumber("la3500"), "LA 3500");
  for (const wrong of ["", "1234", "12 345", "G3", "G3 0", "G3 12345", "GOL 1234", "G3 12AB"]) {
    assert.equal(parseFlightNumber(wrong), null, wrong);
  }
  assert.equal(isAirlineDesignator("G3"), true);
  assert.equal(isAirlineDesignator("22"), false);
  assert.equal(isAirlineDesignator("g3"), false);

  assert.equal(normalizeAirportCode(" gyn "), "GYN");
  for (const wrong of ["GY", "GYNA", "G1N", "", null]) assert.equal(normalizeAirportCode(wrong), null);
  assert.equal(normalizeBookingReference("abc 123"), "ABC123");
  assert.equal(normalizeBookingReference("AB1"), null);
});

test("a delay is measured between the scheduled and the actual arrival at the same airport", () => {
  assert.equal(arrivalDelayMinutes("2026-10-06T14:30", "2026-10-06T19:05"), 275);
  // Across midnight, and early.
  assert.equal(arrivalDelayMinutes("2026-10-06T23:40", "2026-10-07T04:10"), 270);
  assert.equal(arrivalDelayMinutes("2026-10-06T14:30", "2026-10-06T14:10"), -20);
  assert.equal(arrivalDelayMinutes(null, "2026-10-06T14:10"), null);
  assert.equal(arrivalDelayMinutes("ontem", "2026-10-06T14:10"), null);
});

test("a registration at the bar is read however it is typed, and written as the bar writes it", () => {
  for (const typed of ["OAB/GO 12.345", "go 12345", "12345/GO", "OAB GO 012345", "GO-12.345"]) {
    assert.deepEqual(parseOab(typed), { uf: "GO", number: "12345" }, typed);
  }
  assert.deepEqual(parseOab("OAB/SP 123.456-A"), { uf: "SP", number: "123456A" });
  assert.equal(formatOab({ uf: "SP", number: "123456A" }), "OAB/SP 123.456-A");
  assert.equal(formatOab({ uf: "GO", number: "1001" }), "OAB/GO 1.001");
  for (const wrong of ["", "12345", "XX 12345", "GO 0", "GO 12345678", "GO ABC"]) {
    assert.equal(parseOab(wrong), null, wrong);
  }
});

test("age is counted in full years on a day, and under 18 is a minor", () => {
  assert.equal(ageOn("2008-10-09", "2026-10-09"), 18);
  assert.equal(ageOn("2008-10-10", "2026-10-09"), 17);
  assert.equal(isMinorOn("2008-10-10", "2026-10-09"), true);
  assert.equal(isMinorOn("2008-10-09", "2026-10-09"), false);
  // Born on 29 February: a year more on 1 March of a common year.
  assert.equal(ageOn("2008-02-29", "2026-02-28"), 17);
  assert.equal(ageOn("2008-02-29", "2026-03-01"), 18);
  assert.equal(ageOn("2026-10-10", "2026-10-09"), null);
  assert.equal(isMinorOn("2026-02-30", "2026-10-09"), null);
  assert.equal(readDay("2026-02-29"), null);
  assert.equal(formatDayBr("2026-10-06"), "06/10/2026");
  assert.equal(parseDayBr("6/10/2026"), "2026-10-06");
  assert.equal(parseDayBr("31/02/2026"), null);
});
