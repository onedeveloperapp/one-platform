import { AcceptInvitationButton, SwitchAccountButton } from "./accept-button";
import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

import { Box, Button, Paper, Typography } from "@mui/material";

import Logo from "@/components/logo/logo";
import { FUNCTION_LABEL_KEY, isFirmFunction } from "@/lib/firm/roles";
import { isSupabaseConfigured } from "@flyee/auth";
import { createClient } from "@flyee/auth/server";

/**
 * The page behind the link of an invitation to a firm (migration 0003).
 *
 * It is opened from an e-mail, before the person signs in or even has an
 * account, so it is public by its token and shows only what an invitation
 * says: the firm, who invites, the function, and the invited address MASKED.
 * The link grants nothing by itself: accepting takes an account whose
 * confirmed e-mail is the invited one, which the database checks.
 *
 * The token is in the address, so the page asks browsers to send no referrer
 * and search engines to keep away, and it loads no tracker.
 */
export const metadata: Metadata = {
  title: "Convite",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

type Preview = {
  found?: boolean;
  id?: string;
  firm?: string | null;
  invited_by?: string | null;
  firm_function?: string;
  email_hint?: string;
  expires_at?: string;
  status?: "open" | "accepted" | "revoked" | "expired";
  for_this_account?: boolean;
};

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <Box className="bg-waves flex min-h-screen w-full items-center justify-center bg-cover bg-center p-4">
      <Paper elevation={3} className="bg-background-paper shadow-darker-xs w-lg max-w-full rounded-4xl py-14">
        <Box className="flex flex-col gap-10 px-8 sm:px-14">
          <Box className="flex justify-center">
            <Logo classNameFull="h-12 w-auto" classNameMobile="hidden" />
          </Box>
          {children}
        </Box>
      </Paper>
    </Box>
  );
}

function Message({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <Box className="flex flex-col gap-6">
      <Box className="flex flex-col">
        <Typography variant="h1" component="h1" className="mb-2">
          {title}
        </Typography>
        <Typography variant="body1" className="text-text-primary">
          {body}
        </Typography>
      </Box>
      {children}
    </Box>
  );
}

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const t = await getTranslations("auth");
  const tp = await getTranslations("product");
  const here = `/convite/${encodeURIComponent(token)}`;
  const signInHref = `/auth/sign-in?next=${encodeURIComponent(here)}`;
  const signUpHref = `/auth/sign-up?next=${encodeURIComponent(here)}`;

  if (!isSupabaseConfigured) {
    return (
      <Frame>
        <Message title={t("invite-unavailable-title")} body={t("invite-unavailable-body")} />
      </Frame>
    );
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data, error } = await supabase.rpc("firm_invitation_preview", { target_token: token });
  const preview = (data ?? {}) as Preview;

  if (error || !preview.found || !preview.id) {
    return (
      <Frame>
        <Message title={t("invite-missing-title")} body={t("invite-missing-body")}>
          <Button href="/auth/sign-in" variant="outlined" color="grey">
            {t("invite-go-sign-in")}
          </Button>
        </Message>
      </Frame>
    );
  }

  const firm = preview.firm ?? "";

  if (preview.status === "expired" || preview.status === "revoked") {
    const title = preview.status === "expired" ? t("invite-expired-title") : t("invite-revoked-title");
    return (
      <Frame>
        <Message title={title} body={t("invite-ask-again", { firm })} />
      </Frame>
    );
  }

  if (preview.status === "accepted") {
    return (
      <Frame>
        <Message title={t("invite-accepted-title")} body={t("invite-accepted-body", { firm })}>
          <Button href={user ? "/inicio" : "/auth/sign-in"} variant="contained">
            {user ? t("invite-open-app") : t("invite-go-sign-in")}
          </Button>
        </Message>
      </Frame>
    );
  }

  const functionLabel = isFirmFunction(preview.firm_function) ? tp(FUNCTION_LABEL_KEY[preview.firm_function]) : null;
  const expires = preview.expires_at
    ? new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "long", timeZone: "America/Sao_Paulo" }).format(
        new Date(preview.expires_at),
      )
    : null;

  // An account that is already in a firm cannot join a second one.
  let alreadyInFirm = false;
  if (user) {
    const { data: membership } = await supabase
      .from("memberships")
      .select("org_id")
      .eq("user_id", user.id)
      .maybeSingle();
    alreadyInFirm = Boolean(membership);
  }

  return (
    <Frame>
      <Box className="flex flex-col gap-6">
        <Box className="flex flex-col">
          <Typography variant="h1" component="h1" className="mb-2 break-words">
            {t("invite-title", { firm })}
          </Typography>
          <Typography variant="body1" className="text-text-primary">
            {preview.invited_by
              ? t("invite-body", { inviter: preview.invited_by, firm })
              : t("invite-body-unknown", { firm })}
          </Typography>
        </Box>

        <Box component="dl" className="border-grey-100 m-0 flex flex-col gap-2 rounded-2xl border p-4">
          {functionLabel ? (
            <Box className="flex flex-row flex-wrap gap-x-2">
              <Typography variant="body2" component="dt" className="text-text-secondary">
                {t("invite-function")}
              </Typography>
              <Typography variant="body2" component="dd" className="m-0 font-semibold">
                {functionLabel}
              </Typography>
            </Box>
          ) : null}
          <Box className="flex flex-row flex-wrap gap-x-2">
            <Typography variant="body2" component="dt" className="text-text-secondary">
              {t("invite-email")}
            </Typography>
            <Typography variant="body2" component="dd" className="m-0 font-semibold break-all">
              {preview.email_hint}
            </Typography>
          </Box>
          {expires ? (
            <Box className="flex flex-row flex-wrap gap-x-2">
              <Typography variant="body2" component="dt" className="text-text-secondary">
                {t("invite-expires")}
              </Typography>
              <Typography variant="body2" component="dd" className="m-0 font-semibold">
                {expires}
              </Typography>
            </Box>
          ) : null}
        </Box>

        {!user ? (
          <Box className="flex flex-col gap-3">
            <Typography variant="body2" className="text-text-secondary">
              {t("invite-signed-out-hint")}
            </Typography>
            <Button href={signUpHref} variant="contained">
              {t("invite-sign-up")}
            </Button>
            <Button href={signInHref} variant="outlined" color="grey">
              {t("invite-sign-in")}
            </Button>
          </Box>
        ) : alreadyInFirm ? (
          <Typography variant="body1" className="text-text-primary">
            {t("invite-already-in-firm")}
          </Typography>
        ) : preview.for_this_account ? (
          <AcceptInvitationButton invitationId={preview.id} />
        ) : (
          <Box className="flex flex-col gap-3">
            <Typography variant="body1" className="text-text-primary">
              {t("invite-wrong-account", { current: user.email ?? "", email: preview.email_hint ?? "" })}
            </Typography>
            <SwitchAccountButton next={here} />
          </Box>
        )}
      </Box>
    </Frame>
  );
}
