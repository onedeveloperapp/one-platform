import { chronologyTimeline, moneyParts } from "./chronology";
import { describe, expect, it } from "vitest";

// An invented trip, written as ONE writes a chronology: one fact per line, the day and the moment at its start.
const LINES = [
  "12/03/2025, 10:30: horário previsto de saída do voo ZX786 de São Paulo para Doha.",
  "12/03/2025, 11:08: o voo ZX786 saiu de São Paulo com atraso, segundo o registro da ANAC.",
  "O voo de São Paulo para Doha tinha conexão de 55 minutos em Doha.",
  "13/03/2025, 01:07: o voo ZX786 chegou a Doha, segundo o registro da ANAC.",
  "O cliente gastou R$ 31,40 com alimentação.",
  "13/03/2025: a chegada a Istambul estava prevista para 11:55.",
  "13/03/2025, depois das 18:35: chegou a Istambul, com cerca de 7 horas de atraso.",
  "O cliente tem mobilidade reduzida e usa bengala.",
];

describe("the chronology as a timeline", () => {
  it("groups the facts by day, each with its moment, and keeps every line in ONE's order", () => {
    const days = chronologyTimeline(LINES);
    expect(days.map((day) => day.day)).toEqual(["12/03/2025", "13/03/2025"]);
    expect(days[0].events.map((event) => [event.time, event.marked])).toEqual([
      ["10:30", true],
      ["11:08", true],
      [null, false],
    ]);
    expect(days[1].events.map((event) => event.time)).toEqual(["01:07", null, null, "depois das 18:35", null]);
    expect(days.flatMap((day) => day.events)).toHaveLength(LINES.length);
  });

  it("takes the day and the moment out of the fact, and starts it with a capital", () => {
    const [first] = chronologyTimeline(LINES)[0].events;
    expect(first.text).toBe("Horário previsto de saída do voo ZX786 de São Paulo para Doha.");
    // A day with no hour is a fact of that day, drawn as a smaller point: no hour stands empty beside it.
    const dayOnly = chronologyTimeline(LINES)[1].events[2];
    expect(dayOnly).toEqual({
      time: null,
      marked: false,
      text: "A chegada a Istambul estava prevista para 11:55.",
      record: false,
    });
  });

  it("marks what came from ANAC's record and takes those words out of the sentence", () => {
    const [, second] = chronologyTimeline(LINES)[0].events;
    expect(second.record).toBe(true);
    expect(second.text).toBe("O voo ZX786 saiu de São Paulo com atraso.");
  });

  it("keeps a line it cannot read whole, and what comes before any day apart", () => {
    const days = chronologyTimeline(["O cliente comprou a passagem pela internet.", "10:15: embarcou.", "", "  "]);
    expect(days).toEqual([
      {
        day: null,
        events: [
          { time: null, marked: false, text: "O cliente comprou a passagem pela internet.", record: false },
          { time: "10:15", marked: true, text: "Embarcou.", record: false },
        ],
      },
    ]);
  });

  it("sets an amount of money apart for the screen to stress it", () => {
    expect(moneyParts("O cliente gastou R$ 31,40 com alimentação.")).toEqual([
      { text: "O cliente gastou ", money: false },
      { text: "R$ 31,40", money: true },
      { text: " com alimentação.", money: false },
    ]);
    expect(moneyParts("Sem valor.")).toEqual([{ text: "Sem valor.", money: false }]);
  });
});
