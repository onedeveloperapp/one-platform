import { latestPublished, manifestChanges, readManifest, readModuleVersions } from "./module-versions";
import { describe, expect, it } from "vitest";

const MANIFEST = {
  documents: { default: { essential: [{ kind: "identity", per: "claimant" }], dispensable: [] } },
  prompts: { "atendimento.conversa": 3, "caso.peca.minuta": 7 },
  pieces: {
    templates: { "t-1": { name: "Inicial do juizado", body: "Texto de teste.", proceeding_kind: "juizado" } },
    kinds: { replica: { name: "Réplica", model: "Modelo de teste." } },
  },
};

describe("the versions of a module (0212)", () => {
  it("reads the database's answer, and nothing of a refusal", () => {
    const read = readModuleVersions({
      ok: true,
      modules: [
        {
          key: "direito-do-passageiro",
          name: "Direito do Passageiro",
          tasks: ["atendimento.conversa"],
          now: MANIFEST,
          versions: [
            { id: "v2", version: 2, status: "draft", note: "Nova lista", manifest: MANIFEST, cases: 0, open_cases: 0 },
            {
              id: "v1",
              version: 1,
              status: "published",
              note: "Primeira",
              manifest: MANIFEST,
              cases: 4,
              open_cases: 3,
            },
            { id: "x", version: 3, status: "odd", manifest: MANIFEST },
          ],
        },
      ],
    });
    expect(read).toHaveLength(1);
    expect(read?.[0]?.versions.map((version) => version.id)).toEqual(["v2", "v1"]);
    expect(read?.[0]?.now.prompts).toEqual({ "atendimento.conversa": 3, "caso.peca.minuta": 7 });
    expect(latestPublished(read![0]!)?.id).toBe("v1");
    expect(readModuleVersions({ ok: false })).toBeNull();
  });

  it("says what changes from a version to what is in force, area by area", () => {
    const from = readManifest(MANIFEST);
    const to = readManifest({
      documents: { default: { essential: [], dispensable: [] }, baggage: { essential: [] } },
      prompts: { "atendimento.conversa": 4, "caso.peca.minuta": 7, "audiencia.resultado": 1 },
      pieces: {
        templates: {
          "t-1": { name: "Inicial do juizado", body: "Texto de teste, revisto.", proceeding_kind: "juizado" },
          "t-2": { name: "Inicial da vara", body: "Outro texto.", proceeding_kind: "comum" },
        },
        kinds: {},
      },
    });
    expect(manifestChanges(from, to)).toEqual([
      { area: "documents", key: "baggage" },
      { area: "documents", key: "default" },
      { area: "prompts", key: "atendimento.conversa", from: 3, to: 4 },
      { area: "prompts", key: "audiencia.resultado", from: null, to: 1 },
      { area: "templates", key: "t-1", name: "Inicial do juizado", what: "text" },
      { area: "templates", key: "t-2", name: "Inicial da vara", what: "added" },
      { area: "kinds", key: "replica", name: "Réplica", what: "removed" },
    ]);
    expect(manifestChanges(from, readManifest(MANIFEST))).toEqual([]);
  });
});
