#!/usr/bin/env node
/**
 * Which electronic system each state court uses, read from the public DJEN API
 * (https://comunicaapi.pje.jus.br/api/v1/comunicacao, no login): every
 * communication carries a link into the court's own system, so the host of the
 * link names the system (projudi.tjgo.jus.br, eproc1g.tjsp.jus.br, pje...).
 *
 * It seeds and checks the court-systems table of ONE. Mind what a sample says:
 * it shows where the cases IN COURSE live; new cases may already go to another
 * system (TJPR sends new small-claims cases to eproc since 2026-07-02 while its
 * communications still come from Projudi). Confirm with the court's own acts.
 *
 * Usage:
 *   node scripts/djen-systems.mjs [--day YYYY-MM-DD] [--courts TJGO,TJSP] [--pages 1|2] [--json out.json] [--sql out.sql]
 *   node scripts/djen-systems.mjs --from-json sample.json --sql out.sql   (no call to the API)
 * Defaults: yesterday, the 27 state courts, 1 page of 100 per court.
 *
 * `--sql` writes the rows of `court_systems` (migration 0021) the sample
 * supports: for each court and kind of proceeding, the system of the host
 * most of its communications link to. Every row is written unconfirmed: a
 * person confirms it against the court's acts.
 *
 * Only hosts and counts are printed or written: never names, case numbers or
 * texts. The API allows about 20 calls per window per IP, so calls are paced
 * (4 s apart) and the script waits 65 s when the remaining quota runs low or a
 * 429 arrives.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const BASE = "https://comunicaapi.pje.jus.br/api/v1/comunicacao";
export const STATE_COURTS = [
  "TJAC", "TJAL", "TJAP", "TJAM", "TJBA", "TJCE", "TJDFT", "TJES", "TJGO", "TJMA", "TJMT", "TJMS", "TJMG", "TJPA",
  "TJPB", "TJPR", "TJPE", "TJPI", "TJRJ", "TJRN", "TJRS", "TJRO", "TJRR", "TJSC", "TJSP", "TJSE", "TJTO",
];

const SMALL_CLAIMS_CLASS = 436; // Procedimento do Juizado Especial Cível
const ORDINARY_CIVIL_CLASS = 7; // Procedimento Comum Cível

/** The host of a communication link, or a marker when there is none. */
export function hostOf(link) {
  try {
    return link ? new URL(link).host || "(sem link)" : "(sem link)";
  } catch {
    return "(link inválido)";
  }
}

/** Counts link hosts overall, for small-claims items and for ordinary civil items. Pure. */
export function countHosts(items) {
  const tally = { total: 0, all: {}, juizado: {}, comum: {} };
  const bump = (bucket, host) => {
    bucket[host] = (bucket[host] ?? 0) + 1;
  };
  for (const item of items) {
    const host = hostOf(item.link);
    tally.total += 1;
    bump(tally.all, host);
    const text = `${item.nomeOrgao ?? ""} ${item.nomeClasse ?? ""}`.toUpperCase();
    const code = Number(item.codigoClasse);
    if (code === SMALL_CLAIMS_CLASS || text.includes("JUIZADO ESPECIAL") || text.includes("JUIZADOS ESPECIAIS")) {
      bump(tally.juizado, host);
    } else if (code === ORDINARY_CIVIL_CLASS || text.includes("PROCEDIMENTO COMUM")) {
      bump(tally.comum, host);
    }
  }
  return tally;
}

/**
 * The filing system a host belongs to. Only hosts whose system is known are
 * named; any other is `outro`, kept with its host so a person can look.
 */
export function systemOf(host) {
  const name = String(host ?? "").toLowerCase();
  if (!name || name.startsWith("(")) return null;
  if (name.includes("projudi")) return "projudi";
  if (name.includes("eproc")) return "eproc";
  if (/(^|\.)pje/.test(name)) return "pje";
  if (name.includes("esaj")) return "esaj";
  // Alagoas serves its SAJ from www2 (the case search at www2.tjal.jus.br/cpopg).
  if (name === "www2.tjal.jus.br") return "esaj";
  return "outro";
}

/** The host most communications of a bucket link to, with its count; null when the bucket has no link. */
function dominant(bucket) {
  const entries = Object.entries(bucket ?? {}).filter(([host]) => systemOf(host) !== null);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  return { host: entries[0][0], count: entries[0][1], total };
}

const sqlText = (value) => (value === null || value === undefined ? "null" : `'${String(value).replace(/'/g, "''")}'`);

/** The rows of `court_systems` a sample supports, as one SQL statement. Pure. */
export function courtSystemsSql(results) {
  const rows = [];
  for (const result of results) {
    for (const [kind, bucket] of [
      ["juizado", result.juizado],
      ["comum", result.comum],
    ]) {
      const top = dominant(bucket);
      if (!top) continue;
      const source = `djen ${result.day}: ${top.count} de ${top.total} comunicações com link (${kind})`;
      rows.push(
        `  (${sqlText(result.court)}, ${sqlText(kind)}, ${sqlText(systemOf(top.host))}, ${sqlText(top.host)}, ${sqlText(source)}, ${top.count}, ${top.total}, ${sqlText(result.day)})`,
      );
    }
  }
  if (rows.length === 0) return "";
  return [
    "insert into public.court_systems (court, proceeding_kind, system, host, source, sample_count, sample_total, sampled_on) values",
    rows.join(",\n"),
    "on conflict (court, proceeding_kind) do update set",
    "  system = excluded.system, host = excluded.host, source = excluded.source,",
    "  sample_count = excluded.sample_count, sample_total = excluded.sample_total, sampled_on = excluded.sampled_on,",
    "  updated_at = now()",
    "where not public.court_systems.confirmed;",
    "",
  ].join("\n");
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchPage(court, day, page) {
  const query = new URLSearchParams({
    siglaTribunal: court,
    dataDisponibilizacaoInicio: day,
    dataDisponibilizacaoFim: day,
    pagina: String(page),
    itensPorPagina: "100",
  });
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const response = await fetch(`${BASE}?${query}`, { headers: { "user-agent": "one-court-systems/1.0" } });
    if (response.status === 429 && attempt === 1) {
      console.error(`${court}: 429, esperando 65 s`);
      await sleep(65_000);
      continue;
    }
    if (!response.ok) throw new Error(`${court} p${page}: HTTP ${response.status}`);
    const remaining = Number(response.headers.get("x-ratelimit-remaining"));
    const body = await response.json();
    return { items: body.items ?? [], remaining: Number.isFinite(remaining) ? remaining : null };
  }
  throw new Error(`${court} p${page}: limite de taxa`);
}

function parseArgs(argv) {
  const args = { day: null, courts: STATE_COURTS, pages: 1, json: null, sql: null, fromJson: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--day") args.day = value;
    else if (flag === "--courts") args.courts = value.split(",").map((court) => court.trim().toUpperCase());
    else if (flag === "--pages") args.pages = Math.min(2, Math.max(1, Number(value) || 1));
    else if (flag === "--json") args.json = value;
    else if (flag === "--sql") args.sql = value;
    else if (flag === "--from-json") args.fromJson = value;
    else continue;
    i += 1;
  }
  if (!args.day) args.day = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
  return args;
}

const top = (bucket) =>
  Object.entries(bucket)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([host, count]) => `${host} ${count}`)
    .join(", ") || "nenhum";

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.fromJson) {
    const saved = JSON.parse(readFileSync(args.fromJson, "utf8"));
    if (args.sql) writeFileSync(args.sql, courtSystemsSql(saved));
    console.log(args.sql ? `gravado ${args.sql}` : "nada a gravar: use --sql");
    return;
  }
  const results = [];
  for (const court of args.courts) {
    const items = [];
    try {
      for (let page = 1; page <= args.pages; page += 1) {
        const { items: pageItems, remaining } = await fetchPage(court, args.day, page);
        items.push(...pageItems);
        if (remaining !== null && remaining <= 3) {
          console.error("limite perto do fim: esperando 65 s");
          await sleep(65_000);
        } else {
          await sleep(4_000);
        }
        if (pageItems.length < 100) break;
      }
    } catch (error) {
      console.error(String(error));
      continue;
    }
    const tally = countHosts(items);
    results.push({ court, day: args.day, ...tally });
    console.log(`${court}: ${tally.total} | geral: ${top(tally.all)} | juizado: ${top(tally.juizado)} | comum: ${top(tally.comum)}`);
  }
  if (args.json) {
    writeFileSync(args.json, `${JSON.stringify(results, null, 2)}\n`);
    console.log(`gravado ${args.json}`);
  }
  if (args.sql) {
    writeFileSync(args.sql, courtSystemsSql(results));
    console.log(`gravado ${args.sql}`);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
