import type { SupabaseClient } from "@supabase/supabase-js";

export interface AuditEventInput {
  /** Null for platform-level events (superadmin actions outside any tenant). */
  orgId: string | null;
  /**
   * Null when no human acted: provider webhooks and cron jobs also produce
   * events worth keeping (a superseded subscription that could not be
   * cancelled at the provider is a double charge waiting to happen). The
   * column has always been nullable — only this type disagreed.
   */
  actorId: string | null;
  /** Project-defined verb, e.g. "patient.viewed", "document.issued". */
  action: string;
  entityType?: string;
  entityId?: string;
  /** Extra context. Never put secrets here. */
  metadata?: Record<string, unknown>;
}

/**
 * Append one audit event. Fire-and-forget by design: auditing must never
 * take the main flow down, so failures are returned, not thrown.
 */
export async function logAuditEvent(
  supabase: SupabaseClient,
  input: AuditEventInput,
): Promise<{ ok: boolean; error?: string }> {
  const { error } = await supabase.from("audit_events").insert({
    org_id: input.orgId,
    actor_id: input.actorId,
    action: input.action,
    entity_type: input.entityType ?? null,
    entity_id: input.entityId ?? null,
    metadata: input.metadata ?? {},
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export interface AcceptTermsInput {
  /** consent_terms slugs, e.g. ["terms", "privacy"] or ["cli-connection"]. */
  slugs: string[];
  /** The language the texts were shown in; falls back to EN, then pt-BR. */
  locale?: "pt-BR" | "en";
  /**
   * Where it was accepted. Only `source`, `client_id` and `plan` (short
   * strings) are stored; anything else is dropped by the database.
   */
  context?: { source?: string; client_id?: string; plan?: string };
}

export interface AcceptedTerm {
  slug: string;
  locale: string;
  version: number;
  /** True when this exact version had already been accepted. */
  already: boolean;
}

/**
 * Records that the signed-in member accepts the texts in force for each slug,
 * through the `accept_terms` RPC (migration 0001): idempotent per version,
 * refused during a support visit, and the only way an acceptance is written.
 * Call it with the member's own session client.
 */
export async function acceptTerms(
  supabase: SupabaseClient,
  input: AcceptTermsInput,
): Promise<{ ok: true; terms: AcceptedTerm[] } | { ok: false; error: string }> {
  const { data, error } = await supabase.rpc("accept_terms", {
    p_slugs: input.slugs,
    p_locale: input.locale ?? "pt-BR",
    p_context: input.context ?? {},
  });
  if (error) return { ok: false, error: error.message };
  return { ok: true, terms: (data ?? []) as AcceptedTerm[] };
}

/** True when the member has a non-revoked acceptance of the slug's text in force. */
export async function hasAcceptedCurrentTerm(
  supabase: SupabaseClient,
  params: { userId: string; slug: string },
): Promise<boolean> {
  const { data } = await supabase
    .from("consent_acceptances")
    .select("id, consent_terms!inner(slug, is_active)")
    .eq("user_id", params.userId)
    .eq("consent_terms.slug", params.slug)
    .eq("consent_terms.is_active", true)
    .is("revoked_at", null)
    .limit(1);
  return (data?.length ?? 0) > 0;
}
