import { CLEAR_COUNT_KEYS, clearPreviewOf, clearResultOf, clearsAnything, isClearWord } from "./clear-data";
import { describe, expect, it } from "vitest";

const zero = Object.fromEntries(CLEAR_COUNT_KEYS.map((key) => [key, 0]));

describe("clearing the firm's data", () => {
  it("takes the word whatever its case and the spaces around it", () => {
    expect(isClearWord(" Apagar ")).toBe(true);
    expect(isClearWord("APAGAR")).toBe(true);
    expect(isClearWord("apaga")).toBe(false);
    expect(isClearWord("apagar tudo")).toBe(false);
  });

  it("reads the confirmation's counts, and a refusal by its code", () => {
    expect(clearPreviewOf({ ok: true, second_factor: false, counts: { ...zero, cases: 3 } })).toEqual({
      ok: true,
      secondFactor: false,
      counts: { ...zero, cases: 3 },
    });
    expect(clearPreviewOf({ ok: false, code: "not_allowed" })).toEqual({ ok: false, code: "not_allowed" });
    expect(clearPreviewOf({ ok: false, code: "something_new" })).toEqual({ ok: false, code: "failed" });
    // A count that is not one is never shown as a number.
    expect(clearPreviewOf({ ok: true, counts: { ...zero, people: "x" } })).toEqual({ ok: false, code: "failed" });
    expect(clearPreviewOf(null)).toEqual({ ok: false, code: "failed" });
  });

  it("keeps only the storage paths of the firm's files", () => {
    const { result, paths } = clearResultOf({
      ok: true,
      counts: { ...zero, cases: 1, files: 2 },
      paths: ["org/a/upload/b", "../etc", 7],
    });
    expect(result).toEqual({ ok: true, counts: { ...zero, cases: 1 }, files: 2 });
    expect(paths).toEqual(["org/a/upload/b"]);
    expect(clearResultOf({ ok: false, code: "confirm_missing" }).result).toEqual({
      ok: false,
      code: "confirm_missing",
    });
  });

  it("knows a firm with nothing to clear", () => {
    expect(clearsAnything(zero as never)).toBe(false);
    expect(clearsAnything({ ...zero, agency_passengers: 1 } as never)).toBe(true);
  });
});
