import "server-only";

import { createHash, randomBytes } from "node:crypto";

import { readMap } from "@/lib/court-robot/map";
import {
  type ExtensionBatch,
  type ExtensionSystem,
  linkCodeOf,
  readDone,
  readScreen,
  readSteps,
  receiptDigits,
  receiptText,
  REFUSAL_STATUS,
  TOKEN_PATTERN,
} from "@/lib/filing-ways/extension-protocol";
import {
  type FilingRow,
  filingRowOf,
  nextFiling,
  planScreen,
  recordFiling,
  type ScreenFilingDeps,
  systemOf,
} from "@/lib/filing-ways/screen-filing";
import type { SupabaseClient } from "@supabase/supabase-js";

export { receiptBlocks } from "@/lib/filing-ways/screen-filing";

/**
 * The backend's half of the lawyer's extension (`/api/extensao/v1/...`; the owner's second way to file, 2026-11-20):
 * the extension links to the lawyer's account by the code ONE showed them, and then, with the token it holds, takes a
 * batch the lawyer approved in ONE, the lawsuits of it one by one with their facts and their files, the AI's reading
 * of each screen it does not know, and tells ONE the filing goes, waits for the lawyer's word, or went, with the
 * court's receipt. Every write is a function of the database the service role alone may call (migrations 0263, 0264
 * and 0267), and each call first finds the link (`extension_link_of`) and then the batch or the filing as that
 * lawyer's, of that firm, filed by their extension: a token never reaches another lawyer's batch.
 *
 * What the extension sends is checked before it goes anywhere: a screen before the AI reads it (`readScreen`), a path
 * before it becomes the platform's map of a system (`readSteps`), and a path learned in a lawyer's browser is kept as
 * a map ONE still learns, never trusted by it (only a filing of ONE's own browser makes a map trusted, `trust_court_
 * screen_map`): every firm follows a trusted map with no AI and no lawyer's word before sending, so it is never taken
 * on a browser's say. Only ids, codes and counts leave this file in a log.
 */

export type ExtensionCall = {
  method: "GET" | "POST";
  path: readonly string[];
  authorization: string | null;
  body: Record<string, unknown> | null;
};

export type ExtensionDeps = ScreenFilingDeps;

export type ExtensionAnswer = { status: number; body: Record<string, unknown> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ERROR_CODE = /^[a-z][a-z0-9_]{1,59}$/;

const answered = (body: Record<string, unknown> = {}): ExtensionAnswer => ({
  status: 200,
  body: { ok: true, ...body },
});
const refused = (code: string): ExtensionAnswer => ({
  status: REFUSAL_STATUS[code] ?? 500,
  body: { ok: false, error: code },
});

export const hashOf = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

/** The token of a call (`Authorization: Bearer onex_...`), or null. */
export function tokenOf(authorization: string | null): string | null {
  const match = /^Bearer\s+(\S+)$/.exec((authorization ?? "").trim());
  return match && TOKEN_PATTERN.test(match[1] ?? "") ? (match[1] ?? null) : null;
}

/** A new token for a linked extension: shown to it once, kept by the database as its SHA-256 alone. */
export const mintToken = (): string => `onex_${randomBytes(32).toString("base64url")}`;

const claimOf = (body: Record<string, unknown>): number | null =>
  typeof body.claim === "number" && Number.isInteger(body.claim) && body.claim > 0 ? body.claim : null;

// ---------- Who calls, and what of theirs ----------

type Linked = { linkId: string; orgId: string; userId: string };

type BatchRow = {
  id: string;
  org_id: string;
  person_id: string | null;
  system_key: string;
  way: string;
  status: string;
  claims: number;
};

async function linkOf(service: SupabaseClient, token: string): Promise<Linked | null> {
  const { data, error } = await service.rpc("extension_link_of", { target_token_hash: hashOf(token) });
  if (error) throw new Error("extension_link_of failed");
  const answer = (data ?? {}) as { ok?: boolean; link_id?: string; org_id?: string; user_id?: string };
  return answer.ok && answer.link_id && answer.org_id && answer.user_id
    ? { linkId: answer.link_id, orgId: answer.org_id, userId: answer.user_id }
    : null;
}

/** A batch of the linked lawyer, of their firm, filed by their extension; null for any other. */
async function batchOf(service: SupabaseClient, linked: Linked, batchId: string): Promise<BatchRow | null> {
  const { data, error } = await service
    .from("filing_batches")
    .select("id, org_id, person_id, system_key, way, status, claims")
    .eq("id", batchId)
    .maybeSingle();
  if (error) throw new Error("filing_batches read failed");
  const row = data as BatchRow | null;
  if (!row || row.org_id !== linked.orgId || row.person_id !== linked.userId || row.way !== "extension") return null;
  return { ...row, claims: Number(row.claims) };
}

/** A filing of a batch of the linked lawyer's; null for any other. */
async function filingOf(
  service: SupabaseClient,
  linked: Linked,
  submissionId: string,
): Promise<{ filing: FilingRow; batch: BatchRow } | null> {
  const row = await filingRowOf(service, submissionId);
  if (!row || row.org_id !== linked.orgId || !row.batch_id) return null;
  const batch = await batchOf(service, linked, row.batch_id);
  return batch ? { filing: row, batch } : null;
}

async function namesOf(
  service: SupabaseClient,
  orgId: string,
  userId: string,
): Promise<{ lawyer: string; firm: string }> {
  const [profile, firm] = await Promise.all([
    service.from("profiles").select("display_name").eq("id", userId).maybeSingle(),
    service.from("organizations").select("name").eq("id", orgId).maybeSingle(),
  ]);
  return {
    lawyer: String((profile.data as { display_name?: string | null } | null)?.display_name ?? "").trim(),
    firm: String((firm.data as { name?: string | null } | null)?.name ?? "").trim(),
  };
}

// ---------- The calls ----------

/** The extension hands in the code ONE showed the lawyer, and takes its token, once. */
async function link(deps: ExtensionDeps, body: Record<string, unknown> | null): Promise<ExtensionAnswer> {
  const code = linkCodeOf(body?.code);
  if (!code) return refused("invalid_code");
  const label = typeof body?.label === "string" ? body.label.trim().slice(0, 80) || null : null;
  const token = mintToken();
  const { data, error } = await deps.service.rpc("claim_extension_link", {
    target_code_hash: hashOf(code),
    target_token_hash: hashOf(token),
    target_label: label,
  });
  if (error) return refused("unavailable");
  const answer = (data ?? {}) as { ok?: boolean; org_id?: string; user_id?: string };
  // Nothing tells a wrong code from one past its ten minutes.
  if (!answer.ok || !answer.org_id || !answer.user_id) return refused("invalid_code");
  const names = await namesOf(deps.service, answer.org_id, answer.user_id);
  return answered({ token, lawyer: names.lawyer, firm: names.firm });
}

/** Who the extension is linked to, and the batches of theirs it may file. */
async function situation(deps: ExtensionDeps, linked: Linked): Promise<ExtensionAnswer> {
  const { service } = deps;
  const [names, batches, systems, trusted] = await Promise.all([
    namesOf(service, linked.orgId, linked.userId),
    service
      .from("filing_batches")
      .select("id, system_key, status")
      .eq("org_id", linked.orgId)
      .eq("person_id", linked.userId)
      .eq("way", "extension")
      .in("status", ["approved", "running", "awaiting_confirmation"])
      .order("approved_at", { ascending: true })
      .limit(20),
    service.from("court_screen_systems").select("key, name, host"),
    service.from("court_screen_maps").select("system_key").eq("status", "trusted"),
  ]);
  if (batches.error || systems.error || trusted.error) return refused("unavailable");
  const rows = (batches.data ?? []) as { id: string; system_key: string; status: ExtensionBatch["status"] }[];
  const counts = rows.length
    ? await service
        .from("filing_submissions")
        .select("batch_id, status")
        .in(
          "batch_id",
          rows.map((row) => row.id),
        )
    : { data: [], error: null };
  if (counts.error) return refused("unavailable");
  const bySystem = new Map(((systems.data ?? []) as ExtensionSystem[]).map((system) => [system.key, system]));
  const learned = new Set(((trusted.data ?? []) as { system_key: string }[]).map((row) => row.system_key));
  const filings = (counts.data ?? []) as { batch_id: string; status: string }[];
  const list: ExtensionBatch[] = rows.flatMap((row) => {
    const system = bySystem.get(row.system_key);
    if (!system) return [];
    const mine = filings.filter((filing) => filing.batch_id === row.id);
    return [
      {
        id: row.id,
        system,
        status: row.status,
        packages: mine.length,
        left: mine.filter((filing) => ["owed", "claimed", "confirming"].includes(filing.status)).length,
        learning: !learned.has(row.system_key),
      },
    ];
  });
  return answered({ lawyer: names.lawyer, firm: names.firm, batches: list });
}

/**
 * The extension takes a batch to file it: one approved, never one another run left in the middle (a filing claimed,
 * held or going), which only stops. With the system and the path ONE follows there.
 */
async function start(deps: ExtensionDeps, linked: Linked, batchId: string): Promise<ExtensionAnswer> {
  const { service } = deps;
  const batch = await batchOf(service, linked, batchId);
  if (!batch) return refused("not_found");
  const left = await service
    .from("filing_submissions")
    .select("status")
    .eq("batch_id", batch.id)
    .in("status", ["claimed", "confirming", "sending"]);
  if (left.error) return refused("unavailable");
  if ((left.data ?? []).length > 0) return refused("interrupted");
  const claimed = await service.rpc("claim_filing_batch", { target_batch: batch.id, target_way: "extension" });
  if (claimed.error) return refused("unavailable");
  const taken = claimed.data as { claim?: number; learning?: boolean } | null;
  if (!taken || typeof taken.claim !== "number") return refused("not_available");
  const [system, map] = await Promise.all([
    systemOf(service, batch.system_key),
    service.rpc("court_screen_map_of", { target_system: batch.system_key }),
  ]);
  if (!system || map.error) return refused("unavailable");
  const followed = map.data as { steps?: unknown } | null;
  return answered({
    claim: Number(taken.claim),
    system,
    learning: taken.learning !== false,
    map: followed ? readMap(followed.steps) : null,
  });
}

/** The next lawsuit of the batch: its facts, by key with their values (the extension types them), and its files. */
async function next(deps: ExtensionDeps, linked: Linked, batchId: string, claim: number): Promise<ExtensionAnswer> {
  const { service } = deps;
  const batch = await batchOf(service, linked, batchId);
  if (!batch) return refused("not_found");
  const next = await nextFiling(service, batch.id, claim);
  return next.ok ? answered({ filing: next.filing }) : refused(next.code);
}

/** The AI reads a screen of the filing that ONE does not know: the structure the extension sent, the facts by name. */
async function plan(
  deps: ExtensionDeps,
  linked: Linked,
  submissionId: string,
  body: Record<string, unknown>,
): Promise<ExtensionAnswer> {
  const claim = claimOf(body);
  const found = await filingOf(deps.service, linked, submissionId);
  if (!found) return refused("not_found");
  if (claim === null || found.filing.claims !== claim || found.filing.status !== "claimed")
    return refused("not_working");
  const frames = readScreen(body.screen);
  if (!frames) return refused("invalid_screen");
  const reading = await planScreen(deps, {
    filing: found.filing,
    claim,
    systemKey: found.batch.system_key,
    frames,
    // What ONE did on this screen before: an extension before 0.4.0 sends none, and the AI reads the screen as new.
    done: readDone(body.done),
  });
  return reading.ok ? answered({ plan: reading.plan }) : refused(reading.code);
}

/** The answer of a function of the database that says `{ ok, code }`, as the extension reads it. */
function codeAnswer(data: unknown, error: { message?: string } | null): ExtensionAnswer {
  if (error) return refused("unavailable");
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  return answer.ok
    ? answered({ code: String(answer.code ?? "") })
    : refused(ERROR_CODE.test(String(answer.code)) ? String(answer.code) : "not_working");
}

async function hold(
  deps: ExtensionDeps,
  linked: Linked,
  submissionId: string,
  claim: number,
): Promise<ExtensionAnswer> {
  const found = await filingOf(deps.service, linked, submissionId);
  if (!found) return refused("not_found");
  const { data, error } = await deps.service.rpc("hold_filing_submission", {
    target_submission: submissionId,
    target_claim: claim,
    target_summary_file: null,
  });
  return codeAnswer(data, error);
}

/** The lawyer's word, given in their extension over the court's own screen, known by its link. */
async function confirm(deps: ExtensionDeps, linked: Linked, submissionId: string): Promise<ExtensionAnswer> {
  const found = await filingOf(deps.service, linked, submissionId);
  if (!found) return refused("not_found");
  const { data, error } = await deps.service.rpc("confirm_filing_submission_by_link", {
    target_submission: submissionId,
    target_link: linked.linkId,
  });
  return codeAnswer(data, error);
}

/** Where a filing held for the lawyer's word stands: confirmed in ONE meanwhile, or its batch stopped. */
async function state(deps: ExtensionDeps, linked: Linked, submissionId: string): Promise<ExtensionAnswer> {
  const found = await filingOf(deps.service, linked, submissionId);
  if (!found) return answered({ status: "gone", confirmed: false, batch: "stopped" });
  return answered({
    status: found.filing.status,
    confirmed: found.filing.confirmed_at !== null,
    batch: found.batch.status,
  });
}

/** Right before the first press that may send: the database marks the filing as going, or says why not. */
async function sending(
  deps: ExtensionDeps,
  linked: Linked,
  submissionId: string,
  claim: number,
): Promise<ExtensionAnswer> {
  const found = await filingOf(deps.service, linked, submissionId);
  if (!found) return refused("not_found");
  const { data, error } = await deps.service.rpc("filing_submission_sending", {
    target_submission: submissionId,
    target_claim: claim,
  });
  if (error) return refused("unavailable");
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  return answered({ going: answer.ok === true, code: String(answer.code ?? "not_working") });
}

/** The path ONE learned at the system in this filing, kept as a map it still learns. */
async function path(
  deps: ExtensionDeps,
  linked: Linked,
  submissionId: string,
  body: Record<string, unknown>,
): Promise<ExtensionAnswer> {
  const claim = claimOf(body);
  const found = await filingOf(deps.service, linked, submissionId);
  if (!found) return refused("not_found");
  if (
    claim === null ||
    found.filing.claims !== claim ||
    !["claimed", "confirming", "sending"].includes(found.filing.status)
  ) {
    return refused("not_working");
  }
  const steps = readSteps(body.steps);
  if (!steps) return refused("invalid_steps");
  // A path that only followed the map adds nothing to it.
  if (!(typeof body.aiScreens === "number" && body.aiScreens > 0)) return answered({ saved: false });
  const { data, error } = await deps.service.rpc("save_court_screen_map", {
    target_system: found.batch.system_key,
    target_steps: steps,
    target_submission: submissionId,
  });
  if (error) return refused("unavailable");
  const answer = (data ?? {}) as { ok?: boolean; version?: number };
  return answered({ saved: answer.ok === true, version: answer.version ?? null });
}

/** What came of a filing the database marked as going: taken by the court, with its number and receipt, or unknown. */
async function result(
  deps: ExtensionDeps,
  linked: Linked,
  submissionId: string,
  body: Record<string, unknown>,
): Promise<ExtensionAnswer> {
  const claim = claimOf(body);
  const found = await filingOf(deps.service, linked, submissionId);
  if (!found) return refused("not_found");
  if (claim === null || found.filing.claims !== claim || found.filing.status !== "sending")
    return refused("not_working");
  const outcome = body.outcome === "filed" ? "filed" : body.outcome === "unknown" ? "unknown" : null;
  if (!outcome) return refused("invalid_body");
  const recorded = await recordFiling(deps, {
    orgId: linked.orgId,
    submissionId,
    claim,
    systemKey: found.batch.system_key,
    outcome,
    number: receiptDigits(body.number),
    message: typeof body.message === "string" ? body.message.trim().slice(0, 1000) || null : null,
    // The receipt is the court's screen as the extension read it in the lawyer's browser.
    text: outcome === "filed" ? receiptText(body.receipt) : null,
    pdf: null,
  });
  return recorded.ok ? answered({ code: recorded.code }) : refused(recorded.code);
}

async function touch(deps: ExtensionDeps, linked: Linked, batchId: string, claim: number): Promise<ExtensionAnswer> {
  const batch = await batchOf(deps.service, linked, batchId);
  if (!batch) return refused("not_found");
  const { data, error } = await deps.service.rpc("touch_filing_batch", { target_batch: batch.id, target_claim: claim });
  if (error) return refused("unavailable");
  return answered({ held: data === true });
}

/** The extension ends its run of a batch: done when nothing of it waits, else stopped with why. */
async function finish(
  deps: ExtensionDeps,
  linked: Linked,
  batchId: string,
  body: Record<string, unknown>,
): Promise<ExtensionAnswer> {
  const claim = claimOf(body);
  const batch = await batchOf(deps.service, linked, batchId);
  if (!batch) return refused("not_found");
  if (claim === null) return refused("not_working");
  const why = typeof body.error === "string" && ERROR_CODE.test(body.error) ? body.error : null;
  const { data, error } = await deps.service.rpc("finish_filing_batch", {
    target_batch: batch.id,
    target_claim: claim,
    target_error: why,
  });
  return codeAnswer(data, error);
}

/** One call of the extension: who it is by its token, then what it asks. */
export async function handleExtensionCall(call: ExtensionCall, deps: ExtensionDeps): Promise<ExtensionAnswer> {
  const [area, id, action] = call.path;
  if (call.method === "POST" && area === "vincular" && call.path.length === 1) return link(deps, call.body);

  const token = tokenOf(call.authorization);
  if (!token) return refused("missing_token");
  const linked = await linkOf(deps.service, token);
  if (!linked) return refused("invalid_token");
  if (call.method === "GET" && area === "situacao" && call.path.length === 1) return situation(deps, linked);

  if (call.method !== "POST" || call.path.length !== 3 || !id || !UUID.test(id)) return refused("not_found");
  const body = call.body ?? {};
  const claim = claimOf(body);

  if (area === "lotes") {
    if (action === "iniciar") return start(deps, linked, id);
    if (action === "fim") return finish(deps, linked, id, body);
    if (claim === null) return refused("not_working");
    if (action === "proximo") return next(deps, linked, id, claim);
    if (action === "manter") return touch(deps, linked, id, claim);
  }
  if (area === "envios") {
    if (action === "tela") return plan(deps, linked, id, body);
    if (action === "confirmar") return confirm(deps, linked, id);
    if (action === "estado") return state(deps, linked, id);
    if (action === "caminho") return path(deps, linked, id, body);
    if (action === "resultado") return result(deps, linked, id, body);
    if (claim === null) return refused("not_working");
    if (action === "segurar") return hold(deps, linked, id, claim);
    if (action === "enviando") return sending(deps, linked, id, claim);
  }
  return refused("not_found");
}
