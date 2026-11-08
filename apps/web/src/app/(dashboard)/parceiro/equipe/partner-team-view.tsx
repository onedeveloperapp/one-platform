"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  FormControl,
  FormHelperText,
  FormLabel,
  Grid,
  Input,
  Typography,
} from "@mui/material";

import PartnerInvitePanel from "@/components/partners/partner-invite-panel";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import PageHeader from "@/components/product/page-header";
import StatusChip from "@/components/product/status-chip";
import NiUserPlus from "@/icons/nexture/ni-user-plus";
import { removePartnerMember, renamePartner, revokePartnerInvitation } from "@/lib/partners/actions";
import type { PartnerTeammate, PartnerTeamState } from "@/lib/partners/facts";
import { isPartnerManager, type MemberPartner, PARTNER_ROLE_KEY, partnerErrorKey } from "@/lib/partners/partner";

const day = (value: string) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value))
    : "";

/**
 * The team of a travel agency partner of a firm (migration 0069). Who manages the agency brings colleagues in and
 * keeps the agency's name right; everybody finds who works there and can leave. A handful of people, so a roster,
 * never a table.
 */
export default function PartnerTeamView({
  state,
  partner,
}: {
  state: PartnerTeamState;
  partner: MemberPartner | null;
}) {
  const t = useTranslations("product");
  const router = useRouter();
  const [inviting, setInviting] = useState(false);
  const [removing, setRemoving] = useState<PartnerTeammate | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [name, setName] = useState(partner?.name ?? "");
  const [renamed, setRenamed] = useState(false);
  const [busy, setBusy] = useState(false);
  const refresh = () => router.refresh();

  const ready = state.kind === "ready" ? state : null;
  const manager = isPartnerManager(partner?.role);
  const owner = partner?.role === "owner";

  // Who may take whom out: the owner anybody but themself, an admin a member; anybody but the owner leaves.
  const mayRemove = (teammate: PartnerTeammate) => {
    if (teammate.role === "owner") return false;
    if (teammate.userId === ready?.me) return true;
    return owner || (partner?.role === "admin" && teammate.role === "member");
  };

  const revoke = async (invitationId: string) => {
    setProblem(null);
    const result = await revokePartnerInvitation(invitationId);
    if (!result.ok) setProblem(result.code);
    refresh();
  };

  const rename = async () => {
    setBusy(true);
    setProblem(null);
    setRenamed(false);
    const result = await renamePartner(name).catch(() => ({ ok: false as const, code: "failed" }));
    setBusy(false);
    if (!result.ok) {
      setProblem(result.code);
      return;
    }
    setRenamed(true);
    refresh();
  };

  return (
    <Grid container spacing={5}>
      <Grid size={12}>
        <PageHeader
          title={t("partner-team-title")}
          crumbs={[{ label: t("partner-home-title"), href: "/parceiro" }, { label: t("partner-team-title") }]}
          description={partner ? t("partner-team-description", { partner: partner.name }) : undefined}
          action={
            manager && partner && partner.links.length > 0 ? (
              <Button variant="contained" startIcon={<NiUserPlus size="medium" />} onClick={() => setInviting(true)}>
                {t("partner-team-invite")}
              </Button>
            ) : undefined
          }
        />
      </Grid>

      {state.kind === "unavailable" && (
        <Grid size={12}>
          <Alert severity="info" className="neutral bg-background-paper/60!">
            {t("partner-unavailable")}
          </Alert>
        </Grid>
      )}

      {state.kind === "error" && (
        <Grid size={12}>
          <Alert
            severity="error"
            className="neutral bg-background-paper/60!"
            action={
              <Button color="inherit" size="small" onClick={refresh}>
                {t("partners-retry")}
              </Button>
            }
          >
            {t("partner-team-load-error")}
          </Alert>
        </Grid>
      )}

      {problem && (
        <Grid size={12}>
          <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
            {t(partnerErrorKey(problem))}
          </Alert>
        </Grid>
      )}

      {ready && (
        <Grid size={12}>
          <Card component="section" aria-labelledby="partner-team-people">
            <CardContent className="flex flex-col gap-4">
              <Typography id="partner-team-people" variant="h5" component="h2" className="mb-0">
                {t("partner-team-people")}
              </Typography>
              <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
                {ready.teammates.map((teammate) => (
                  <Box
                    component="li"
                    key={teammate.userId}
                    className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center"
                  >
                    <Box className="flex min-w-0 flex-1 flex-col gap-1">
                      <Box className="flex flex-wrap items-center gap-2">
                        <Typography variant="subtitle2" component="p" className="break-words">
                          {teammate.name || teammate.email}
                        </Typography>
                        <StatusChip tone="neutral" label={t(PARTNER_ROLE_KEY[teammate.role])} />
                        {teammate.hasSecondFactor === false && (
                          <StatusChip tone="attention" label={t("partner-team-no-factor")} />
                        )}
                      </Box>
                      <Typography variant="body2" className="text-text-secondary break-all">
                        {[teammate.email, t("partner-team-since", { date: day(teammate.joinedAt) })].join(" · ")}
                      </Typography>
                    </Box>
                    {mayRemove(teammate) && (
                      <Button variant="text" color="grey" size="small" onClick={() => setRemoving(teammate)}>
                        {teammate.userId === ready.me ? t("partner-team-leave") : t("partner-team-remove")}
                      </Button>
                    )}
                  </Box>
                ))}
              </Box>
            </CardContent>
          </Card>
        </Grid>
      )}

      {ready && manager && ready.invitations.length > 0 && (
        <Grid size={12}>
          <Card component="section" aria-labelledby="partner-team-invitations">
            <CardContent className="flex flex-col gap-4">
              <Typography id="partner-team-invitations" variant="h5" component="h2" className="mb-0">
                {t("partners-invitations-title")}
              </Typography>
              <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
                {ready.invitations.map((invitation) => (
                  <Box
                    component="li"
                    key={invitation.id}
                    className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center"
                  >
                    <Typography variant="body2" className="min-w-0 flex-1 break-all">
                      {t("partners-invitation-line", { email: invitation.email, date: day(invitation.expiresAt) })}
                    </Typography>
                    <Button variant="text" color="grey" size="small" onClick={() => void revoke(invitation.id)}>
                      {t("partners-invitation-revoke")}
                    </Button>
                  </Box>
                ))}
              </Box>
            </CardContent>
          </Card>
        </Grid>
      )}

      {partner && manager && (
        <Grid size={12}>
          <Card component="section" aria-labelledby="partner-team-agency">
            <CardContent className="flex flex-col gap-4">
              <Typography id="partner-team-agency" variant="h5" component="h2" className="mb-0">
                {t("partner-team-agency")}
              </Typography>
              <FormControl className="outlined" variant="standard">
                <FormLabel component="label" htmlFor="partner-team-name">
                  {t("partners-invite-name")}
                </FormLabel>
                <Input
                  id="partner-team-name"
                  value={name}
                  onChange={(event) => {
                    setName(event.target.value);
                    setRenamed(false);
                  }}
                  disabled={busy}
                  aria-describedby="partner-team-name-help"
                />
                <FormHelperText id="partner-team-name-help">
                  {renamed ? t("partner-team-renamed") : t("partner-team-name-help")}
                </FormHelperText>
              </FormControl>
              <Box>
                <Button
                  variant="outlined"
                  color="grey"
                  disabled={busy || name.trim().length < 2 || name.trim() === partner.name}
                  onClick={() => void rename()}
                >
                  {t("partner-team-rename")}
                </Button>
              </Box>
            </CardContent>
          </Card>
        </Grid>
      )}

      {partner && inviting && (
        <PartnerInvitePanel
          mode="colleague"
          title={t("partner-team-invite-title", { partner: partner.name })}
          mayInviteAdmin={owner}
          onClose={() => setInviting(false)}
          onInvited={refresh}
        />
      )}

      {removing && ready && (
        <ConfirmActionDialog
          title={
            removing.userId === ready.me
              ? t("partner-team-leave-title")
              : t("partner-team-remove-title", { name: removing.name || removing.email })
          }
          consequences={[
            removing.userId === ready.me ? t("partner-team-leave-consequence") : t("partner-team-remove-consequence"),
          ]}
          requireReason={false}
          confirmLabel={removing.userId === ready.me ? t("partner-team-leave") : t("partner-team-remove")}
          cancelLabel={t("partners-cancel")}
          busyLabel={t("partners-ending")}
          tone="danger"
          onConfirm={async () => {
            const result = await removePartnerMember(removing.userId);
            if (!result.ok) return t(partnerErrorKey(result.code));
            if (removing.userId === ready.me) {
              window.location.assign("/auth/complete-profile");
              return null;
            }
            refresh();
            return null;
          }}
          onClose={() => setRemoving(null)}
        />
      )}
    </Grid>
  );
}
