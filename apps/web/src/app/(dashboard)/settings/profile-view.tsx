"use client";

import AccountCard from "./components/account-card";
import EmailsCard from "./components/emails-card";
import MemberCard from "./components/member-card";
import ProfileCard from "./components/profile-card";
import SettingsMenu from "./components/settings-menu";
import WhatsappCard from "./components/whatsapp-card";
import LeaveCard from "./team/components/leave-card";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Breadcrumbs, Button, Drawer, Grid, Tooltip, Typography } from "@mui/material";

import NiListCircle from "@/icons/nexture/ni-list-circle";
import { isSupabaseConfigured } from "@flyee/auth";

/**
 * The person's own account: who they are (name, photo, WhatsApp), their timezone, which e-mails they receive, how
 * they sign in (email, password) and, at the end, leaving the firm they are in. What is the firm's (its name, the
 * partner's weekly digest, the support's access) is in "Dados do escritório"; the person's practice (the bar, the
 * certificates, the cloud signature) in "Atuação profissional" (the owner's canvas "ONE · Configurações",
 * 2026-11-11).
 */
export default function ProfileView({ firm }: { firm: { name: string; owner: boolean } | null }) {
  const t = useTranslations("product");
  const [openDrawer, setOpenDrawer] = useState(false);

  const toggleDrawer = (newOpen: boolean) => () => {
    setOpenDrawer(newOpen);
  };

  return (
    <Grid container spacing={5} className="items-start">
      <Grid size={"auto"} className="hidden pr-8 lg:flex">
        <SettingsMenu active="profile" />
      </Grid>
      <Grid size={"grow"} spacing={5} container>
        <Grid size={12} spacing={2.5} container>
          <Grid size={{ xs: 12, md: "grow" }}>
            <Typography variant="h1" component="h1" className="mb-0">
              {t("settings-profile-title")}
            </Typography>
            <Breadcrumbs>
              <Link color="inherit" href="/inicio">
                {t("settings-home")}
              </Link>
              <Link color="inherit" href="/settings">
                {t("settings-title")}
              </Link>
              <Typography variant="body2">{t("settings-profile")}</Typography>
            </Breadcrumbs>
          </Grid>
          <Grid size={{ xs: 12, md: "auto" }} className="lg:hidden">
            <Tooltip title={t("settings-open-menu")}>
              <Button
                className="icon-only surface-standard"
                color="grey"
                variant="surface"
                onClick={toggleDrawer(true)}
                aria-label={t("settings-open-menu")}
              >
                <NiListCircle size={"medium"} />
              </Button>
            </Tooltip>
          </Grid>
        </Grid>

        {!isSupabaseConfigured && (
          <Grid size={12}>
            <Alert severity="info" className="neutral bg-background-paper/60!">
              {t("settings-unavailable")}
            </Alert>
          </Grid>
        )}

        {isSupabaseConfigured && (
          <>
            <ProfileCard />
            <WhatsappCard />
            <MemberCard />
            <EmailsCard />
            <AccountCard />
            {firm ? <LeaveCard firmName={firm.name} owner={firm.owner} /> : null}
          </>
        )}

        <Drawer open={openDrawer} anchor="right" onClose={toggleDrawer(false)}>
          <Box className="min-w-80 p-7">
            <SettingsMenu active="profile" />
          </Box>
        </Drawer>
      </Grid>
    </Grid>
  );
}
