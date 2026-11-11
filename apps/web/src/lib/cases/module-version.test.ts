import { versionDocumentsOf, withVersionDocuments } from "./cases";
import { moduleVersionWords, readCaseModuleVersion } from "./module-version";
import { describe, expect, it } from "vitest";

describe("the version of its module a case reads (0212)", () => {
  const answer = {
    ok: true,
    module: "direito-do-passageiro",
    module_name: "Direito do Passageiro",
    version: 2,
    withdrawn: false,
    reads: 2,
    documents: { default: { essential: [{ kind: "identity", per: "claimant" }] } },
  };

  it("reads the database's answer, and nothing of a refusal", () => {
    expect(readCaseModuleVersion(answer)).toEqual({
      module: "direito-do-passageiro",
      moduleName: "Direito do Passageiro",
      version: 2,
      withdrawn: false,
      reads: 2,
    });
    expect(readCaseModuleVersion({ ok: false, code: "not_found" })).toBeNull();
  });

  it("says the version in words, and the one a case follows when its own was withdrawn", () => {
    expect(moduleVersionWords(answer)).toBe("Direito do Passageiro, versão 2");
    expect(moduleVersionWords({ ...answer, withdrawn: true, reads: 1 })).toBe(
      "Direito do Passageiro, versão 2, retirada: o caso segue a versão 1",
    );
    expect(moduleVersionWords({ ...answer, version: null })).toBeNull();
  });

  it("puts the documents of the case's version in place of the setting's, and keeps the setting where there are none", () => {
    const setting = { documents_by_problem: { default: { essential: [] } }, dispensable_days: 7 };
    const documents = versionDocumentsOf(answer);
    expect(withVersionDocuments(setting, documents)).toEqual({
      documents_by_problem: answer.documents,
      dispensable_days: 7,
    });
    // The backend's reading answers the documents alone.
    expect(versionDocumentsOf(answer.documents)).toEqual(answer.documents);
    expect(withVersionDocuments(setting, versionDocumentsOf({ ok: false }))).toEqual(setting);
    expect(withVersionDocuments(setting, versionDocumentsOf(null))).toEqual(setting);
  });
});
