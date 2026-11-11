import MessagesView, { type MessagesState } from "./messages-view";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import type { SecondFactorState } from "@/lib/ai/approvals";
import { readFirmMessages } from "@/lib/firm/message-actions";
import { isManager } from "@/lib/firm/roles";
import { getMemberContext } from "@/lib/member/context";
import { firmNotices } from "@/lib/notices/facts";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("product");
  return { title: t("settings-messages") };
}

/**
 * /settings/mensagens: ONE's messages in a conversation, each with where it goes and the values it carries, and the
 * firm's own words of it (migration 0191): who decides for the firm writes a version, checked before it counts, puts
 * an earlier one back or goes back to ONE's words; anybody of the firm reads them. And the notices of a client's own
 * lawsuit (0038), which who manages the firm turns on with the second factor.
 */
async function loadMessages(): Promise<MessagesState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };
  const [read, decides, cookieStore, notices, assurance] = await Promise.all([
    readFirmMessages(),
    context.supabase.rpc("decides_for_firm", { target_org: context.firm.id }),
    cookies(),
    firmNotices(context.supabase, context.firm.id).catch(() => null),
    context.supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);
  if (!read.ok) return { kind: "error" };
  const supportVisit = cookieStore.has(IMPERSONATION_MARKER_COOKIE);
  const secondFactor: SecondFactorState =
    assurance.data?.currentLevel === "aal2" ? "ok" : assurance.data?.nextLevel === "aal2" ? "challenge" : "missing";
  return {
    kind: "ready",
    messages: read.data.messages,
    editable: !decides.error && decides.data === true && !supportVisit,
    notices: notices ? { notices, manager: isManager(context.firm.role), supportVisit, secondFactor } : null,
  };
}

export default async function SettingsMessagesPage() {
  return <MessagesView state={await loadMessages()} />;
}
