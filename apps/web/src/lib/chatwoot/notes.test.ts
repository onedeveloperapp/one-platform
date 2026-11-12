import { calledNote, contentOf, failureOf, FILE_IN_ONE, flaggedNote, flaggedRefusal, refusalOf } from "./notes";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

/** What the firm's people read in the panel follows the rules of every text people read: no dash, no exclamation, no emoji. */
const BROKEN = /[\u2013\u2014!]|\p{Extended_Pictographic}/u;

describe("what ONE says in the firm's panel", () => {
  const codes = [
    "window_closed",
    "number_disconnected",
    "person_unknown",
    "not_found",
    "empty",
    "too_long",
    "attachment",
    "other",
  ];
  const texts = [
    ...codes.map(refusalOf),
    flaggedRefusal(["promises_result", "speaks_of_price", "presses"]),
    flaggedNote(["promises_result", "speaks_of_price", "presses"]),
    calledNote("O cliente pediu para falar com uma pessoa."),
    calledNote(null),
    failureOf("window_closed"),
    failureOf("opted_out"),
    failureOf("provider_refused"),
    failureOf(null),
    FILE_IN_ONE,
    ...["image", "document", "audio", "video", "sticker", "location", "contacts", "unsupported"].map((kind) =>
      contentOf({ kind, body: null, media_filename: null }),
    ),
  ];

  it("writes plain Portuguese with no dash, exclamation or emoji", () => {
    for (const text of texts) expect(text, text).not.toMatch(BROKEN);
  });

  it("says why a message did not go, and how to send a flagged one all the same", () => {
    expect(refusalOf("window_closed")).toContain("24 horas");
    expect(flaggedRefusal(["presses"])).toContain("10 minutos");
    expect(flaggedNote(["promises_result"])).toContain("promete um resultado");
  });

  it("gives every message a text: its own, or the word for what it is", () => {
    expect(contentOf({ kind: "text", body: "Bom dia", media_filename: null })).toBe("Bom dia");
    expect(contentOf({ kind: "image", body: null, media_filename: null })).toBe("Foto");
    expect(contentOf({ kind: "document", body: null, media_filename: "contrato.pdf" })).toBe("contrato.pdf");
    expect(contentOf({ kind: "text", body: "  ", media_filename: null })).toBe("Mensagem sem texto");
  });
});

describe("the functions of the firm's account", () => {
  it("are the kit's choices for ONE", async () => {
    const { CHATWOOT_FEATURES_OFF } = await import("./provider");
    const choices = JSON.parse(
      readFileSync(path.resolve(__dirname, "../../../../../packages/atendimento/escolhas.json"), "utf8"),
    ) as { chatwoot: { features_off: string[] } };
    expect([...CHATWOOT_FEATURES_OFF].sort()).toEqual([...choices.chatwoot.features_off].sort());
  });
});
