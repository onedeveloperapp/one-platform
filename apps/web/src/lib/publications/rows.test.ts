import { describe, expect, it } from "vitest";

import type { PublicationRow } from "@/lib/publications/facts";
import { orderPublications, publicationLine, type PublicationSeen } from "@/lib/publications/rows";

const base: PublicationRow = {
  id: "p1",
  court: "TJGO",
  cnj: "50012345620998090051",
  availableOn: "2026-11-07",
  kind: "Intimação",
  documentType: "Despacho",
  unit: "1º Juizado Especial Cível de Goiânia",
  className: null,
  head: "Intime-se a parte autora.",
  tail: null,
  truncated: false,
  link: null,
  certificateUrl: "https://comunica.pje.jus.br/certidao/p1",
  active: true,
  cancelReason: null,
  cancelledLabel: null,
  cancelUnseen: false,
  lawyers: ["Ana Souza"],
  caseId: "c1",
  caseSeq: 42,
  proceedingId: "lw",
  proceedingKind: "juizado",
  hearings: [],
  deadlines: [],
  readings: [],
  anyDeadline: false,
  hearingSettled: false,
  category: "ciencia",
  note: null,
  triagedBy: null,
  triagedLabel: "07/11",
  byAi: false,
  reviewDue: false,
  reviewedBy: null,
  reviewedLabel: null,
  ackOwed: false,
  ackedBy: null,
  ackedLabel: null,
  triageState: null,
  judgment: null,
};
const nothing: PublicationSeen = { said: null, seenCancel: false, acked: false };
const row = (change: Partial<PublicationRow>): PublicationRow => ({ ...base, ...change });

describe("publicationLine", () => {
  it("asks for the awareness of ONE's triage, given in place, from the lawyers it was addressed to", () => {
    const line = publicationLine(row({ category: "prazo", ackOwed: true }), nothing);
    expect(line).toMatchObject({ place: "ask", action: "ack", key: "case-rows-pub-ack" });
    expect(line.values.names).toBe("Ana Souza");
    // Given here, it is settled.
    expect(publicationLine(row({ category: "prazo", ackOwed: true }), { ...nothing, acked: true }).place).toBe("done");
  });

  it("asks for a triage ONE left to a person, and waits while ONE triages", () => {
    expect(publicationLine(row({ category: null, triageState: "left" }), nothing)).toMatchObject({
      place: "ask",
      key: "case-rows-pub-untriaged-left",
      action: "open",
    });
    expect(publicationLine(row({ category: null, triageState: "working" }), nothing).place).toBe("working");
    // Triaged here since the case was read: it leaves the questions.
    const said = { category: "ciencia" as const, note: null };
    expect(publicationLine(row({ category: null }), { ...nothing, said }).place).toBe("done");
  });

  it("asks whether a decision is the judgment only while nobody could tell", () => {
    expect(publicationLine(row({ category: "decisao" }), nothing).key).toBe("case-rows-pub-judgment");
    expect(publicationLine(row({ category: "decisao", judgment: { value: true, source: "rule" } }), nothing).key).toBe(
      "case-rows-pub-judgment-yes",
    );
  });

  it("asks for what ONE left to a person until it was done by hand, and waits while ONE reads", () => {
    const left = row({
      category: "prazo",
      readings: [{ kind: "deadline", status: "unread", reason: "several_terms" }],
    });
    expect(publicationLine(left, nothing)).toMatchObject({ place: "ask", key: "case-rows-pub-left-deadline" });
    expect(publicationLine({ ...left, anyDeadline: true }, nothing).place).toBe("done");
    const reading = row({ category: "audiencia", readings: [{ kind: "hearing", status: "due", reason: null }] });
    expect(publicationLine(reading, nothing)).toMatchObject({ place: "working", key: "case-rows-pub-reading-hearing" });
  });

  it("says what came of a settled one: the hearing, the deadline, who saw it", () => {
    const hearing = row({
      category: "audiencia",
      hearings: [
        { id: "h", startsAt: "2026-11-20T17:00:00Z", timeZone: "America/Sao_Paulo", status: "scheduled", auto: true },
      ],
    });
    expect(publicationLine(hearing, nothing)).toMatchObject({
      place: "done",
      key: "case-rows-pub-hearing",
      values: { day: "20/11", time: "14:00" },
    });
    const deadline = row({
      category: "prazo",
      deadlines: [
        { id: "d", title: "Réplica", status: "confirmed", dueOn: "2026-11-28", urgentOn: "2026-11-28", auto: true },
      ],
    });
    expect(publicationLine(deadline, nothing)).toMatchObject({
      key: "case-rows-pub-deadline",
      values: { day: "28/11" },
    });
    expect(publicationLine(row({ ackedBy: "Ana Souza" }), nothing)).toMatchObject({
      key: "case-rows-pub-acked",
      values: { name: "Ana Souza" },
    });
  });

  it("asks to say the court's cancelling was seen, and settles it once seen", () => {
    expect(publicationLine(row({ active: false, cancelUnseen: true }), nothing).place).toBe("ask");
    expect(publicationLine(row({ active: false, cancelUnseen: true }), { ...nothing, seenCancel: true }).place).toBe(
      "done",
    );
  });
});

describe("orderPublications", () => {
  it("puts what asks first, the oldest first, then ONE's work, then the rest, the newest first", () => {
    const items = [
      { row: row({ id: "a", availableOn: "2026-11-09" }), line: publicationLine(row({}), nothing) },
      {
        row: row({ id: "b", availableOn: "2026-11-08", category: null }),
        line: publicationLine(row({ category: null }), nothing),
      },
      {
        row: row({ id: "c", availableOn: "2026-11-06", category: null }),
        line: publicationLine(row({ category: null }), nothing),
      },
      { row: row({ id: "d", availableOn: "2026-11-10" }), line: publicationLine(row({}), nothing) },
    ];
    const ordered = orderPublications(items);
    expect(ordered.ask.map((item) => item.row.id)).toEqual(["c", "b"]);
    expect(ordered.done.map((item) => item.row.id)).toEqual(["d", "a"]);
  });
});
