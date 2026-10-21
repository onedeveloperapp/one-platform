import { createAnonClient } from "@/lib/public-content";
import { PROVIDER_MAX_INSTALLMENTS } from "@flyee/billing/currency";

/**
 * The most installments the checkout offers on a yearly BRL plan
 * (`platform_settings.billing.max_installments`, migration 0004), clamped to
 * the providers' own ceiling. 1 means no installments, which is also what an
 * unreadable setting yields: offering a split the server would refuse fails at
 * the last step of the purchase.
 */
export async function getMaxInstallments(): Promise<number> {
  const supabase = createAnonClient();
  if (!supabase) return 1;
  const { data, error } = await supabase.from("platform_settings").select("value").eq("key", "billing").maybeSingle();
  if (error) return 1;
  const configured = Math.floor(Number((data?.value as { max_installments?: unknown } | null)?.max_installments));
  if (!Number.isFinite(configured) || configured < 1) return 1;
  return Math.min(configured, PROVIDER_MAX_INSTALLMENTS);
}
