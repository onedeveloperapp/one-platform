import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  AUTONOMY_DECISIONS,
  AUTONOMY_STAGES,
  autonomyErrorKey,
  DECISION_KEY,
  decisionsByStage,
  firmAutonomyOf,
  MODE_KEY,
} from "@/lib/firm/autonomy";
import product from "@flyee/content/messages/pt-BR.json";

const ROOT = path.resolve(process.cwd(), "..", "..");
const MIGRATIONS = fs
  .readdirSync(path.join(ROOT, "packages/db/migrations"))
  .filter((name) => name.endsWith(".sql"))
  .map((name) => fs.readFileSync(path.join(ROOT, "packages/db/migrations", name), "utf8"))
  .join("\n");
const words = (product as { product: Record<string, string> }).product;

describe("what a firm lets ONE decide alone", () => {
  it("knows every decision the database seeds, and none it does not", () => {
    // Every row of every insert into the catalog: one statement may seed several decisions.
    const seeded = [
      ...MIGRATIONS.matchAll(/insert into public\.autonomy_decisions \(key[^)]*\) values([\s\S]*?)on conflict/g),
    ].flatMap((statement) => [...statement[1].matchAll(/\(\s*'([a-z_]+)'/g)].map((row) => row[1]));
    expect([...seeded].sort()).toEqual([...AUTONOMY_DECISIONS].sort());
  });

  it("reads the database's answer, leaving out what it does not know", () => {
    const read = firmAutonomyOf([
      {
        key: "piece_text",
        modes: ["approval", "auto"],
        default_mode: "auto",
        held: false,
        chosen: "approval",
        mode: "approval",
        sample_percent: 20,
        changed_by: "a",
        changed_at: "2026-10-14T12:00:00Z",
      },
      {
        key: "document_check",
        modes: ["auto", "sampled", "approval"],
        default_mode: "auto",
        held: true,
        mode: "approval",
      },
      { key: "something_new", modes: ["auto", "approval"], default_mode: "auto", mode: "auto" },
      { key: "chronology", modes: ["auto"], default_mode: "auto", mode: "sideways" },
      null,
    ]);
    expect(read).toEqual([
      {
        key: "piece_text",
        modes: ["auto", "approval"],
        defaultMode: "auto",
        held: false,
        chosen: "approval",
        mode: "approval",
        samplePercent: 20,
        changedBy: "a",
        changedAt: "2026-10-14T12:00:00Z",
      },
      {
        key: "document_check",
        modes: ["auto", "sampled", "approval"],
        defaultMode: "auto",
        held: true,
        chosen: null,
        mode: "approval",
        samplePercent: 20,
        changedBy: null,
        changedAt: null,
      },
    ]);
    expect(firmAutonomyOf({})).toBeNull();
    expect(firmAutonomyOf(null)).toBeNull();
  });

  it("has words for every decision, way and refusal", () => {
    for (const decision of AUTONOMY_DECISIONS) {
      expect(words[DECISION_KEY[decision].title], decision).toBeTruthy();
      expect(words[DECISION_KEY[decision].body], decision).toBeTruthy();
    }
    for (const key of Object.values(MODE_KEY)) expect(words[key], key).toBeTruthy();
    for (const code of ["second_factor", "not_a_partner", "not_allowed_in_support_session", "invalid_mode", "x"]) {
      expect(words[autonomyErrorKey(code)], code).toBeTruthy();
    }
    for (const stage of AUTONOMY_STAGES) expect(words[stage.title], stage.key).toBeTruthy();
  });

  it("puts every decision in exactly one stage of the case", () => {
    const staged = AUTONOMY_STAGES.flatMap((stage) => stage.decisions);
    expect([...staged].sort()).toEqual([...AUTONOMY_DECISIONS].sort());
    expect(new Set(staged).size).toBe(staged.length);
  });

  it("groups the firm's decisions by stage, in the stage's order, leaving out a stage with none", () => {
    const grouped = decisionsByStage([{ key: "close_case" }, { key: "reply_client" }, { key: "open_case_from_chat" }]);
    expect(grouped.map((stage) => [stage.key, stage.decisions.map((decision) => decision.key)])).toEqual([
      ["atendimento", ["reply_client", "open_case_from_chat"]],
      ["resultado", ["close_case"]],
    ]);
  });
});
