import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { DOCUMENT_KINDS } from "@/lib/cases/cases";
import {
  cnjDigits,
  currentFiling,
  defaultFilingDocuments,
  fileDescription,
  FILING_LABEL,
  FILING_STEP_KEY,
  FILING_STEP_KEYS,
  filingErrorKey,
  filingOutdated,
  filingProblemKey,
  filingStepKey,
  filingStepsOf,
  PACKAGE_STATUS_KEY,
  PACKAGE_STATUSES,
  sizeLabel,
} from "@/lib/cases/filing";
import messages from "@flyee/content/messages/pt-BR.json";
import { FILING_ORDER, FILING_STEPS, partName, planFiling } from "@flyee/courts/filing";

const ROOT = path.resolve(__dirname, "../../../../..");
const MIGRATION = fs.readFileSync(path.join(ROOT, "packages/db/migrations/0027_filing.sql"), "utf8");
const product = messages.product as Record<string, string>;

/** The values a check constraint of migration 0027 allows, in its order. */
function allowed(constraint: string): string[] {
  const start = MIGRATION.indexOf(`constraint ${constraint} check`);
  expect(start, constraint).toBeGreaterThan(-1);
  const list = /in \(([^)]+)\)/.exec(MIGRATION.slice(start));
  return [...(list?.[1] ?? "").matchAll(/'([a-z0-9_]+)'/g)].map((match) => match[1]);
}

describe("what the code says matches what the database keeps", () => {
  it("lists the states of a package as the check constraint does", () => {
    expect([...PACKAGE_STATUSES]).toEqual(allowed("filing_packages_status_check"));
  });

  it("orders in a package only kinds a document of a case may have, all of them", () => {
    expect([...FILING_ORDER].sort()).toEqual([...DOCUMENT_KINDS].sort());
    expect(Object.keys(FILING_LABEL).sort()).toEqual([...FILING_ORDER].sort());
    expect(FILING_ORDER[0]).toBe("petition");
  });

  it("gives every file a name the table of items takes", () => {
    const constraint = /constraint filing_package_items_name_check check \(name ~ '([^']+)'\)/.exec(MIGRATION)?.[1];
    expect(constraint).toBeTruthy();
    const pattern = new RegExp(constraint as string);
    const limit = Number(/'name_max_length', (\d+)/.exec(MIGRATION)?.[1]);
    expect(limit).toBe(80);
    const plan = planFiling(
      FILING_ORDER.map((kind, index) => ({
        key: `d${index}`,
        kind,
        label: FILING_LABEL[kind],
        person: index % 2 === 0 ? "José Antônio D'Ávila Conceição de Albuquerque e Mendonça Júnior" : null,
        mime: "application/pdf",
        bytes: 9_000_000,
        pages: 30,
      })),
      { maxFileBytes: 6_000_000, nameMaxLength: limit },
    );
    expect(plan.ready).toBe(true);
    for (const item of plan.items) {
      for (const name of [partName(item.stem, 1, 1), partName(item.stem, 12, 12)]) {
        expect(name, name).toMatch(pattern);
        expect(name.length, name).toBeLessThanOrEqual(limit);
      }
    }
  });

  it("has words for every state, step, problem and failure", () => {
    const keys = [
      ...Object.values(PACKAGE_STATUS_KEY),
      ...FILING_STEPS.map((step) => FILING_STEP_KEY[step]),
      ...FILING_STEP_KEYS,
      ...["not_a_pdf", "page_too_large", "unreadable", "missing", "petition_too_large", "something_else"].map(
        filingProblemKey,
      ),
      ...["no_petition", "two_petitions", "problems", "abandoned", "store_unavailable", null].map(filingErrorKey),
    ];
    for (const key of keys) expect(product[key], key).toBeTruthy();
    // What the worker says of a document is one of the words the screen has.
    for (const code of ["not_a_pdf", "page_too_large", "unreadable", "missing", "petition_too_large"]) {
      expect(filingProblemKey(code)).toBe(`filing-problem-${code.replaceAll("_", "-")}`);
    }
  });
});

describe("what each court's system asks of a package", () => {
  it("says a system's own steps where it has them, and the plain ones elsewhere", () => {
    expect(filingStepKey("eproc", "files")).toBe("filing-step-files-eproc");
    expect(filingStepKey("pje", "sign")).toBe("filing-step-sign-pje");
    expect(filingStepKey("projudi", "access")).toBe("filing-step-access-projudi");
    expect(filingStepKey("projudi", "files")).toBe(FILING_STEP_KEY.files);
    expect(filingStepKey("esaj", "access")).toBe(FILING_STEP_KEY.access);
    expect(filingStepKey(null, "receipt")).toBe(FILING_STEP_KEY.receipt);
    // eproc and the PJe ask the parties and the value with the lawsuit's information: said once, not twice.
    expect(filingStepsOf("eproc")).toEqual([
      "filing-step-access-eproc",
      "filing-step-forum-eproc",
      "filing-step-files-eproc",
      "filing-step-sign-eproc",
      FILING_STEP_KEY.receipt,
    ]);
    expect(filingStepsOf("pje")).not.toContain(FILING_STEP_KEY.parties);
    expect(filingStepsOf("projudi")).toHaveLength(FILING_STEPS.length);
    expect(filingStepsOf(null)).toEqual(FILING_STEPS.map((step) => FILING_STEP_KEY[step]));
    // Where each file goes already signed: the .p7s ONE signed, or each PDF signed before it goes.
    expect(filingStepsOf("projudi", "signed")).toContain("filing-step-files-signed");
    expect(filingStepsOf("projudi", "sign_first")).toEqual(
      expect.arrayContaining(["filing-step-files-sign-first", "filing-step-sign-sign-first"]),
    );
    expect(filingStepsOf("projudi", "sign_first")).not.toContain(FILING_STEP_KEY.sign);
  });

  it("describes a file by what it is and whose", () => {
    expect(fileDescription("Procuração", "Maria Teste")).toBe("Procuração de Maria Teste");
    expect(fileDescription("Bilhete", null)).toBe("Bilhete");
  });

  it("keeps the types of a system as the database checks them", () => {
    const migration = fs.readFileSync(path.join(ROOT, "packages/db/migrations/0036_filing_systems.sql"), "utf8");
    const kinds = /key in \(([^)]+)\)/.exec(migration)?.[1] ?? "";
    expect([...kinds.matchAll(/'([a-z_]+)'/g)].map((match) => match[1]).sort()).toEqual([...FILING_ORDER].sort());
  });
});

describe("what a package takes by default", () => {
  it("is every accepted document but the petitions and the contract with the firm", () => {
    expect(
      defaultFilingDocuments([
        { id: "a", kind: "petition", status: "accepted" },
        { id: "b", kind: "identity", status: "accepted" },
        { id: "c", kind: "ticket", status: "received" },
        { id: "d", kind: "contract", status: "accepted" },
        { id: "e", kind: "power_of_attorney", status: "accepted" },
        { id: "f", kind: "evidence", status: "rejected" },
      ]),
    ).toEqual(["b", "e"]);
  });
});

describe("which package of a lawsuit a screen shows", () => {
  // Newest first, as the screen reads them.
  const filings = [
    { id: "new", proceedingId: "p1", status: "ready" as const },
    { id: "old", proceedingId: "p1", status: "filed" as const },
    { id: "other", proceedingId: "p2", status: "filed" as const },
  ];

  it("is the one in course for a lawsuit not filed yet, and the one filed for a lawsuit filed", () => {
    expect(currentFiling(filings, { id: "p1", status: "planned" })?.id).toBe("new");
    expect(currentFiling(filings, { id: "p1", status: "filed" })?.id).toBe("old");
    expect(currentFiling(filings, { id: "p2", status: "filed" })?.id).toBe("other");
  });

  it("never lets a receipt attached by mistake stand in the way of another package", () => {
    // The lawsuit went back to planned: its filed package is history, and the form comes back.
    expect(currentFiling(filings.slice(1), { id: "p1", status: "planned" })).toBeNull();
    expect(currentFiling(filings, { id: "p3", status: "planned" })).toBeNull();
  });
});

describe("a package that no longer says what its lawsuit is", () => {
  const filing = {
    court: "TJGO",
    system: "projudi",
    kind: "juizado",
    petitionDocumentId: "p",
    documentIds: ["a", "b"],
  };
  const lawsuit = (court: string | null, system: string | null, kind = "juizado") => ({ court, system, kind });
  const documents = [
    { id: "p", status: "accepted" },
    { id: "a", status: "accepted" },
    { id: "b", status: "accepted" },
  ];

  it("is the one of a lawsuit that moved, or with a document no longer accepted", () => {
    expect(filingOutdated(filing, lawsuit("TJGO", "projudi"), documents)).toBe(false);
    expect(filingOutdated(filing, lawsuit("TJGO", "pje"), documents)).toBe(true);
    expect(filingOutdated(filing, lawsuit("TJSP", "projudi"), documents)).toBe(true);
    expect(filingOutdated(filing, lawsuit(null, "projudi"), documents)).toBe(true);
    // A lawsuit that went to the civil court is filed in another way: its package is built again.
    expect(filingOutdated(filing, lawsuit("TJGO", "projudi", "comum"), documents)).toBe(true);
    expect(
      filingOutdated(filing, lawsuit("TJGO", "projudi"), [...documents.slice(0, 2), { id: "b", status: "rejected" }]),
    ).toBe(true);
    expect(filingOutdated(filing, lawsuit("TJGO", "projudi"), documents.slice(0, 2))).toBe(true);
  });

  it("is told by the database for the same reasons", () => {
    const body = /create or replace function public\.filing_package_outdated[\s\S]*?\$\$;/.exec(MIGRATION)?.[0] ?? "";
    expect(body).toContain("p.court is distinct from package.court or p.system is distinct from package.system");
    expect(body).toContain("p.kind is distinct from package.kind");
    expect(body).toContain("d.status = 'accepted'");
  });
});

describe("how the screen writes a size and reads a case number", () => {
  it("writes a size as a person reads it", () => {
    expect(sizeLabel(0)).toBe("0 KB");
    expect(sizeLabel(400)).toBe("1 KB");
    expect(sizeLabel(850_000)).toBe("850 KB");
    expect(sizeLabel(5_240_000)).toBe("5,2 MB");
    expect(sizeLabel(6_000_000)).toBe("6 MB");
  });

  it("brings a case number to its twenty digits, or to nothing", () => {
    expect(cnjDigits("5000202-39.2099.8.09.0051")).toBe("50002023920998090051");
    expect(cnjDigits(" 50002023920998090051 ")).toBe("50002023920998090051");
    expect(cnjDigits("5000202-39.2099.8.09")).toBeNull();
    expect(cnjDigits("")).toBeNull();
  });
});
