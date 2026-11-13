import "server-only";

import { randomBytes } from "node:crypto";

import { ensureAccount, serviceAccount, userToken } from "@/lib/chatwoot/accounts";
import { chatwootProvider, FIRST_UI_SETTINGS } from "@/lib/chatwoot/provider";
import type { MemberContext } from "@/lib/member/context";
import { createServiceClient } from "@flyee/auth/service";
import { ChatwootRequestError, ChatwootUnavailableError } from "@flyee/chatwoot/types";

/**
 * A person of the firm enters the firm's panel from ONE (migration 0223), signed in: the firm's account is made
 * when it is not there yet, the person is made in the panel as an agent of it (an existing person of their e-mail
 * is taken, unless they administer another account, as the instance's super administrator does), joins its
 * inbox, sees every conversation the first time, and gets the link that enters signed in (five minutes, once).
 * The link enters the firm's account, on the conversation asked for when it is one of the firm's the panel already
 * has (`sso_account_id` and `sso_conversation_id`, which Chatwoot 4.19.1 reads in `getLoginRedirectURL`); without
 * one, on the panel's list, where every conversation of the firm is, ONE's included.
 * The firm's settings stay in ONE: nobody of the firm administers the panel. A support visit enters nobody's panel.
 */

export type PanelOutcome = { ok: true; url: string } | { ok: false; code: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function openPanel(
  context: MemberContext,
  target: { conversation?: string | null } = {},
): Promise<PanelOutcome> {
  const provider = chatwootProvider();
  if (!provider) return { ok: false, code: "not_configured" };

  const { data: entered, error } = await context.supabase.rpc("chatwoot_panel_entry");
  if (error) return { ok: false, code: "failed" };
  const entry = (entered ?? {}) as { ok?: boolean; code?: string; org_id?: string; person_id?: string; name?: string };
  if (!entry.ok || !entry.org_id || !entry.person_id) return { ok: false, code: entry.code ?? "failed" };
  const orgId = entry.org_id;
  const personId = entry.person_id;
  const email = context.email.trim().toLowerCase();
  if (!email) return { ok: false, code: "no_email" };
  const name = (entry.name || context.profile.displayName || email.split("@")[0] || "Equipe").slice(0, 100);

  const service = createServiceClient();
  const made = await ensureAccount(service, provider, orgId);
  if (!made.ok) return { ok: false, code: made.code };
  const account = made.account;

  try {
    const { data: known } = await service
      .from("chatwoot_staff")
      .select("chatwoot_user_id")
      .eq("org_id", orgId)
      .eq("user_id", personId)
      .maybeSingle();
    let userId = (known as { chatwoot_user_id?: number } | null)?.chatwoot_user_id ?? null;
    const joining = !userId;
    if (!userId) {
      userId = (
        await provider.platform.createUser({ name, email, password: `${randomBytes(24).toString("base64url")}Aa1!` })
      ).id;
      if (userId === account.serviceUserId || userId === account.phoneUserId)
        return { ok: false, code: "reserved_user" };
      const person = await provider.platform.user(userId);
      // Somebody who administers another account (the instance's super administrator) would enter that account.
      if (person.accounts.some((item) => item.id !== account.accountId && item.role === "administrator")) {
        return { ok: false, code: "email_is_admin" };
      }
      // A person is in one firm at a time: the panel of a firm they left is not theirs any more.
      for (const item of person.accounts) {
        if (item.id !== account.accountId) await provider.platform.removeAccountUser(item.id, userId);
      }
      const { data: kept, error: notKept } = await service.rpc("chatwoot_keep_person", {
        target_org: orgId,
        target_person: personId,
        target_user: userId,
      });
      if (notKept || !(kept as { ok?: boolean } | null)?.ok) return { ok: false, code: "failed" };
    } else {
      await provider.platform.updateUser(userId, { name, display_name: name });
    }
    // Calling again puts back what somebody undid in the panel: the role, and the inbox.
    await provider.platform.addAccountUser(account.accountId, userId, "agent");
    await (await serviceAccount(provider, account)).addInboxMembers(account.inboxId, [userId]);
    if (joining) await provider.profile(await userToken(provider, userId)).mergeUiSettings(FIRST_UI_SETTINGS);

    const url = new URL(await provider.platform.ssoLink(userId));
    url.searchParams.set("sso_account_id", String(account.accountId));
    const conversation = await panelConversationOf(context, orgId, target.conversation);
    if (conversation) url.searchParams.set("sso_conversation_id", String(conversation));
    return { ok: true, url: url.toString() };
  } catch (failure) {
    return {
      ok: false,
      code:
        failure instanceof ChatwootUnavailableError
          ? "chatwoot_unavailable"
          : failure instanceof ChatwootRequestError
            ? `chatwoot_${failure.status}`
            : "failed",
    };
  }
}

/**
 * The panel's number of a conversation of the firm, read in the person's own session: one of another firm, or one
 * the panel has not been given yet, has none, and the panel opens on its list.
 */
async function panelConversationOf(
  context: MemberContext,
  orgId: string,
  conversation: string | null | undefined,
): Promise<number | null> {
  if (!conversation || !UUID.test(conversation)) return null;
  const { data, error } = await context.supabase
    .from("wa_conversations")
    .select("chatwoot_conversation_id")
    .eq("id", conversation)
    .eq("org_id", orgId)
    .maybeSingle();
  if (error) return null;
  const id = Number((data as { chatwoot_conversation_id?: number | string | null } | null)?.chatwoot_conversation_id);
  return Number.isInteger(id) && id > 0 ? id : null;
}
