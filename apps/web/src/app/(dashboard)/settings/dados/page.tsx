import DataView, { type DataState } from "./data-view";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import { clearPreviewOf } from "@/lib/firm/clear-data";
import { getMemberContext } from "@/lib/member/context";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("product");
  return { title: t("settings-data") };
}

/**
 * /settings/dados: the firm's cases and clients cleared at once, to start the tests again (migration 0161). Who
 * decides for the firm reads what would go and clears it with the second factor and the word typed; anybody else is
 * told whose it is. Read under the person's own session.
 */
async function loadData(): Promise<DataState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };
  const [preview, assurance, cookieStore] = await Promise.all([
    context.supabase.rpc("firm_clear_preview", { target_org: context.firm.id }),
    context.supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
    cookies(),
  ]);
  if (preview.error) return { kind: "error" };
  const read = clearPreviewOf(preview.data);
  if (!read.ok && read.code === "failed") return { kind: "error" };
  return {
    kind: "ready",
    preview: read,
    supportVisit: cookieStore.has(IMPERSONATION_MARKER_COOKIE),
    factor:
      assurance.data?.currentLevel === "aal2" ? "ok" : assurance.data?.nextLevel === "aal2" ? "challenge" : "missing",
  };
}

export default async function SettingsDataPage() {
  return <DataView state={await loadData()} />;
}
