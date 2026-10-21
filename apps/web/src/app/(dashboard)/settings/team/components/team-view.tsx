"use client";

import SettingsMenu from "../../components/settings-menu";
import type { TeamState } from "../team-types";
import CertificatesCard from "./certificates-card";
import CloudSignatureCard from "./cloud-signature-card";
import FirmCard from "./firm-card";
import InvitationsCard from "./invitations-card";
import InviteDialog from "./invite-dialog";
import LeaveCard from "./leave-card";
import OabCard from "./oab-card";
import PeopleCard from "./people-card";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Drawer, Grid, Tooltip } from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import PageHeader from "@/components/product/page-header";
import NiListCircle from "@/icons/nexture/ni-list-circle";
import NiUserPlus from "@/icons/nexture/ni-user-plus";
import NiUsers from "@/icons/nexture/ni-users";
import { isManager } from "@/lib/firm/roles";

/**
 * The team of the firm. The job of the screen depends on who opens it: who
 * manages the firm brings people in and keeps each one in the right function;
 * everybody else finds who does what, keeps their own registration at the bar
 * right, and can leave. It is a handful of people, not a ledger, so it reads
 * as a roster with what needs somebody's attention, never as a data table.
 */
export default function TeamView({ state }: { state: TeamState }) {
  const t = useTranslations("product");
  const router = useRouter();
  const [openDrawer, setOpenDrawer] = useState(false);
  const [inviting, setInviting] = useState(false);

  const ready = state.kind === "ready" ? state : null;
  const manager = ready ? isManager(ready.me.role) : false;
  const lawyer = ready ? ready.me.firmFunction === "socio" || ready.me.firmFunction === "advogado" : false;
  // A partner or who manages the firm reads the team's signatures in the cloud and ends any of them.
  const readsTeamSignatures = ready ? manager || ready.me.firmFunction === "socio" : false;
  const refresh = () => router.refresh();

  return (
    <Grid container spacing={5} className="items-start">
      <Grid size={"auto"} className="hidden pr-8 lg:flex">
        <SettingsMenu active="team" />
      </Grid>
      <Grid size={"grow"} spacing={5} container>
        <Grid size={12} spacing={2.5} container>
          <Grid size={{ xs: 12, md: "grow" }}>
            <PageHeader
              title={t("team-title")}
              crumbs={[
                { label: t("settings-home"), href: "/inicio" },
                { label: t("settings-title"), href: "/settings" },
                { label: t("settings-team") },
              ]}
              description={ready ? t("team-description", { firm: ready.firm.name }) : undefined}
              action={
                manager ? (
                  <Button
                    variant="contained"
                    startIcon={<NiUserPlus size="medium" />}
                    onClick={() => setInviting(true)}
                  >
                    {t("team-invite")}
                  </Button>
                ) : undefined
              }
            />
          </Grid>
          <Grid size={{ xs: 12, md: "auto" }} className="lg:hidden">
            <Tooltip title={t("settings-open-menu")}>
              <Button
                className="icon-only surface-standard"
                color="grey"
                variant="surface"
                onClick={() => setOpenDrawer(true)}
                aria-label={t("settings-open-menu")}
              >
                <NiListCircle size={"medium"} />
              </Button>
            </Tooltip>
          </Grid>
        </Grid>

        {state.kind === "unavailable" && (
          <Grid size={12}>
            <Alert severity="info" className="neutral bg-background-paper/60!">
              {t("settings-unavailable")}
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
                  {t("team-retry")}
                </Button>
              }
            >
              {t("team-load-error")}
            </Alert>
          </Grid>
        )}

        {state.kind === "no-firm" && (
          <Grid size={12}>
            <EmptyState
              icon={<NiUsers size="large" />}
              title={t("team-no-firm-title")}
              description={t("team-no-firm-body")}
              action={{ label: t("team-no-firm-action"), href: "/admin" }}
            />
          </Grid>
        )}

        {ready && (
          <>
            <PeopleCard data={ready} onChanged={refresh} onInvite={() => setInviting(true)} />
            {manager && <InvitationsCard data={ready} onChanged={refresh} onInvite={() => setInviting(true)} />}
            <OabCard registrations={ready.myOab} onChanged={refresh} />
            {lawyer && <CertificatesCard entries={ready.myCertificates} today={ready.today} onChanged={refresh} />}
            {(lawyer || readsTeamSignatures) && (
              <CloudSignatureCard
                data={ready.cloudSignature}
                mayAuthorize={lawyer}
                readsTeam={readsTeamSignatures}
                onChanged={refresh}
              />
            )}
            {manager && <FirmCard data={ready} onChanged={refresh} />}
            <LeaveCard data={ready} />
          </>
        )}

        <Drawer open={openDrawer} anchor="right" onClose={() => setOpenDrawer(false)}>
          <Box className="min-w-80 p-7">
            <SettingsMenu active="team" />
          </Box>
        </Drawer>
      </Grid>

      {ready && inviting && (
        <InviteDialog
          firmName={ready.firm.name}
          mayInviteAdmin={ready.me.role === "owner"}
          onClose={() => setInviting(false)}
          onInvited={refresh}
        />
      )}
    </Grid>
  );
}
