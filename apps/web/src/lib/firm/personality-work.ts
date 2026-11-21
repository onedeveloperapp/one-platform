import "server-only";

import { runFirmTask } from "@/lib/ai/executor";
import { PERSONALITY_TASK, personalityOutputOf } from "@/lib/firm/personality";
import { readSiteText } from "@/lib/firm/site-text";
import type { Sweep } from "@/lib/jobs/schedule";
import { soon } from "@/lib/jobs/soon";
import { createServiceClient } from "@flyee/auth/service";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * ONE writes the firm's profile (migration 0272): each writing owed is claimed, its input read (the firm's data, the
 * profile before it and the words asked, and the site, read once where the person gave its address), the task run,
 * and the draft recorded, every text kept within the rules for everybody, which the database checks again. A run
 * that did not answer gives the writing back for the next round; a draft the database refuses ends it with why.
 * Counts only.
 */
export async function writePersonalities(service: SupabaseClient, limit = 3): Promise<Record<string, number>> {
  const { data, error } = await service.rpc("claim_personality_requests", { target_limit: limit });
  if (error) throw new Error("claim_personality_requests failed");
  const claimed = (data ?? []) as { request_id: string; org_id: string; claim: number }[];
  const report = { claimed: claimed.length, drafted: 0, failed: 0, given_back: 0 };

  for (const held of claimed) {
    const giveBack = async (code: string, final: boolean) => {
      await service.rpc("fail_personality_request", {
        target_request: held.request_id,
        target_claim: held.claim,
        target_code: code,
        target_final: final,
      });
      if (final) report.failed += 1;
      else report.given_back += 1;
    };
    const { data: input } = await service.rpc("personality_request_input", {
      target_request: held.request_id,
      target_claim: held.claim,
    });
    const told = (input ?? {}) as {
      ok?: boolean;
      firm?: Record<string, unknown>;
      current?: { profile: unknown; status: string } | null;
      change?: string | null;
      site?: string | null;
    };
    if (!told.ok) continue;
    const site = told.site ? await readSiteText(told.site).catch(() => null) : null;
    const run = await runFirmTask({
      orgId: held.org_id,
      task: PERSONALITY_TASK,
      input: {
        escritorio: told.firm ?? {},
        perfil_anterior: told.current?.profile ?? null,
        pedido_de_mudanca: told.change ?? null,
        site: site ? { endereco: told.site, texto: site } : null,
      },
      subject: { type: "organization", id: held.org_id },
      idempotencyKey: `personality:${held.request_id}:${held.claim}`,
    }).catch(() => null);
    if (!run || run.kind !== "finished") {
      await giveBack(run?.kind === "refused" ? run.code : "not_answered", false);
      continue;
    }
    const written = personalityOutputOf(run.output);
    if (!written) {
      await giveBack("unreadable", false);
      continue;
    }
    const { data: recorded } = await service.rpc("record_personality_draft", {
      target_request: held.request_id,
      target_claim: held.claim,
      target_profile: written.profile,
      target_examples: written.examples,
      target_run: run.runId,
      // The site counts as read once ONE tried it, whatever it held: it is read once.
      target_site_read: Boolean(told.site),
    });
    const answer = (recorded ?? {}) as { ok?: boolean; code?: string };
    if (answer.ok) report.drafted += 1;
    else if (answer.code !== "not_held") await giveBack(answer.code ?? "refused", true);
  }
  return report;
}

/** The writing the person just asked for, done right after their answer; the sweep takes what does not finish. */
export function queuePersonalityWriting(): boolean {
  return soon("personality", async () => {
    await writePersonalities(createServiceClient(), 1);
  });
}

export const personalitySweeps: Sweep[] = [
  {
    key: "firm-personality",
    when: { every: 5 },
    whileUsed: true,
    ai: [PERSONALITY_TASK],
    run: async (service) => writePersonalities(service),
  },
];
