"use client";

import SettingsMenu from "../components/settings-menu";
import RecentActivityCard from "./components/recent-activity-card";
import TwoFactorCard from "./components/two-factor-card";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, AlertTitle, Box, Breadcrumbs, Button, Drawer, Grid, Tooltip, Typography } from "@mui/material";

import NiListCircle from "@/icons/nexture/ni-list-circle";
import { enterAfterSessionChange } from "@/lib/safe-next";
import { isSupabaseConfigured } from "@flyee/auth";

/**
 * The account's sign-in protection. It is also where somebody whose role asks
 * for a second factor is sent to set it up (`?exigido=1`, lib/firm/gate.ts):
 * the page then says why they are here and, once the factor is on, sends them
 * back to work.
 */
export default function SecuritySettings() {
  const t = useTranslations("product");
  const required = useSearchParams().get("exigido") === "1";
  const [verified, setVerified] = useState(false);
  const [openDrawer, setOpenDrawer] = useState(false);

  const toggleDrawer = (newOpen: boolean) => () => {
    setOpenDrawer(newOpen);
  };

  return (
    <Grid container spacing={5} className="items-start">
      <Grid size={"auto"} className="hidden pr-8 lg:flex">
        <SettingsMenu active="security" />
      </Grid>
      <Grid size={"grow"} spacing={5} container>
        <Grid size={12} spacing={2.5} container>
          <Grid size={{ xs: 12, md: "grow" }}>
            <Typography variant="h1" component="h1" className="mb-0">
              {t("security-title")}
            </Typography>
            <Breadcrumbs>
              <Link color="inherit" href="/inicio">
                {t("settings-home")}
              </Link>
              <Link color="inherit" href="/settings">
                {t("settings-title")}
              </Link>
              <Typography variant="body2">{t("settings-security")}</Typography>
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

        {isSupabaseConfigured && required && !verified && (
          <Grid size={12}>
            <Alert severity="warning" className="neutral bg-background-paper/60!">
              <AlertTitle variant="subtitle2">{t("security-required-title")}</AlertTitle>
              {t("security-required-body")}
            </Alert>
          </Grid>
        )}

        {isSupabaseConfigured && required && verified && (
          <Grid size={12}>
            <Alert
              severity="success"
              className="neutral bg-background-paper/60!"
              action={
                <Button color="inherit" size="small" onClick={() => void enterAfterSessionChange("/inicio")}>
                  {t("security-required-continue")}
                </Button>
              }
            >
              {t("security-required-done")}
            </Alert>
          </Grid>
        )}

        {isSupabaseConfigured && <TwoFactorCard onVerified={() => setVerified(true)} />}
        {isSupabaseConfigured && <RecentActivityCard />}

        <Drawer open={openDrawer} anchor="right" onClose={toggleDrawer(false)}>
          <Box className="min-w-80 p-7">
            <SettingsMenu active="security" />
          </Box>
        </Drawer>
      </Grid>
    </Grid>
  );
}
