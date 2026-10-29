import { SwitchAccountButton } from "../../convite/[token]/accept-button";
import { AcceptPartnerInvitationButton } from "./accept-button";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { Box, Button, Typography } from "@mui/material";

import { TokenPageFrame as Frame, TokenPageMessage as Message } from "@/components/auth/token-page-frame";
import { moduleOf } from "@/lib/modules/registry";
import { PARTNER_AREA } from "@/lib/partners/partner";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/server";

/**
 * The page behind the link of an invitation to a partner (migration 0069): a firm inviting a travel agency to be
 * its partner, or the agency inviting a colleague. Public by its token, as the invitation to a firm is
 * (`/convite/[token]`): it shows who invites, the agency, the module and the invited address MASKED, and grants
 * nothing by itself. Accepting takes an account whose confirmed e-mail is the invited one, in no firm, which the
 * database checks. No referrer, no index, no tracker.
 */
export const metadata: Metadata = {
  title: "Convite de parceria",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Preview = {
  found?: boolean;
  id?: string;
  kind?: "firm" | "team";
  firm?: string | null;
  partner?: string | null;
  module?: string | null;
  invited_by?: string | null;
  email_hint?: string;
  expires_at?: string;
  status?: "open" | "accepted" | "revoked" | "expired";
  for_this_account?: boolean;
};

export default async function PartnerInvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("product");
  const here = `/parceria/${encodeURIComponent(token)}`;
  const signInHref = `/auth/sign-in?next=${encodeURIComponent(here)}`;
  const signUpHref = `/auth/sign-up?next=${encodeURIComponent(here)}`;

  if (!isSupabaseConfigured) {
    return (
      <Frame>
        <Message title={t("partner-invite-unavailable-title")} body={t("partner-invite-unavailable-body")} />
      </Frame>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data, error } = await supabase.rpc("partner_invitation_preview", { target_token: token });
  const preview = (data ?? {}) as Preview;

  if (error || !preview.found || !preview.id) {
    return (
      <Frame>
        <Message title={t("partner-invite-missing-title")} body={t("partner-invite-missing-body")}>
          <Button href="/auth/sign-in" variant="outlined" color="grey">
            {t("partner-invite-go-sign-in")}
          </Button>
        </Message>
      </Frame>
    );
  }

  const partner = preview.partner ?? "";
  const inviter = preview.kind === "firm" ? (preview.firm ?? "") : partner;

  if (preview.status === "expired" || preview.status === "revoked") {
    return (
      <Frame>
        <Message
          title={preview.status === "expired" ? t("partner-invite-expired-title") : t("partner-invite-revoked-title")}
          body={t("partner-invite-ask-again", { inviter })}
        />
      </Frame>
    );
  }

  if (preview.status === "accepted") {
    return (
      <Frame>
        <Message title={t("partner-invite-accepted-title")} body={t("partner-invite-accepted-body", { partner })}>
          <Button href={user ? PARTNER_AREA : "/auth/sign-in"} variant="contained">
            {user ? t("partner-invite-open") : t("partner-invite-go-sign-in")}
          </Button>
        </Message>
      </Frame>
    );
  }

  const moduleKey = preview.module ? moduleOf(preview.module)?.nameKey : null;
  const expires = preview.expires_at
    ? new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: "America/Sao_Paulo" }).format(
        new Date(preview.expires_at),
      )
    : null;

  // An account in a firm joins no partner; one already in a partner may take a firm's invitation (the database
  // decides) but no colleague's.
  let inFirm = false;
  if (user) {
    const { data: membership } = await supabase
      .from("memberships")
      .select("org_id")
      .eq("user_id", user.id)
      .maybeSingle();
    inFirm = Boolean(membership);
  }

  return (
    <Frame>
      <Box className="flex flex-col gap-6">
        <Box className="flex flex-col">
          <Typography variant="h1" component="h1" className="mb-2 break-words">
            {preview.kind === "firm"
              ? t("partner-invite-title-firm", { partner })
              : t("partner-invite-title-team", { partner })}
          </Typography>
          <Typography variant="body1" className="text-text-primary">
            {preview.kind === "firm"
              ? t("partner-invite-body-firm", { firm: preview.firm ?? "", partner })
              : preview.invited_by
                ? t("partner-invite-body-team", { inviter: preview.invited_by, partner })
                : t("partner-invite-body-team-unknown", { partner })}
          </Typography>
        </Box>

        <Box component="dl" className="border-grey-100 m-0 flex flex-col gap-2 rounded-2xl border p-4">
          {moduleKey ? (
            <Box className="flex flex-row flex-wrap gap-x-2">
              <Typography variant="body2" component="dt" className="text-text-secondary">
                {t("partner-invite-module")}
              </Typography>
              <Typography variant="body2" component="dd" className="m-0 font-semibold">
                {t(moduleKey)}
              </Typography>
            </Box>
          ) : null}
          <Box className="flex flex-row flex-wrap gap-x-2">
            <Typography variant="body2" component="dt" className="text-text-secondary">
              {t("partner-invite-email")}
            </Typography>
            <Typography variant="body2" component="dd" className="m-0 font-semibold break-all">
              {preview.email_hint}
            </Typography>
          </Box>
          {expires ? (
            <Box className="flex flex-row flex-wrap gap-x-2">
              <Typography variant="body2" component="dt" className="text-text-secondary">
                {t("partner-invite-expires")}
              </Typography>
              <Typography variant="body2" component="dd" className="m-0 font-semibold">
                {expires}
              </Typography>
            </Box>
          ) : null}
        </Box>

        <Typography variant="body2" className="text-text-secondary">
          {t("partner-invite-privacy")}
        </Typography>

        {!user ? (
          <Box className="flex flex-col gap-3">
            <Typography variant="body2" className="text-text-secondary">
              {t("partner-invite-signed-out-hint")}
            </Typography>
            <Button href={signUpHref} variant="contained">
              {t("partner-invite-sign-up")}
            </Button>
            <Button href={signInHref} variant="outlined" color="grey">
              {t("partner-invite-sign-in")}
            </Button>
          </Box>
        ) : inFirm ? (
          <Typography variant="body1" className="text-text-primary">
            {t("partner-error-in-firm")}
          </Typography>
        ) : preview.for_this_account ? (
          <AcceptPartnerInvitationButton invitationId={preview.id} />
        ) : (
          <Box className="flex flex-col gap-3">
            <Typography variant="body1" className="text-text-primary">
              {t("partner-invite-wrong-account", { current: user.email ?? "", email: preview.email_hint ?? "" })}
            </Typography>
            <SwitchAccountButton next={here} />
          </Box>
        )}
      </Box>
    </Frame>
  );
}
