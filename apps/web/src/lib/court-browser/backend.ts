import "server-only";

import type {
  BrowserBackend,
  BrowserStarted,
  BrowserSystem,
  ClaimedBatch,
  LoginCheck,
  OpenedLogin,
  PageHooks,
  TakenCode,
} from "@/lib/court-browser/types";
import type { OneAnswer, OneApi } from "@/lib/court-extension/one-api";
import { readMap } from "@/lib/court-robot/map";
import { supabaseFileStore } from "@/lib/files/store";
import { readScreen, readSteps, receiptDigits, receiptText } from "@/lib/filing-ways/extension-protocol";
import {
  filingRowOf,
  nextFiling,
  planScreen,
  recordFiling,
  type ScreenFilingDeps,
  systemOf,
} from "@/lib/filing-ways/screen-filing";
import type { Envelope } from "@flyee/connectors/types";
import type { Vault } from "@flyee/connectors/vault";
import { takeBackFile } from "@flyee/documents/files";
import { measureFile } from "@flyee/documents/measure";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * ONE's backend for ONE's own browser on ONE's server (`worker.ts`; the owner's first way to file, 2026-11-20): the
 * functions of the database it calls with the service role, and the vault that opens a lawyer's court login only
 * through the two doors that keep each opening on record, `court_login_open` for a batch the lawyer approved (0264)
 * and `claim_court_login_check` for a login the lawyer just gave (0268). What a filing needs (its facts and files, the
 * AI's reading of a screen, its result and receipt) is the same code the extension's calls run
 * (`lib/filing-ways/screen-filing.ts`); here the screen held for the lawyer's word is kept as a picture, the receipt
 * is the court's screen printed, and a map ONE followed to a filing its lawyer confirmed and the court took becomes
 * trusted (only ONE's own browser makes one trusted). Only ids, codes and counts leave this file.
 */

export const COURT_BROWSER_BEAT_KEY = "court_browser_beat";

type OpenRow = {
  ok?: boolean;
  code?: string;
  org_id?: string;
  connection_id?: string;
  provider?: string;
  external_id?: string | null;
  status?: string;
  expires_at?: string | null;
  envelope?: { key_version?: number; iv?: string; ciphertext?: string; tag?: string } | null;
};

const envelopeOf = (row: OpenRow["envelope"]): Envelope | null =>
  row && typeof row.key_version === "number" && row.iv && row.ciphertext && row.tag
    ? { keyVersion: row.key_version, iv: row.iv, ciphertext: row.ciphertext, tag: row.tag }
    : null;

/** The login and the password a lawyer gave, opened from the answer of one of the two doors; null when it does not open. */
function loginOf(vault: Vault, row: OpenRow): { login: string; senha: string } | null {
  const envelope = envelopeOf(row.envelope);
  if (!row.org_id || !row.connection_id || !envelope) return null;
  const opened = vault.openAnswer(
    { orgId: row.org_id, connectionId: row.connection_id },
    {
      ok: true,
      envelope,
      orgId: row.org_id,
      provider: row.provider ?? "",
      externalId: row.external_id ?? null,
      status: "connected",
      expiresAt: row.expires_at ?? null,
    },
  );
  if (opened.kind !== "opened") return null;
  const { login, senha } = opened.payload;
  return typeof login === "string" && typeof senha === "string" && login && senha ? { login, senha } : null;
}

const answered = <T>(value: T): OneAnswer<T> => ({ ok: true, value });
const refused = <T>(error: string): OneAnswer<T> => ({ ok: false, error });

/** The answer of a function of the database that says `{ ok, code }`. */
function codeAnswer(data: unknown, error: unknown): OneAnswer<{ code: string }> {
  if (error) return refused("unavailable");
  const answer = (data ?? {}) as { ok?: boolean; code?: string };
  return answer.ok ? answered({ code: String(answer.code ?? "") }) : refused(String(answer.code ?? "not_working"));
}

async function systemRow(service: SupabaseClient, key: string): Promise<BrowserSystem | null> {
  const { data, error } = await service
    .from("court_screen_systems")
    .select("key, name, host, start_path, login_kind")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error("court_screen_systems read failed");
  const row = data as { key: string; name: string; host: string; start_path: string; login_kind: string } | null;
  if (!row) return null;
  return {
    key: row.key,
    name: row.name,
    host: row.host,
    startPath: row.start_path,
    loginKind: row.login_kind === "password_email" ? "password_email" : "password_app",
  };
}

/** The court's screen held for the lawyer's word, kept as a file of the firm; null when it could not be kept. */
async function keepScreen(
  service: SupabaseClient,
  orgId: string,
  picture: Uint8Array,
): Promise<{ id: string; path: string } | null> {
  const store = supabaseFileStore(service);
  try {
    const reserved = await store.reserve({
      orgId,
      purpose: "filing_screen",
      name: "tela-do-tribunal.png",
      mime: "image/png",
      bytes: picture.byteLength,
    });
    if (!reserved.ok) return null;
    await store.put(reserved.storagePath, picture, "image/png");
    const kept = await store.confirm(reserved.fileId, await measureFile(picture));
    if (kept.ok) return { id: reserved.fileId, path: reserved.storagePath };
    await takeBackFile(store, reserved.fileId, reserved.storagePath);
    return null;
  } catch {
    return null;
  }
}

export function serverBackend(
  service: SupabaseClient,
  vault: Vault,
  options: Omit<ScreenFilingDeps, "service"> = {},
): BrowserBackend {
  const deps: ScreenFilingDeps = { service, ...options };

  return {
    async claimCheck(): Promise<LoginCheck | null> {
      const { data, error } = await service.rpc("claim_court_login_check");
      if (error) throw new Error("claim_court_login_check failed");
      const row = (data ?? null) as (OpenRow & { system?: string; host?: string; start_path?: string }) | null;
      if (!row?.ok || !row.system || !row.host) return null;
      const opened = loginOf(vault, row);
      if (!opened || !row.org_id || !row.connection_id) return null;
      return {
        orgId: row.org_id,
        connectionId: row.connection_id,
        system: { key: row.system, host: row.host, startPath: row.start_path ?? "/" },
        ...opened,
      };
    },

    async checked(check, outcome) {
      const { error } = await service.rpc("court_login_checked", {
        target_org: check.orgId,
        target_connection: check.connectionId,
        target_outcome: outcome,
      });
      if (error) throw new Error("court_login_checked failed");
    },

    async claimBatch(): Promise<ClaimedBatch | null> {
      const { data, error } = await service.rpc("claim_filing_batch", { target_batch: null, target_way: "browser" });
      if (error) throw new Error("claim_filing_batch failed");
      const row = data as {
        batch_id?: string;
        claim?: number;
        org_id?: string;
        person_id?: string | null;
        system?: string;
        learning?: boolean;
      } | null;
      if (!row?.batch_id || typeof row.claim !== "number" || !row.org_id || !row.system) return null;
      const system = await systemRow(service, row.system);
      const batch = {
        batchId: row.batch_id,
        claim: Number(row.claim),
        orgId: row.org_id,
        personId: row.person_id ?? "",
        learning: row.learning !== false,
      };
      if (!system || !batch.personId) {
        await service.rpc("finish_filing_batch", {
          target_batch: batch.batchId,
          target_claim: batch.claim,
          target_error: "no_system",
        });
        return null;
      }
      return { ...batch, system };
    },

    async started(batch): Promise<BrowserStarted | null> {
      const [system, map] = await Promise.all([
        systemOf(service, batch.system.key),
        service.rpc("court_screen_map_of", { target_system: batch.system.key }),
      ]);
      if (!system || map.error) return null;
      const followed = map.data as { id?: string; status?: string; steps?: unknown } | null;
      return {
        claim: batch.claim,
        system,
        learning: batch.learning,
        map: followed ? readMap(followed.steps) : null,
        mapId: followed?.status === "learning" && typeof followed.id === "string" ? followed.id : null,
      };
    },

    async openLogin(batch): Promise<OpenedLogin> {
      const { data, error } = await service.rpc("court_login_open", {
        target_batch: batch.batchId,
        target_claim: batch.claim,
      });
      if (error) return { ok: false, code: "unavailable" };
      const row = (data ?? {}) as OpenRow;
      if (!row.ok) return { ok: false, code: String(row.code ?? "no_court_login") };
      const opened = loginOf(vault, row);
      if (!opened || !row.connection_id) return { ok: false, code: "court_login_unopened" };
      return { ok: true, connectionId: row.connection_id, ...opened };
    },

    async askCode(batch, kind) {
      const { data, error } = await service.rpc("ask_filing_batch_code", {
        target_batch: batch.batchId,
        target_claim: batch.claim,
        target_kind: kind,
      });
      return !error && (data as { ok?: boolean } | null)?.ok === true;
    },

    async takeCode(batch): Promise<TakenCode> {
      const { data, error } = await service.rpc("take_filing_batch_code", {
        target_batch: batch.batchId,
        target_claim: batch.claim,
      });
      if (error) return { kind: "none" };
      const row = (data ?? {}) as OpenRow;
      if (row.ok && row.org_id) {
        const envelope = envelopeOf(row.envelope);
        const code = envelope ? vault.openBatchCode(row.org_id, batch.batchId, envelope) : null;
        return code ? { kind: "code", code } : { kind: "none" };
      }
      return row.code === "not_working" ? { kind: "gone" } : { kind: "none" };
    },

    async batchStatus(batchId) {
      const { data, error } = await service.from("filing_batches").select("status").eq("id", batchId).maybeSingle();
      if (error) return null;
      return (data as { status?: string } | null)?.status ?? null;
    },

    async touch(batch) {
      await service.rpc("touch_filing_batch", { target_batch: batch.batchId, target_claim: batch.claim });
    },

    async finish(batch, why) {
      await service.rpc("finish_filing_batch", {
        target_batch: batch.batchId,
        target_claim: batch.claim,
        target_error: why,
      });
    },

    api(batch, started, hooks: PageHooks): OneApi {
      // The map each filing of this run saved, trusted once the court took that filing.
      const saved = new Map<string, string>();
      const mine = async (filingId: string) => {
        const filing = await filingRowOf(service, filingId);
        return filing && filing.batch_id === batch.batchId ? filing : null;
      };

      return {
        link: async () => refused("not_found"),
        situation: async () => refused("not_found"),
        start: async () => refused("not_found"),
        confirm: async () => refused("not_linked"),

        async next(batchId, claim) {
          const next = await nextFiling(service, batchId, claim);
          return next.ok ? answered({ filing: next.filing }) : refused(next.code);
        },

        async keep(batchId, claim) {
          const { data, error } = await service.rpc("touch_filing_batch", {
            target_batch: batchId,
            target_claim: claim,
          });
          return error ? refused("unavailable") : answered({ held: data === true });
        },

        async finish(batchId, claim, why) {
          const { data, error } = await service.rpc("finish_filing_batch", {
            target_batch: batchId,
            target_claim: claim,
            target_error: why,
          });
          return codeAnswer(data, error);
        },

        async plan(filingId, claim, screen) {
          const frames = readScreen(screen);
          if (!frames) return refused("invalid_screen");
          const filing = await mine(filingId);
          if (!filing) return refused("not_found");
          const reading = await planScreen(deps, { filing, claim, systemKey: batch.system.key, frames });
          return reading.ok ? answered({ plan: reading.plan }) : refused(reading.code);
        },

        async hold(filingId, claim) {
          // The court's screen is kept for the lawyer, who sees it in ONE before they give their word.
          const picture = await hooks.screenshot().catch(() => null);
          const file = picture ? await keepScreen(service, batch.orgId, picture) : null;
          const { data, error } = await service.rpc("hold_filing_submission", {
            target_submission: filingId,
            target_claim: claim,
            target_summary_file: file?.id ?? null,
          });
          const answer = codeAnswer(data, error);
          if (!answer.ok && file) {
            await takeBackFile(supabaseFileStore(service), file.id, file.path).catch(() => undefined);
          }
          return answer;
        },

        async state(filingId) {
          const filing = await mine(filingId);
          if (!filing) return answered({ status: "gone", confirmed: false, batch: "stopped" });
          const { data } = await service.from("filing_batches").select("status").eq("id", batch.batchId).maybeSingle();
          return answered({
            status: filing.status,
            confirmed: filing.confirmed_at !== null,
            batch: (data as { status?: string } | null)?.status ?? "stopped",
          });
        },

        async sending(filingId, claim) {
          const { data, error } = await service.rpc("filing_submission_sending", {
            target_submission: filingId,
            target_claim: claim,
          });
          if (error) return refused("unavailable");
          const answer = (data ?? {}) as { ok?: boolean; code?: string };
          return answered({ going: answer.ok === true, code: String(answer.code ?? "not_working") });
        },

        async path(filingId, _claim, steps, aiScreens) {
          // A path that only followed the map adds nothing to it.
          if (!(aiScreens > 0)) return answered({ saved: false });
          const read = readSteps(steps);
          if (!read) return refused("invalid_steps");
          const { data, error } = await service.rpc("save_court_screen_map", {
            target_system: batch.system.key,
            target_steps: read,
            target_submission: filingId,
          });
          if (error) return refused("unavailable");
          const answer = (data ?? {}) as { ok?: boolean; map_id?: string };
          if (answer.ok && answer.map_id) saved.set(filingId, answer.map_id);
          return answered({ saved: answer.ok === true });
        },

        async result(filingId, claim, outcome) {
          const filed = outcome.outcome === "filed";
          const pdf = filed ? await hooks.receipt().catch(() => null) : null;
          const recorded = await recordFiling(deps, {
            orgId: batch.orgId,
            submissionId: filingId,
            claim,
            systemKey: batch.system.key,
            outcome: outcome.outcome,
            number: receiptDigits(outcome.number),
            message: typeof outcome.message === "string" ? outcome.message.trim().slice(0, 1000) || null : null,
            text: filed ? receiptText(outcome.receipt) : null,
            pdf,
          });
          if (!recorded.ok) return refused(recorded.code);
          // What ONE learned at the system, followed to a filing its lawyer confirmed and the court took: trusted.
          const mapId = saved.get(filingId) ?? started.mapId;
          if (batch.learning && mapId && (recorded.code === "filed" || recorded.code === "filed_unnumbered")) {
            await service.rpc("trust_court_screen_map", { target_map: mapId, target_submission: filingId });
          }
          return answered({ code: recorded.code });
        },
      };
    },

    async beat(mark) {
      await service
        .from("platform_settings")
        .upsert({ key: COURT_BROWSER_BEAT_KEY, value: mark, is_public: false, updated_at: new Date().toISOString() });
    },
  };
}
