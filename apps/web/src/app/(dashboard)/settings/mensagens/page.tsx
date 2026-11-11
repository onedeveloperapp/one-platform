import MessagesView, { type MessagesState } from "./messages-view";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { getTranslations } from "next-intl/server";

import { readFirmMessages } from "@/lib/firm/message-actions";
import { getMemberContext } from "@/lib/member/context";
import { IMPERSONATION_MARKER_COOKIE } from "@flyee/auth";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("product");
  return { title: t("settings-messages") };
}

/**
 * /settings/mensagens: ONE's messages in a conversation, each with where it goes and the values it carries, and the
 * firm's own words of it (migration 0191): who decides for the firm writes a version, checked before it counts, puts
 * an earlier one back or goes back to ONE's words; anybody of the firm reads them.
 */
async function loadMessages(): Promise<MessagesState> {
  const context = await getMemberContext();
  if (!context) return { kind: "unavailable" };
  if (!context.firm) return { kind: "no-firm" };
  const [read, decides, cookieStore] = await Promise.all([
    readFirmMessages(),
    context.supabase.rpc("decides_for_firm", { target_org: context.firm.id }),
    cookies(),
  ]);
  if (!read.ok) return { kind: "error" };
  return {
    kind: "ready",
    messages: read.data.messages,
    editable: !decides.error && decides.data === true && !cookieStore.has(IMPERSONATION_MARKER_COOKIE),
  };
}

export default async function SettingsMessagesPage() {
  return <MessagesView state={await loadMessages()} />;
}
