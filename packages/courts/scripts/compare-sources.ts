/**
 * The comparative test of the sources of the course of lawsuits, run by
 * hand by who chooses the aggregator:
 *
 *   ESCAVADOR_API_TOKEN=... JUDIT_API_KEY=... \
 *   node --experimental-strip-types packages/courts/scripts/compare-sources.ts sample.txt [--projudi]
 *
 * `sample.txt` holds CNJ numbers, one a line (masked or digits): lawsuits of
 * the courts a firm files in, a small-claims and a civil one of each, in the
 * systems that matter (PJe, e-SAJ, eproc, Projudi). Every source with a key
 * in the environment is asked about each number it covers, one call at a
 * time; with `--projudi`, TJGO's Projudi too, as the reference for TJGO's
 * lawsuits. What it prints is counted, for all the courts and court by
 * court: how many each found, missed and failed, how fast it answered, the
 * share of the days with movements it saw and how far behind it ran
 * (`@flyee/courts/compare`). Instances are not told apart: a source reads
 * the instance it reads first. No text of a movement,
 * no party and no lawyer is printed or written: the sample is the firm's.
 *
 * The keys are trial keys of each vendor, never a firm's; a sample is a
 * firm's own lawsuits, read with its leave, and stays on the machine that
 * runs this.
 */

import { readFileSync } from "node:fs";

import { askAll, compareSources, courtOf, type SourceScore } from "../src/compare.ts";
import { EscavadorSource } from "../src/providers/escavador.ts";
import { JuditSource } from "../src/providers/judit.ts";
import { ProjudiTjgoSource } from "../src/providers/projudi.ts";
import type { ProceedingSource } from "../src/types.ts";

const [file, ...flags] = process.argv.slice(2);
if (!file) {
  console.error("usage: node --experimental-strip-types packages/courts/scripts/compare-sources.ts sample.txt [--projudi]");
  process.exit(2);
}

const cnjs = [
  ...new Set(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((line) => line.replace(/\D/g, ""))
      .filter((digits) => digits.length === 20),
  ),
];
const sources: ProceedingSource[] = [];
if (flags.includes("--projudi")) sources.push(new ProjudiTjgoSource());
if (process.env.ESCAVADOR_API_TOKEN) sources.push(new EscavadorSource({ token: process.env.ESCAVADOR_API_TOKEN }));
if (process.env.JUDIT_API_KEY) sources.push(new JuditSource({ apiKey: process.env.JUDIT_API_KEY }));
if (sources.length < 2) {
  console.error("two sources at least: keys of the vendors in the environment, and --projudi for TJGO's lawsuits");
  process.exit(2);
}

console.log(`${cnjs.length} lawsuits, sources: ${sources.map((source) => source.name).join(", ")}`);
const tries = await askAll(sources, cnjs);
const table = (scores: SourceScore[]) =>
  console.table(
  scores.map((score) => ({
    source: score.source,
    asked: score.asked,
    found: score.found,
    notFound: score.notFound,
    missed: score.missed,
    failed: score.failed,
    medianMs: score.medianMs,
    dayCoverage: score.dayCoverage === null ? null : Math.round(score.dayCoverage * 1000) / 10,
    behind: score.behind,
    medianLagDays: score.medianLagDays,
  })),
);
console.log("All courts");
table(compareSources(tries));
// Court by court (its segment and tribunal in the number: 809 is TJGO, 826 TJSP), since a vendor may read one well and another badly.
for (const court of [...new Set(tries.map((attempt) => courtOf(attempt.cnj)))].sort()) {
  console.log(`Court ${court}`);
  table(compareSources(tries.filter((attempt) => courtOf(attempt.cnj) === court)));
}
// Why each failure, by its code: never the lawsuit's number.
const failures = new Map<string, number>();
for (const attempt of tries) if (attempt.error) failures.set(`${attempt.source}: ${attempt.error}`, (failures.get(`${attempt.source}: ${attempt.error}`) ?? 0) + 1);
for (const [reason, count] of failures) console.log(`${count} × ${reason}`);
