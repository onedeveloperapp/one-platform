import { caseForecastOf, forecastOf, hasForecast, monthlyChance, offerPlace, shareWords } from "./forecast";
import { describe, expect, it } from "vitest";

// What `case_forecast` (0250) answers, invented: a judge's 35 cancellations against an airline.
const RAW = {
  proceeding: "f2500000-0000-4000-8000-000000000001",
  stage: "distributed",
  problem: "cancellation",
  airline: "AD",
  court: "TJGO",
  comarca: "Goiânia",
  unit: "Goiânia - 9ª UPJ Juizados Especiais Cíveis",
  judge: "Ana Paula Exemplo",
  claimants: 2,
  expected_cents: 688000,
  forecast: {
    cut: { level: "judge", court: "TJGO", judge: "Ana Paula Exemplo", airline: "AD", problem: "cancellation" },
    decisions: 35,
    merits: 35,
    won: 30,
    chance_percent: 86,
    outcomes: { procedente: 0, parcial: 30, improcedente: 5, acordo: 0, extinto: 0 },
    base: "media",
    from: "2026-05-15",
    to: "2026-11-13",
    courts: ["TJGO"],
    moral: { n: 3, p25_cents: 300000, median_cents: 400000, p75_cents: 500000, values: [500000, 300000, 400000] },
    extinctions: { ausencia_autor: 3, desistencia: 0 },
    months: [
      { month: "2026-10", merits: 4, won: 4 },
      { month: "2026-11", merits: 10, won: 8 },
    ],
  },
  levels: [
    { cut: { level: "unit", problem: "cancellation" }, merits: 55, won: 50, chance_percent: 91, median_cents: 400000 },
  ],
  hearing: { level: "unit", decisions: 61, acordo: 2, extinto: 4, reasons: { ausencia_autor: 3, desistencia: 1 } },
};

describe("the forecast of a lawsuit", () => {
  it("reads the database's answer, the values in order and the reasons that happened", () => {
    const read = caseForecastOf(RAW);
    expect(read?.stage).toBe("distributed");
    expect(read?.forecast?.cut.level).toBe("judge");
    expect(read?.forecast?.chancePercent).toBe(86);
    expect(read?.forecast?.moral.values).toEqual([300000, 400000, 500000]);
    expect(read?.forecast?.extinctions).toEqual({ ausencia_autor: 3 });
    expect(read?.levels[0]).toMatchObject({ level: "unit", chancePercent: 91, median: 400000 });
    expect(read?.hearing).toMatchObject({ level: "unit", acordo: 2, reasons: { ausencia_autor: 3, desistencia: 1 } });
    expect(hasForecast(read)).toBe(true);
  });

  it("reads the place inside the comarca and the kind of lawsuit each cut reads (0310)", () => {
    const read = caseForecastOf({
      ...RAW,
      stage: "before",
      kind: "juizado",
      court: "TJRJ",
      comarca: "Rio de Janeiro",
      place: "Lagoa",
      unit: null,
      judge: null,
      forecast: {
        ...RAW.forecast,
        cut: {
          level: "place",
          court: "TJRJ",
          comarca: "Rio de Janeiro",
          place: "Lagoa",
          kind: "juizado",
          problem: "cancellation",
        },
      },
      levels: [
        {
          cut: { level: "comarca", comarca: "Rio de Janeiro", kind: "juizado", problem: "cancellation" },
          merits: 42,
          won: 28,
        },
      ],
      hearing: { level: "place", decisions: 32, acordo: 0, extinto: 0, reasons: {} },
    });
    expect(read).toMatchObject({ kind: "juizado", place: "Lagoa", stage: "before" });
    expect(read?.forecast?.cut).toMatchObject({ level: "place", place: "Lagoa", kind: "juizado" });
    expect(read?.levels[0]).toMatchObject({ level: "comarca", cut: { kind: "juizado" } });
    expect(read?.hearing?.level).toBe("place");
    // A kind the database does not know is no kind; an older answer without one reads as none.
    expect(caseForecastOf({ ...RAW, kind: "federal" })?.kind).toBeNull();
    expect(caseForecastOf(RAW)?.forecast?.cut.kind).toBeNull();
  });

  it("says nothing of a lawsuit with no forecast, nor of an answer that is none", () => {
    expect(caseForecastOf(null)).toBeNull();
    expect(forecastOf({})).toBeNull();
    expect(hasForecast(caseForecastOf({ ...RAW, forecast: null }))).toBe(false);
  });

  it("places an offer among the values set: how many were the offer or more", () => {
    expect(offerPlace([300000, 400000, 500000], 250000)).toEqual({ atOrAbove: 3, of: 3 });
    expect(offerPlace([300000, 400000, 500000], 400000)).toEqual({ atOrAbove: 2, of: 3 });
    expect(offerPlace([], 250000)).toBeNull();
    expect(offerPlace([300000], null)).toBeNull();
  });

  it("says a share as a plain fraction, never a decimal", () => {
    expect(shareWords(92, 142)).toEqual({ part: 2, of: 3 });
    expect(shareWords(89, 100)).toEqual({ part: 9, of: 10 });
    expect(shareWords(26, 100)).toEqual({ part: 1, of: 4 });
    expect(shareWords(0, 10)).toBeNull();
    expect(shareWords(10, 10)).toBeNull();
  });

  it("draws a month's chance only with its sample", () => {
    expect(monthlyChance(forecastOf(RAW.forecast)?.months ?? [])).toEqual([{ month: "2026-11", percent: 80 }]);
  });
});
