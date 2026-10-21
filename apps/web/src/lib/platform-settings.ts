import { BRAND } from "@/brand";
import { createAnonClient } from "@/lib/public-content";

export type SupportChannels = {
  whatsapp: string;
  email: string;
  helpCenter: string;
};

/**
 * Quick-support channels for the floating widget, configured by the
 * superadmin at /admin/support (platform_settings table, 'support' key).
 * Falls back to the static BRAND.support values — and degrades to them
 * whenever Supabase is not configured — so the widget's "hidden until a
 * human channel exists" contract keeps working on a fresh clone.
 */
export async function getSupportChannels(): Promise<SupportChannels> {
  const fallback: SupportChannels = { ...BRAND.support };

  const supabase = createAnonClient();
  if (!supabase) return fallback;

  const { data, error } = await supabase.from("platform_settings").select("value").eq("key", "support").maybeSingle();
  if (error || !data?.value) return fallback;

  const value = data.value as Partial<SupportChannels>;
  return {
    whatsapp: typeof value.whatsapp === "string" ? value.whatsapp : fallback.whatsapp,
    email: typeof value.email === "string" ? value.email : fallback.email,
    helpCenter: fallback.helpCenter,
  };
}

/** The company that operates ONE, as the footer names it. */
export type LegalEntity = {
  name: string;
  /** CNPJ, digits only. */
  document: string | null;
  city: string | null;
};

/**
 * The operating company (platform_settings `legal_entity`, migration 0019,
 * filled in by the superadmin at /admin/support). The terms and the privacy
 * policy point at the site footer to identify the operator, so the footer
 * renders this line; null until a name is set.
 */
export async function getLegalEntity(): Promise<LegalEntity | null> {
  const supabase = createAnonClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("platform_settings")
    .select("value")
    .eq("key", "legal_entity")
    .maybeSingle();
  if (error || !data?.value) return null;

  const value = data.value as { name?: unknown; document?: unknown; city?: unknown };
  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name) return null;
  const digits = typeof value.document === "string" ? value.document.replace(/[^0-9]/g, "") : "";
  const city = typeof value.city === "string" ? value.city.trim() : "";
  return { name, document: digits || null, city: city || null };
}
