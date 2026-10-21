"use server";

import { revalidatePath } from "next/cache";

import type { DossierResult } from "@/lib/admin/firms";
import { requireSuperadmin } from "@/lib/admin/session";
import { recordAudit } from "@/lib/audit";
import { createServiceClient } from "@flyee/auth/service";
import { type BillingProviderName, getProvider } from "@flyee/billing";

/**
 * What the firms console does to an account. Everything RLS or a database
 * function can authorize runs under the operator's own session; the service
 * role is used only where the auth admin API or the Storage API leaves no
 * other way (bans, second factors, files of a deleted account).
 *
 * A server action is a public endpoint: each one checks the role again before
 * it does anything, whatever the screen that called it showed.
 */

export type AdminActionResult<T> = { ok: true; data: T } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The floor the product uses for an operator's reason (support access, account deletion). */
const REASON_MIN = 8;

const isServiceConfigured = () =>
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);

const refresh = () => revalidatePath("/admin/escritorios");

/** Everything the platform knows about the account of one firm, read when the operator opens it. */
export async function loadFirmDossier(orgId: string): Promise<DossierResult> {
  if (!UUID.test(orgId)) return { ok: false, code: "invalid" };
  const session = await requireSuperadmin();
  if (!session) return { ok: false, code: "forbidden" };
  const { data, error } = await session.supabase.rpc("admin_firm_dossier", { target_org: orgId });
  if (error || !data) return { ok: false, code: "failed" };
  return data as DossierResult;
}

/**
 * Ban or unban an account platform-wide (the auth ban). The reason is required
 * and lands in the audit metadata: the trail has columns for who and when, and
 * nothing else survives to say WHY an account was cut off.
 */
export async function setUserBanned(userId: string, banned: boolean, reason: string): Promise<AdminActionResult<null>> {
  if (!UUID.test(userId)) return { ok: false, error: "invalid" };
  const session = await requireSuperadmin();
  if (!session) return { ok: false, error: "forbidden" };
  if (!isServiceConfigured()) return { ok: false, error: "not-configured" };
  if (userId === session.userId) return { ok: false, error: "self-ban" };
  const trimmed = reason.trim();
  if (trimmed.length < REASON_MIN) return { ok: false, error: "reason-required" };

  const service = createServiceClient();
  // The auth API has no permanent ban: "876000h" is a century, "none" lifts it.
  const { error } = await service.auth.admin.updateUserById(userId, { ban_duration: banned ? "876000h" : "none" });
  if (error) return { ok: false, error: error.message };

  await recordAudit(session.supabase, banned ? "admin.user.banned" : "admin.user.unbanned", {
    entityType: "user",
    entityId: userId,
    metadata: { reason: trimmed },
  });
  refresh();
  return { ok: true, data: null };
}

/**
 * Removes every second factor of an account: the recovery path for somebody
 * who lost the authenticator and is stuck at the two-step check.
 */
export async function resetUserMfa(userId: string, reason: string): Promise<AdminActionResult<null>> {
  if (!UUID.test(userId)) return { ok: false, error: "invalid" };
  const session = await requireSuperadmin();
  if (!session) return { ok: false, error: "forbidden" };
  if (!isServiceConfigured()) return { ok: false, error: "not-configured" };
  // Removing your own second factor here would cost you support access
  // (impersonation requires AAL2) without anything saying so.
  if (userId === session.userId) return { ok: false, error: "self-mfa" };
  const trimmed = reason.trim();
  if (trimmed.length < REASON_MIN) return { ok: false, error: "reason-required" };

  const service = createServiceClient();
  const { data, error } = await service.auth.admin.mfa.listFactors({ userId });
  if (error) return { ok: false, error: error.message };

  // A partial removal is still audited: factors are gone and the trail must say so.
  let removed = 0;
  let failure: string | null = null;
  for (const factor of data?.factors ?? []) {
    const { error: deleteError } = await service.auth.admin.mfa.deleteFactor({ id: factor.id, userId });
    if (deleteError) {
      failure = deleteError.message;
      break;
    }
    removed += 1;
  }
  if (removed > 0 || !failure) {
    await recordAudit(session.supabase, "admin.user.mfa_reset", {
      entityType: "user",
      entityId: userId,
      metadata: {
        reason: trimmed,
        factorsRemoved: removed,
        factorsFound: data?.factors?.length ?? 0,
        ...(failure ? { partialFailure: failure } : {}),
      },
    });
  }
  if (failure) return { ok: false, error: failure };
  return { ok: true, data: null };
}

// ---------- Account deletion (migration 0013) ----------

type DeletionPreview = {
  blockers: string[];
  providerSubscriptions: {
    id: string;
    provider: BillingProviderName;
    providerSubscriptionId: string;
    status: string;
  }[];
};

export type StoragePurgeResult = {
  removed: number;
  /** -1 when what is left could not be read back. */
  remaining: number;
  error?: string;
};

export type AccountDeletionResult = {
  /** The firm deleted with the person: the one they alone belonged to. */
  deletedFirms: string[];
  counts: Record<string, number>;
  canceledSubscriptions: number;
  storage: StoragePurgeResult;
};

const BLOCKER_MESSAGE: Record<string, string> = {
  self: "Você não pode excluir a sua própria conta. Peça a outra pessoa com o papel de superadmin.",
  superadmin: "Esta conta tem o papel de superadmin da plataforma. Remova o papel primeiro, depois exclua a conta.",
  shared_firm:
    "Esta pessoa é titular de um escritório do qual outras pessoas fazem parte. A titularidade precisa passar para alguém da equipe, ou as outras pessoas saírem, antes da exclusão.",
};

/** The database answers in codes; the console answers in reasons. */
function deletionMessage(raw: string): string {
  if (raw.includes("self_delete_forbidden")) return BLOCKER_MESSAGE.self;
  if (raw.includes("target_is_superadmin")) return BLOCKER_MESSAGE.superadmin;
  if (raw.includes("shared_firm")) return BLOCKER_MESSAGE.shared_firm;
  if (raw.includes("confirmation_mismatch")) return "O e-mail digitado não corresponde à conta. Nada foi excluído.";
  if (raw.includes("reason_required")) return "Diga por que esta conta está sendo excluída (no mínimo 8 caracteres).";
  if (raw.includes("provider_subscription_live")) {
    return "Uma assinatura ainda está sendo cobrada no provedor de pagamento. Nada foi excluído.";
  }
  if (raw.includes("user_not_found")) return "Esta conta não existe mais. Recarregue a lista.";
  if (raw.includes("firm_still_exists") || raw.includes("user_still_exists")) {
    return "A conta ainda existe: os arquivos só são removidos depois que a própria conta é excluída.";
  }
  if (raw.includes("not_authorized")) {
    return "Só quem tem o papel de superadmin pode excluir contas, e nunca de dentro de uma sessão de suporte.";
  }
  // The deletion is one transaction: a refusal from the database means it
  // rolled back whole. Say so, because a raw constraint name leaves the
  // operator wondering what is already gone.
  if (raw.includes("violates foreign key constraint")) {
    return `O banco recusou a exclusão e desfez tudo: nada foi excluído, a conta está intacta. (${raw})`;
  }
  return raw;
}

/** A subscription the provider no longer knows about is already stopped. */
function isGoneAtProvider(error: unknown): boolean {
  const failure = error as { code?: string; statusCode?: number; message?: string } | null;
  return failure?.code === "resource_missing" || failure?.statusCode === 404 || /\(404\)/.test(failure?.message ?? "");
}

const STORAGE_REMOVE_BATCH = 100;
// The listing is capped by PostgREST's max rows, so a large account is emptied
// in passes; a pass that removes nothing ends the loop.
const STORAGE_MAX_PASSES = 50;

/**
 * Removes the files of an account that no longer exists. The list comes from
 * `admin_orphaned_account_storage`, which refuses any firm or person that
 * still exists, so this service-role delete can only ever reach leftovers.
 * What remains is counted from the database, not from the API's answer.
 */
async function purgeAccountStorage(
  session: NonNullable<Awaited<ReturnType<typeof requireSuperadmin>>>,
  orgIds: string[],
  userId: string,
): Promise<StoragePurgeResult> {
  const service = createServiceClient();
  const list = () =>
    session.supabase.rpc("admin_orphaned_account_storage", { target_orgs: orgIds, target_user: userId });

  let removed = 0;
  for (let pass = 0; pass < STORAGE_MAX_PASSES; pass += 1) {
    const { data, error } = await list();
    if (error) return { removed, remaining: -1, error: deletionMessage(error.message) };
    const objects = (data ?? []) as { bucket: string; path: string }[];
    if (objects.length === 0) return { removed, remaining: 0 };

    const byBucket = new Map<string, string[]>();
    for (const object of objects) byBucket.set(object.bucket, [...(byBucket.get(object.bucket) ?? []), object.path]);

    const before = removed;
    for (const [bucket, paths] of byBucket) {
      for (let index = 0; index < paths.length; index += STORAGE_REMOVE_BATCH) {
        const { data: gone } = await service.storage
          .from(bucket)
          .remove(paths.slice(index, index + STORAGE_REMOVE_BATCH));
        removed += gone?.length ?? 0;
      }
    }
    if (removed === before) return { removed, remaining: objects.length };
  }

  const { data: left, error: leftError } = await list();
  if (leftError) return { removed, remaining: -1, error: deletionMessage(leftError.message) };
  return { removed, remaining: (left ?? []).length };
}

const countLabel = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/**
 * Permanently deletes an account and everything it holds.
 *
 * The order is the design: (1) re-read the preview, because the dialog's may
 * be stale; (2) stop the money at the provider BEFORE anything is deleted, so
 * a failure there leaves the account intact; (3) one database transaction
 * removes the person, and the firm they alone belonged to with its change
 * history; (4) the files
 * go through the Storage API afterwards, because storage refuses SQL deletes,
 * and can be retried, since the listing only ever returns leftovers.
 */
export async function deleteAccount(
  userId: string,
  confirmEmail: string,
  reason: string,
): Promise<AdminActionResult<AccountDeletionResult>> {
  if (!UUID.test(userId)) return { ok: false, error: "invalid" };
  const session = await requireSuperadmin();
  if (!session) return { ok: false, error: "forbidden" };
  if (!isServiceConfigured()) return { ok: false, error: "not-configured" };
  if (userId === session.userId) return { ok: false, error: BLOCKER_MESSAGE.self };

  const { supabase } = session;
  const { data: previewData, error: previewError } = await supabase.rpc("admin_account_deletion_preview", {
    target_user: userId,
  });
  if (previewError) return { ok: false, error: deletionMessage(previewError.message) };
  const preview = previewData as DeletionPreview;
  const blocker = preview.blockers[0];
  if (blocker) return { ok: false, error: BLOCKER_MESSAGE[blocker] ?? blocker };

  const service = createServiceClient();
  let canceled = 0;
  for (const subscription of preview.providerSubscriptions) {
    try {
      await getProvider(subscription.provider).cancelSubscription(subscription.providerSubscriptionId);
    } catch (cancelError) {
      if (!isGoneAtProvider(cancelError)) {
        const detail = cancelError instanceof Error ? cancelError.message : String(cancelError);
        return {
          ok: false,
          error: `Não foi possível cancelar a assinatura no ${subscription.provider}, então nada foi excluído: ${detail}`,
        };
      }
    }
    const { error: markError } = await service
      .from("subscriptions")
      .update({ status: "canceled", canceled_at: new Date().toISOString(), cancel_at_period_end: false })
      .eq("id", subscription.id);
    if (markError) {
      return {
        ok: false,
        error: `A assinatura foi cancelada no ${subscription.provider}, mas registrar isso falhou (${markError.message}). Nada mais foi excluído: tente de novo.`,
      };
    }
    canceled += 1;
    await recordAudit(supabase, "admin.account.subscription_canceled", {
      entityType: "subscription",
      entityId: subscription.id,
      metadata: { provider: subscription.provider, userId, cause: "account_deletion" },
    });
  }

  const { data: deletedData, error: deleteError } = await supabase.rpc("admin_delete_account", {
    target_user: userId,
    confirm_email: confirmEmail,
    reason,
  });
  if (deleteError) {
    const already =
      canceled > 0
        ? ` (${countLabel(canceled, "assinatura no provedor já foi cancelada", "assinaturas no provedor já foram canceladas")}.)`
        : "";
    return { ok: false, error: `${deletionMessage(deleteError.message)}${already}` };
  }
  const deleted = deletedData as { deletedFirms: string[]; counts: Record<string, number> };

  const storage = await purgeAccountStorage(session, deleted.deletedFirms, userId);
  await recordAudit(supabase, "admin.account.storage_purged", {
    entityType: "user",
    entityId: userId,
    metadata: { firms: deleted.deletedFirms, ...storage },
  });
  refresh();

  return {
    ok: true,
    data: {
      deletedFirms: deleted.deletedFirms,
      counts: deleted.counts,
      canceledSubscriptions: canceled,
      storage,
    },
  };
}

/** Second attempt at the files of an already-deleted account. */
export async function retryAccountStoragePurge(
  userId: string,
  orgIds: string[],
): Promise<AdminActionResult<StoragePurgeResult>> {
  if (!UUID.test(userId) || orgIds.some((id) => !UUID.test(id))) return { ok: false, error: "invalid" };
  const session = await requireSuperadmin();
  if (!session) return { ok: false, error: "forbidden" };
  if (!isServiceConfigured()) return { ok: false, error: "not-configured" };

  const storage = await purgeAccountStorage(session, orgIds, userId);
  await recordAudit(session.supabase, "admin.account.storage_purged", {
    entityType: "user",
    entityId: userId,
    metadata: { firms: orgIds, retry: true, ...storage },
  });
  return { ok: true, data: storage };
}
