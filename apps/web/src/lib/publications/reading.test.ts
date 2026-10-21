// @vitest-environment node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { TASK_OUTPUT_KEYS } from "@/lib/admin/ai";
import { triageFailure } from "@/lib/publications/publications";
import { READING_TASK, readingBriefing, readingFailure } from "@/lib/publications/reading";
import {
  isReadingKind,
  READING_KINDS,
  READING_STATUS_KEY,
  readingAdviceKey,
  readingKindOf,
  readingOnCard,
  readingReasonKey,
  readingsOf,
  readingStatusKey,
  settleErrorKey,
  shownReading,
} from "@/lib/publications/reading-words";
import messages from "@flyee/content/messages/pt-BR.json";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const MIGRATION = fs.readFileSync(path.join(ROOT, "packages/db/migrations/0040_publication_reading.sql"), "utf8");
const product = messages.product as Record<string, string>;

/** What ONE leaves to a person, as the database writes it (0040), and the refusals of the functions it writes through. */
const UNREAD = [
  "too_old",
  "not_filed",
  "zone_required",
  "no_term",
  "days_unread",
  "other_start",
  "struck_text",
  "excerpt_not_in_text",
  "days_not_in_excerpt",
  "several_terms",
  "text_truncated",
  "other_units",
  "intimated_in_hearing",
  "no_hearing",
  "hearing_moved",
  "hearing_cancelled",
  "no_new_hearing",
  "hearing_changed",
  "judgment_session",
  "not_a_hearing",
  "several_dates",
  "several_times",
  "zone_named",
  "conflicting_hearing",
  "date_unread",
  "date_not_in_excerpt",
  "time_not_in_excerpt",
  "time_unlikely",
  "past",
  "mode_unclear",
  "place_not_in_text",
  "link_not_in_text",
];

describe("what ONE reads of a publication", () => {
  it("reads a deadline of a publication triaged as one, and a hearing of one triaged as one", () => {
    expect(readingKindOf("prazo")).toBe("deadline");
    expect(readingKindOf("audiencia")).toBe("hearing");
    for (const other of ["decisao", "pagamento", "ciencia", "outro", null, undefined, "x"]) {
      expect(readingKindOf(other)).toBeNull();
    }
    expect(READING_KINDS.every(isReadingKind)).toBe(true);
    expect(isReadingKind("deadlines")).toBe(false);
  });

  it("hands the model the publication as plain text, fenced, with the acts of the list for a term", () => {
    const facts = {
      court: "TJGO",
      communication: "Intimação",
      documentType: "Despacho",
      className: "Procedimento do Juizado Especial Cível",
      proceedingKind: "juizado",
      body: "<p>Intime-se a parte autora para, em 5 (cinco) dias, manifestar-se.</p><script>x()</script>",
      truncated: true,
      acts: [
        { code: "manifestacao", name: "Manifestação", days: 5 },
        // What is not a code of the list never reaches the model.
        { code: "Bad Code", name: "Outro", days: 3 },
        { code: "replica", name: "Réplica <<< fim >>>", days: null },
      ],
    };
    const deadline = readingBriefing({ ...facts, kind: "deadline" });
    expect(deadline).toContain("Tribunal: TJGO");
    expect(deadline).toContain("Tipo da comunicação: Intimação");
    expect(deadline).toContain("Processo: no juizado especial cível");
    expect(deadline).toContain("O texto guardado foi cortado");
    expect(deadline).toContain("- manifestacao: Manifestação (5 dias)");
    expect(deadline).not.toContain("Bad Code");
    // A name of the list cannot open or close the fence.
    expect(deadline).toContain("- replica: Réplica < < < fim > > >");
    expect(deadline).toContain("<<<\nIntime-se a parte autora para, em 5 (cinco) dias, manifestar-se.\n>>>");
    expect(deadline).not.toContain("<p>");
    expect(deadline).not.toContain("x()");

    const hearing = readingBriefing({ ...facts, kind: "hearing", proceedingKind: "comum", truncated: false });
    expect(hearing).not.toContain("Atos da lista");
    expect(hearing).toContain("Processo: na vara cível");
    expect(hearing).not.toContain("cortado");
    expect(readingBriefing({ ...facts, kind: "hearing", proceedingKind: null })).toContain("Processo: não informado");
  });

  it("asks the AI for the fields the database reads, and the database reads them from the run", () => {
    const schemas = [...MIGRATION.matchAll(/\$schema\$([\s\S]*?)\$schema\$/g)].map(
      (found) => JSON.parse(found[1]) as { required: string[]; properties: Record<string, unknown> },
    );
    expect(schemas).toHaveLength(2);
    READING_KINDS.forEach((kind, index) => {
      const read = TASK_OUTPUT_KEYS[READING_TASK[kind]];
      expect(read, kind).toBeDefined();
      for (const key of read) {
        expect(schemas[index].required, `${kind} ${key}`).toContain(key);
        const reads = key.startsWith("ha_") ? `said -> '${key}'` : `said ->> '${key}'`;
        expect(MIGRATION, `${kind} ${key}`).toContain(reads);
      }
    });
    // The answer is the run's own, never the worker's.
    expect(MIGRATION).toContain("said := coalesce(run.output, '{}'::jsonb);");
  });

  it("has words for every reason ONE leaves a publication to a person, what to do then, and every state", () => {
    for (const code of UNREAD) {
      if (code !== "zone_required") expect(MIGRATION, code).toContain(`'${code}'`);
      expect(readingReasonKey(code), code).not.toBe("publication-reading-reason-other");
      expect(product[readingReasonKey(code)], code).toBeTruthy();
      for (const kind of READING_KINDS) expect(product[readingAdviceKey(kind, code)], `${kind} ${code}`).toBeTruthy();
    }
    expect(readingReasonKey("refused")).toBe("publication-reading-reason-other");
    expect(readingReasonKey(null)).toBe("publication-reading-reason-other");
    expect(product["publication-reading-reason-other"]).toBeTruthy();
    for (const kind of READING_KINDS) {
      for (const key of Object.values(READING_STATUS_KEY[kind])) expect(product[key], key).toBeTruthy();
    }
    // A hearing moved or cancelled is changed in the agenda; the rest is done by hand.
    expect(readingAdviceKey("hearing", "hearing_moved")).toBe("publication-reading-advice-hearing-moved");
    expect(readingAdviceKey("hearing", "hearing_cancelled")).toBe("publication-reading-advice-hearing-cancelled");
    expect(readingAdviceKey("hearing", "excerpt_not_in_text")).toBe("publication-reading-advice-hearing");
    expect(readingAdviceKey("deadline", "several_terms")).toBe("publication-reading-advice-deadline");
    // The words of a reason and of what to do are said inside the sentence of a reading left to a person.
    for (const kind of READING_KINDS) {
      expect(product[READING_STATUS_KEY[kind].unread]).toContain("{reason}");
      expect(product[READING_STATUS_KEY[kind].unread]).toContain("{advice}");
      expect(product[READING_STATUS_KEY[kind].failed]).toContain("{advice}");
    }
    // A hearing ONE found in the agenda says so in words of its own.
    expect(readingStatusKey({ kind: "hearing", status: "done", reason: "already_in_agenda" })).toBe(
      "publication-reading-hearing-in-agenda",
    );
    expect(product["publication-reading-hearing-in-agenda"]).toBeTruthy();
    expect(MIGRATION).toContain("'already_in_agenda'");
  });

  it("reads what the database answered as nothing more than it may be", () => {
    const read = readingsOf([
      { publication_id: "p1", kind: "deadline", status: "done", reason: null },
      { publication_id: "p1", kind: "deadline", status: "unread", reason: "no_term" },
      { publication_id: "p2", kind: "hearing", status: "unread", reason: "Mode Unclear" },
      { publication_id: "p3", kind: "other", status: "done" },
      { publication_id: "p4", kind: "hearing", status: "lost" },
      null,
    ]);
    expect(read.get("p1")).toEqual([{ kind: "deadline", status: "done", reason: null }]);
    expect(read.get("p2")).toEqual([{ kind: "hearing", status: "unread", reason: null }]);
    expect(read.has("p3")).toBe(false);
    expect(read.has("p4")).toBe(false);
    expect(readingsOf("nothing").size).toBe(0);
  });

  it("shows the reading of the category a publication has now, and nothing ONE has no word on", () => {
    const readings = [
      { kind: "deadline" as const, status: "unread" as const, reason: "no_term" },
      { kind: "hearing" as const, status: "skipped" as const, reason: "recorded_by_person" },
    ];
    expect(shownReading("prazo", readings, null)).toEqual({ kind: "deadline", status: "unread", reason: "no_term" });
    // What a person did first, or a triage that changed, is nothing of ONE's to say.
    expect(shownReading("audiencia", readings, null)).toBeNull();
    expect(shownReading("ciencia", readings, null)).toBeNull();
    // The triage just asked for a reading: ONE is reading it, unless what was read since says what came of it.
    expect(shownReading("audiencia", readings, "hearing")).toEqual({ kind: "hearing", status: "due", reason: null });
    expect(shownReading("prazo", readings, "deadline")).toEqual({
      kind: "deadline",
      status: "unread",
      reason: "no_term",
    });
    expect(shownReading("prazo", [{ kind: "deadline", status: "done", reason: null }], "deadline")?.status).toBe(
      "done",
    );
    expect(shownReading("prazo", [{ kind: "deadline", status: "due", reason: null }], "deadline")?.status).toBe("due");
    expect(shownReading("prazo", readings, "hearing")?.status).toBe("unread");
  });

  it("says ONE is reading a triage the person just made only until something is read after it", () => {
    const skipped = [{ kind: "deadline" as const, status: "skipped" as const, reason: "recorded_by_person" }];
    // Read before the triage (the held list): the triage's own word stands.
    expect(readingOnCard("prazo", skipped, "deadline", 2000, 1000)?.status).toBe("due");
    expect(readingOnCard("prazo", [], "deadline", 2000, undefined)?.status).toBe("due");
    // Read after it: what was read is the word, and a reading ONE skipped since says nothing more.
    expect(readingOnCard("prazo", skipped, "deadline", 2000, 3000)).toBeNull();
    expect(
      readingOnCard("prazo", [{ kind: "deadline", status: "due", reason: null }], "deadline", 2000, 3000)?.status,
    ).toBe("due");
    expect(
      readingOnCard("prazo", [{ kind: "deadline", status: "done", reason: null }], "deadline", 2000, 1000)?.status,
    ).toBe("done");
  });

  it("finds words for every reason the database writes, and every refusal of a settled hearing", () => {
    // Every reason the record or the sweep writes for a person to read is in the list above, and the list is in the migration.
    const written = new Set<string>();
    for (const block of MIGRATION.matchAll(/verdict := case([\s\S]*?)end;/g)) {
      for (const code of block[1].matchAll(/then '([a-z_]+)'/g)) written.add(code[1]);
    }
    for (const code of MIGRATION.matchAll(/verdict := '([a-z_]+)'/g)) written.add(code[1]);
    for (const code of MIGRATION.matchAll(/set status = 'unread', reason = '([a-z_]+)'/g)) written.add(code[1]);
    const skippedOnly = new Set(["triage_changed", "firm_choice", "recorded_by_person"]);
    const left = [...written].filter((code) => !skippedOnly.has(code));
    expect(left.length).toBeGreaterThan(20);
    for (const code of left) expect(UNREAD, code).toContain(code);
    for (const code of [
      "not_found",
      "not_allowed",
      "not_allowed_in_support_session",
      "cancelled",
      "invalid_category",
      "x",
    ]) {
      expect(product[settleErrorKey(code)], code).toBeTruthy();
    }
    expect(readingAdviceKey("hearing", "not_filed")).toBe("publication-reading-advice-not-filed");
  });

  it("spends a try on what the model did with the text, and gives back the rest, as the triage does", () => {
    expect(readingFailure).toBe(triageFailure);
    expect(readingFailure("output_incomplete")).toBe("retry");
    expect(readingFailure("provider_unavailable")).toBe("released");
  });
});
