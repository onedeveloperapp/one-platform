import { paragraphsOf, textChanges } from "./text-changes";
import { describe, expect, it } from "vitest";

const piece = (...paragraphs: string[]) => paragraphs.join("\n\n");

describe("what changed between two texts of a piece", () => {
  it("says nothing changed of a text against itself, whatever machine wrote its line endings", () => {
    const text = piece("DOS FATOS", "O voo atrasou cinco horas.", "DOS PEDIDOS", "Pede-se a condenação.");
    expect(textChanges(text, text)).toEqual({ blocks: [{ kind: "same", count: 4 }], changed: 0, layout: false });
    // The line endings of another machine and more blank lines between paragraphs are no change at all.
    const again = "DOS FATOS\r\n\r\nO voo atrasou cinco horas.\r\n\r\n\r\nDOS PEDIDOS\r\n\r\nPede-se a condenação.\r\n";
    expect(textChanges(text, again)).toEqual({ blocks: [{ kind: "same", count: 4 }], changed: 0, layout: false });
  });

  it("tells a text whose lines alone were broken otherwise from one left untouched", () => {
    // A document prints a line break inside a paragraph: a list whose lines were joined is not the same text.
    const list = piece("DOS PEDIDOS", "a) a citação da ré;\nb) a inversão do ônus da prova;\nc) a condenação.");
    const joined = piece("DOS PEDIDOS", "a) a citação da ré; b) a inversão do ônus da prova; c) a condenação.");
    expect(textChanges(list, joined)).toEqual({ blocks: [{ kind: "same", count: 2 }], changed: 0, layout: true });
    expect(textChanges("O voo  atrasou.", "O voo atrasou.").layout).toBe(true);
    // A word changed is a paragraph changed, never a matter of lines.
    expect(textChanges(list, piece("DOS PEDIDOS", "a) a citação da ré.")).layout).toBe(false);
  });

  it("shows a paragraph rewritten word by word, in the order of the new text", () => {
    const before = piece("DOS FATOS", "O voo atrasou cinco horas e a companhia nada informou.", "DOS PEDIDOS");
    const after = piece("DOS FATOS", "O voo atrasou sete horas e a companhia nada informou ao autor.", "DOS PEDIDOS");
    expect(textChanges(before, after)).toEqual({
      blocks: [
        { kind: "same", count: 1 },
        {
          kind: "changed",
          parts: [
            { kind: "same", text: "O voo atrasou" },
            { kind: "removed", text: "cinco" },
            { kind: "added", text: "sete" },
            { kind: "same", text: "horas e a companhia nada" },
            { kind: "removed", text: "informou." },
            { kind: "added", text: "informou ao autor." },
          ],
        },
        { kind: "same", count: 1 },
      ],
      changed: 1,
      layout: false,
    });
  });

  it("shows a paragraph put in and a paragraph taken out as such", () => {
    const before = piece("DOS FATOS", "O voo atrasou.", "A bagagem chegou no dia seguinte.", "DOS PEDIDOS");
    const added = piece(
      "DOS FATOS",
      "O voo atrasou.",
      "A bagagem chegou no dia seguinte.",
      "Houve perda de conexão.",
      "DOS PEDIDOS",
    );
    expect(textChanges(before, added).blocks).toEqual([
      { kind: "same", count: 3 },
      { kind: "added", text: "Houve perda de conexão." },
      { kind: "same", count: 1 },
    ]);
    const removed = piece("DOS FATOS", "O voo atrasou.", "DOS PEDIDOS");
    expect(textChanges(before, removed).blocks).toEqual([
      { kind: "same", count: 2 },
      { kind: "removed", text: "A bagagem chegou no dia seguinte." },
      { kind: "same", count: 1 },
    ]);
  });

  it("never reads two different paragraphs as one rewritten", () => {
    const before = piece("DOS FATOS", "A autora embarcou em Goiânia com destino a Recife.", "DOS PEDIDOS");
    const after = piece("DOS FATOS", "Requer a inversão do ônus da prova nos termos da lei.", "DOS PEDIDOS");
    expect(textChanges(before, after).blocks).toEqual([
      { kind: "same", count: 1 },
      { kind: "removed", text: "A autora embarcou em Goiânia com destino a Recife." },
      { kind: "added", text: "Requer a inversão do ônus da prova nos termos da lei." },
      { kind: "same", count: 1 },
    ]);
  });

  it("keeps the paragraphs that did not change between two changes apart from them", () => {
    const before = piece("A", "um dois três quatro", "B", "C", "cinco seis sete oito", "D");
    const after = piece("A", "um dois três nove", "B", "C", "cinco seis sete dez", "D");
    const changes = textChanges(before, after);
    expect(changes.changed).toBe(2);
    expect(changes.blocks.map((block) => block.kind)).toEqual(["same", "changed", "same", "changed", "same"]);
    expect(changes.blocks[2]).toEqual({ kind: "same", count: 2 });
  });

  it("compares a text with nothing, and nothing with a text", () => {
    expect(textChanges("", piece("um", "dois")).blocks).toEqual([
      { kind: "added", text: "um" },
      { kind: "added", text: "dois" },
    ]);
    expect(textChanges(piece("um", "dois"), "").blocks).toEqual([
      { kind: "removed", text: "um" },
      { kind: "removed", text: "dois" },
    ]);
    expect(textChanges("", "")).toEqual({ blocks: [], changed: 0, layout: false });
  });

  it("shows two texts too far apart to compare as one taken out and the other put in, whole", () => {
    // More paragraphs on each side than the table of a comparison holds. Each shares most of its words with
    // the one at its place on the other side, and one pair is the very same paragraph: compared by their
    // place, they would read as paragraphs rewritten, and one of them as rewritten with nothing changed.
    const many = (letter: string) =>
      Array.from({ length: 2100 }, (_, index) =>
        index === 1000 ? "o mesmo parágrafo dos dois lados" : `${letter}${index} com as mesmas palavras de sempre`,
      );
    const changes = textChanges(piece("início", ...many("a"), "fim"), piece("início", ...many("b"), "fim"));
    expect(changes.blocks[0]).toEqual({ kind: "same", count: 1 });
    expect(changes.blocks[changes.blocks.length - 1]).toEqual({ kind: "same", count: 1 });
    // Every paragraph of the middle is there, as taken out or as put in: nothing is cut, nothing is paired.
    const middle = changes.blocks.slice(1, -1).map((block) => block.kind);
    expect(middle).toEqual([...Array(2100).fill("removed"), ...Array(2100).fill("added")]);
    expect(changes.changed).toBe(4200);
    expect(changes.layout).toBe(false);
  });

  it("reads a letter and its accent typed apart as the one letter", () => {
    // A text the database gave back has each accent with its letter: that is no word changed.
    expect(textChanges("Joa\u0303o Teste embarcou.", "João Teste embarcou.")).toEqual({
      blocks: [{ kind: "same", count: 1 }],
      changed: 0,
      layout: false,
    });
  });

  it("splits a text into the paragraphs its document prints", () => {
    // What an empty line separates; a line of spaces alone is no empty line, and each line loses what is around it.
    expect(paragraphsOf("  um\n\n\n dois \n \n três\nainda três\n\n")).toEqual(["um", "dois\ntrês\nainda três"]);
    expect(paragraphsOf("")).toEqual([]);
  });

  it("never calls the same two texts that print differently", () => {
    // Two paragraphs against one: the line between them, with a space in it, separates nothing.
    const changes = textChanges("A primeira frase.\n\nA segunda frase.", "A primeira frase.\n \nA segunda frase.");
    expect(changes.changed).toBeGreaterThan(0);
    // Lines of one paragraph joined: no word changed, and it is said so.
    expect(textChanges("um\ndois", "um dois")).toEqual({
      blocks: [{ kind: "same", count: 1 }],
      changed: 0,
      layout: true,
    });
  });
});
