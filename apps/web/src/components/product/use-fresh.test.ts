import { changedKeys, signatureOf } from "./use-fresh";
import { describe, expect, it } from "vitest";

describe("changedKeys", () => {
  it("names what came and what changed, never what left", () => {
    expect(
      changedKeys(
        { holder: "firm", "blocking:create": "Crie os processos", "working:doc": "Conferindo" },
        { holder: "one", "working:doc": "Conferindo", "working:piece": "Escrevendo a peça" },
      ),
    ).toEqual(["holder", "working:piece"]);
  });

  it("says nothing when nothing changed", () => {
    expect(changedKeys({ a: "1", b: "2" }, { b: "2", a: "1" })).toEqual([]);
  });
});

describe("signatureOf", () => {
  it("is the same whatever the order the keys were written in", () => {
    expect(signatureOf({ a: "1", b: "2" })).toBe(signatureOf({ b: "2", a: "1" }));
    expect(signatureOf({ a: "1" })).not.toBe(signatureOf({ a: "2" }));
  });
});
