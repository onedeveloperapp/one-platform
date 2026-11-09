import { describe, expect, it } from "vitest";

import {
  changedMinutes,
  estimatesErrorKey,
  estimatesInputOf,
  hourCentsText,
  minutesDraftOf,
  typedHourCents,
  typedMinutes,
} from "@/lib/one-work/estimates";
import type { OneWorkKind } from "@/lib/one-work/work";

const kinds: OneWorkKind[] = [
  { key: "texto_peca", family: "pecas", defaultMinutes: 30, minutes: 45, own: true },
  { key: "foto_pdf", family: "documentos", defaultMinutes: 1, minutes: 1, own: false },
  { key: "documento_conferido", family: "documentos", defaultMinutes: 3, minutes: 3, own: false },
];

describe("the firm's estimates as the panel edits them", () => {
  it("opens with the firm's own minutes, and blank where it follows ONE's", () => {
    expect(minutesDraftOf(kinds)).toEqual({ texto_peca: "45", foto_pdf: "", documento_conferido: "" });
  });

  it("sends only what changed: a new number, and a blank of the firm's own back to ONE's", () => {
    expect(changedMinutes(kinds, { texto_peca: "45", foto_pdf: "", documento_conferido: "" })).toEqual({});
    expect(changedMinutes(kinds, { texto_peca: "", foto_pdf: "2", documento_conferido: "3" })).toEqual({
      texto_peca: null,
      foto_pdf: 2,
    });
    // A field that holds no number of minutes stops the save.
    expect(changedMinutes(kinds, { texto_peca: "dez", foto_pdf: "", documento_conferido: "" })).toBeUndefined();
    expect(changedMinutes(kinds, { texto_peca: "601", foto_pdf: "", documento_conferido: "" })).toBeUndefined();
  });

  it("reads the minutes typed and the cost of an hour the money field reports", () => {
    expect(typedMinutes(" 15 ")).toBe(15);
    expect(typedMinutes("")).toBeNull();
    expect(typedMinutes("1,5")).toBeUndefined();
    expect(typedHourCents("150.5")).toBe(15050);
    expect(typedHourCents("")).toBeNull();
    expect(typedHourCents("0")).toBeUndefined();
    expect(typedHourCents("100000.01")).toBeUndefined();
    expect(hourCentsText(15050)).toBe("150.5");
    expect(hourCentsText(null)).toBe("");
  });

  it("checks a request before the database checks it again", () => {
    expect(estimatesInputOf({ minutes: { texto_peca: 45, foto_pdf: null }, setCost: true, hourCents: 15000 })).toEqual({
      ok: true,
      minutes: { texto_peca: 45, foto_pdf: null },
      setCost: true,
      hourCents: 15000,
    });
    expect(estimatesInputOf({ minutes: { texto_peca: 700 } })).toEqual({ ok: false, code: "minutes" });
    expect(estimatesInputOf({ minutes: { "drop table": 1 } })).toEqual({ ok: false, code: "kind" });
    expect(estimatesInputOf({ minutes: {}, setCost: true, hourCents: 0 })).toEqual({ ok: false, code: "cost" });
    // A cost not asked to change is never sent.
    expect(estimatesInputOf({ minutes: {}, setCost: false, hourCents: 15000 })).toMatchObject({ hourCents: null });
    expect(estimatesErrorKey("not_allowed")).toBe("one-work-error-not-allowed");
    expect(estimatesErrorKey("x")).toBe("one-work-error-failed");
  });
});
