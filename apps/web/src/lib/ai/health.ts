import "server-only";

import type { Sweep } from "@/lib/jobs/schedule";
import { soon } from "@/lib/jobs/soon";
import { dateTimeLabel, memberUrl } from "@/lib/messages/format";
import { readRecipients } from "@/lib/messages/recipients";
import { notifyLocalized } from "@/lib/notifications";
import { configuredProviders, getChatProvider } from "@flyee/ai";
import { providerFailureCode } from "@flyee/ai/errors";
import { AI_PROVIDERS, type AiProviderName } from "@flyee/ai/types";
import { createServiceClient } from "@flyee/auth/service";
import { sendAiHealthEmail } from "@flyee/email";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The platform's account at each AI provider (migration 0255). Anthropic refused ONE's key from 2026-11-06 to
 * 2026-11-20: every work that asked a model spent its tries and was given up, and nobody was told. Now a run refused
 * for the account (`provider_account`) marks its provider down in the database; while one is down the sweeps whose
 * tasks it answers are paused (`aiPausedFor`, read by `lib/jobs/sweeps.ts`), so no firm's work spends a try on it; the
 * clock asks the provider once a beat whether the account is back; and the operators are told once when it goes down
 * and once when it comes back.
 */

/** A provider down: the model to ask again, and the tasks whose instructions in force name it. */
export type ProviderDown = { provider: string; model: string | null; since: string; tasks: string[] };

/** How long one server trusts what it read of the providers: the sweeps of a beat read it once. */
const FRESH_MS = 30_000;
let known: { at: number; down: ProviderDown[] } | null = null;

/** The providers that refuse the platform's account now. A read that fails says none: it never stops the work. */
export async function aiProvidersDown(service: SupabaseClient): Promise<ProviderDown[]> {
  if (known && Date.now() - known.at < FRESH_MS) return known.down;
  const { data, error } = await service.rpc("ai_providers_down");
  if (error) return [];
  const down = (Array.isArray(data) ? (data as Record<string, unknown>[]) : []).flatMap((row) =>
    typeof row.provider === "string" && typeof row.since === "string"
      ? [
          {
            provider: row.provider,
            model: typeof row.model === "string" ? row.model : null,
            since: row.since,
            tasks: Array.isArray(row.tasks) ? row.tasks.filter((task): task is string => typeof task === "string") : [],
          },
        ]
      : [],
  );
  known = { at: Date.now(), down };
  return down;
}

/**
 * Whether a work of these tasks waits: the provider their instructions in force name refuses the platform's account.
 * A work of another provider's tasks goes on (a Gemini key refused never stops what Anthropic answers).
 */
export async function aiPausedFor(service: SupabaseClient, tasks: readonly string[]): Promise<boolean> {
  if (tasks.length === 0) return false;
  return (await aiProvidersDown(service)).some((down) => down.tasks.some((task) => tasks.includes(task)));
}

/**
 * `soon` for a work that is a model's: right after the answer, unless the platform's AI account is refused, when it
 * waits for the sweep that takes it once the account is back (a claim made now would spend a try of the firm's work).
 */
export function soonAi(label: string, tasks: readonly string[], task: () => Promise<unknown>): boolean {
  return soon(label, async () => {
    if (await aiPausedFor(createServiceClient(), tasks)) return;
    await task();
  });
}

/** Forgets what this server read, after a check of the account changed it. */
function forget(): void {
  known = null;
}

const isProvider = (value: string): value is AiProviderName => (AI_PROVIDERS as readonly string[]).includes(value);

/** The provider's name, as the operator reads it. */
const PROVIDER_NAME: Record<AiProviderName, string> = {
  anthropic: "Anthropic",
  gemini: "Gemini",
  openai: "OpenAI",
  openrouter: "OpenRouter",
};

const providerName = (value: string): string => (isProvider(value) ? PROVIDER_NAME[value] : value);

/**
 * Asks a provider that is down whether the platform's account is back: one word of the model its last refused run
 * asked, with a budget of one token and nothing of any firm. It is no firm's run, so it is not recorded as one: it is
 * the platform's own check of its key, as the operator's would be, and it runs only while the provider is down.
 */
async function accountAnswers(provider: AiProviderName, model: string): Promise<"ok" | "refused" | "unknown"> {
  try {
    const stream = getChatProvider(provider).streamChat(
      { provider, model, systemPrompt: "Responda apenas: ok.", temperature: 0, maxTokens: 1 },
      [{ role: "user", content: "ok" }],
    );
    for await (const piece of stream) {
      void piece;
      break;
    }
    return "ok";
  } catch (error) {
    return providerFailureCode(error) === "provider_account" ? "refused" : "unknown";
  }
}

/** The checks of the accounts down, and the words owed to the operators. Counts only: the clock logs it. */
export async function aiHealthRound(service: SupabaseClient): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const tally = (key: string) => (counts[key] = (counts[key] ?? 0) + 1);

  forget();
  for (const down of await aiProvidersDown(service)) {
    // A provider this server has no key for, or no model to ask, waits for a run of the app to tell.
    if (!isProvider(down.provider) || !configuredProviders()[down.provider] || !down.model) {
      tally("unchecked");
      continue;
    }
    const answer = await accountAnswers(down.provider, down.model);
    if (answer === "unknown") {
      tally("unreachable");
      continue;
    }
    const { error } = await service.rpc("record_ai_provider_check", {
      target_provider: down.provider,
      target_ok: answer === "ok",
    });
    if (error) throw new Error(`record_ai_provider_check failed: ${error.message}`);
    tally(answer === "ok" ? "recovered" : "still_down");
  }
  forget();

  const { data, error } = await service.rpc("claim_ai_health_alerts");
  if (error) throw new Error(`claim_ai_health_alerts failed: ${error.message}`);
  const alerts = (Array.isArray(data) ? (data as Record<string, unknown>[]) : []).flatMap((row) =>
    typeof row.provider === "string" && (row.kind === "down" || row.kind === "up") && typeof row.at === "string"
      ? [
          {
            provider: row.provider,
            kind: row.kind === "down" ? ("down" as const) : ("up" as const),
            at: row.at,
            failures: Number(row.failures ?? 0),
          },
        ]
      : [],
  );
  if (alerts.length === 0) return counts;

  const { data: operators, error: operatorsError } = await service
    .from("profiles")
    .select("id")
    .eq("is_superadmin", true);
  if (operatorsError) throw new Error(`profiles failed: ${operatorsError.message}`);
  const operatorIds = (operators ?? []).map((row) => String(row.id));
  if (operatorIds.length === 0) return { ...counts, unsent: alerts.length };
  const recipients = await readRecipients(service, operatorIds);

  for (const alert of alerts) {
    const name = providerName(alert.provider);
    // The bell's key fences the e-mail: a second round finds the bell written and sends nothing again.
    const bell = await notifyLocalized(
      operatorIds,
      (copy, locale) =>
        alert.kind === "down"
          ? copy.aiDown(name, dateTimeLabel(alert.at, locale))
          : copy.aiUp(name, dateTimeLabel(alert.at, locale)),
      { type: "system", href: "/admin/ai", sourceKey: `ai-health:${alert.provider}:${alert.kind}:${alert.at}` },
    );
    tally(alert.kind === "down" ? "told_down" : "told_up");
    const told = new Set(bell.createdFor ?? []);
    for (const recipient of recipients) {
      if (!told.has(recipient.userId)) continue;
      await sendAiHealthEmail(recipient.email, {
        kind: alert.kind,
        provider: name,
        atLabel: dateTimeLabel(alert.at, recipient.locale, recipient.timezone),
        failures: alert.kind === "down" ? alert.failures : undefined,
        consoleUrl: memberUrl("/admin/ai"),
      }).catch(() => undefined);
    }
  }
  return counts;
}

/** The clock's check of the platform's AI account: from the clock alone, every beat, whatever the pause. */
export const aiHealthSweeps: Sweep[] = [
  {
    key: "ai-health",
    when: { every: 5 },
    run: (service) => aiHealthRound(service),
  },
];
