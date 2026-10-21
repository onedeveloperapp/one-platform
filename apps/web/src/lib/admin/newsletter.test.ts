import { draftLanguages, draftPayload } from "./newsletter";
import { describe, expect, it } from "vitest";

describe("a draft written per language", () => {
  it("sends a language only when both its subject and its text are written", () => {
    expect(draftLanguages({ "pt-BR": "Abrimos" }, { "pt-BR": "O ONE abriu." })).toEqual({
      ready: ["pt-BR"],
      incomplete: [],
    });
  });

  it("points out a half-written language instead of skipping it in silence", () => {
    expect(draftLanguages({ "pt-BR": "Abrimos" }, {})).toEqual({ ready: [], incomplete: ["pt-BR"] });
    expect(draftLanguages({}, { "pt-BR": "Só o texto" })).toEqual({ ready: [], incomplete: ["pt-BR"] });
  });

  it("treats blank space as nothing written", () => {
    expect(draftLanguages({ "pt-BR": "  " }, { "pt-BR": "\n" })).toEqual({
      ready: [],
      incomplete: [],
    });
  });

  it("stores only the complete languages, trimmed", () => {
    expect(draftPayload({ "pt-BR": "  Abrimos " }, { "pt-BR": "O ONE abriu.\n" })).toEqual({
      subject: { "pt-BR": "Abrimos" },
      body: { "pt-BR": "O ONE abriu." },
    });
    expect(draftPayload({ "pt-BR": "Pela metade" }, { "pt-BR": "   " })).toEqual({ subject: {}, body: {} });
  });
});
