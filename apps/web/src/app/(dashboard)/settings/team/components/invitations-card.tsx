"use client";

import { type TeamData, teamErrorKey, type TeamInvitation } from "../team-types";
import { useTranslations } from "next-intl";
import { useSnackbar } from "notistack";
import { useState } from "react";

import { Box, Button, Card, CardContent, Grid, Typography } from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import StatusChip from "@/components/product/status-chip";
import NiEmail from "@/icons/nexture/ni-email";
import { inviteToFirm, revokeInvitation } from "@/lib/firm/actions";
import { FUNCTION_LABEL_KEY, ROLE_LABEL_KEY } from "@/lib/firm/roles";

/** "em 3 dias", "amanhã", "hoje": how long an invitation still has. */
function daysLeft(expiresAt: string, now: number): number {
  return Math.max(0, Math.ceil((new Date(expiresAt).getTime() - now) / 86_400_000));
}

/**
 * The invitations waiting for an answer. Each one is a seat already promised,
 * so a manager sees who has not answered yet, sends the link again or takes
 * the invitation back.
 */
export default function InvitationsCard({
  data,
  onChanged,
  onInvite,
}: {
  data: TeamData;
  onChanged: () => void;
  onInvite: () => void;
}) {
  const t = useTranslations("product");
  const { enqueueSnackbar } = useSnackbar();
  const [busy, setBusy] = useState<string | null>(null);
  // Read once per render pass of this card: the label is "days left", not a clock.
  const [now] = useState(() => Date.now());

  const revoke = async (invitation: TeamInvitation) => {
    setBusy(invitation.id);
    const result = await revokeInvitation(invitation.id);
    setBusy(null);
    if (!result.ok) {
      enqueueSnackbar(t(teamErrorKey(result.code)), { variant: "error" });
      return;
    }
    enqueueSnackbar(t("team-invitation-revoked", { email: invitation.email }), { variant: "success" });
    onChanged();
  };

  /** Inviting the same address again replaces the link: the new one is the one that works. */
  const resend = async (invitation: TeamInvitation) => {
    setBusy(invitation.id);
    const result = await inviteToFirm({
      email: invitation.email,
      role: invitation.role,
      firmFunction: invitation.firmFunction,
    });
    setBusy(null);
    if (!result.ok) {
      enqueueSnackbar(t(teamErrorKey(result.code)), { variant: "error" });
      return;
    }
    if (result.emailed) {
      enqueueSnackbar(t("team-invite-emailed", { email: invitation.email }), { variant: "success" });
    } else {
      // The e-mail could not leave: the new link goes to the clipboard, so the
      // manager sends it by hand. The invitation exists either way.
      let copied = false;
      try {
        if (result.link) {
          await navigator.clipboard.writeText(result.link);
          copied = true;
        }
      } catch {
        copied = false;
      }
      enqueueSnackbar(
        t(copied ? "team-invitation-resent-copied" : "team-invitation-resent-no-email", { email: invitation.email }),
        { variant: "warning" },
      );
    }
    onChanged();
  };

  return (
    <Grid size={12}>
      <Card component="section" aria-labelledby="team-invitations">
        <CardContent className="flex flex-col gap-5">
          <Box className="flex flex-col gap-1">
            <Typography id="team-invitations" variant="h5" component="h2" className="mb-0">
              {t("team-invitations-title")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {t("team-invitations-body")}
            </Typography>
          </Box>

          {data.invitations.length === 0 ? (
            <EmptyState
              icon={<NiEmail size="large" />}
              title={t("team-invitations-empty-title")}
              description={t("team-invitations-empty-body")}
              action={{ label: t("team-invite"), onClick: onInvite }}
              className="py-10"
            />
          ) : (
            <Box component="ul" className="m-0 flex list-none flex-col p-0">
              {data.invitations.map((invitation) => {
                const left = daysLeft(invitation.expiresAt, now);
                return (
                  <Box
                    component="li"
                    key={invitation.id}
                    className="border-grey-100 flex flex-col gap-3 border-b py-4 last:border-b-0 sm:flex-row sm:items-center"
                  >
                    <Box className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <Typography variant="subtitle2" component="p" className="break-all">
                        {invitation.email}
                      </Typography>
                      <Box className="flex flex-row flex-wrap items-center gap-1.5">
                        <StatusChip label={t(FUNCTION_LABEL_KEY[invitation.firmFunction])} tone="info" />
                        {invitation.role === "admin" && <StatusChip label={t(ROLE_LABEL_KEY.admin)} tone="neutral" />}
                        <Typography variant="body2" className="text-text-secondary">
                          {left <= 1 ? t("team-invitation-expires-soon") : t("team-invitation-expires", { days: left })}
                        </Typography>
                      </Box>
                    </Box>
                    <Box className="flex flex-row gap-2">
                      <Button
                        variant="outlined"
                        color="grey"
                        size="small"
                        onClick={() => void resend(invitation)}
                        disabled={busy !== null}
                      >
                        {t("team-invitation-resend")}
                      </Button>
                      <Button
                        variant="text"
                        color="grey"
                        size="small"
                        onClick={() => void revoke(invitation)}
                        disabled={busy !== null}
                      >
                        {t("team-invitation-revoke")}
                      </Button>
                    </Box>
                  </Box>
                );
              })}
            </Box>
          )}
        </CardContent>
      </Card>
    </Grid>
  );
}
