"use client";

import SettingsMenu, { type SettingsMenuActive } from "./settings-menu";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";

import { Box, Button, Drawer, Grid, Tooltip } from "@mui/material";

import PageHeader from "@/components/product/page-header";
import NiListCircle from "@/icons/nexture/ni-list-circle";

/**
 * A page of the settings: the menu at the side (in a drawer on a phone), the page's title with its crumbs and what
 * it is behind the "i", and its cards. The shape every settings page draws by hand, for the pages that came later.
 */
export default function SettingsFrame({
  active,
  title,
  crumb,
  description,
  children,
}: {
  active: SettingsMenuActive;
  title: string;
  /** The page's name in the crumbs and in the menu. */
  crumb: string;
  description?: string;
  children: ReactNode;
}) {
  const t = useTranslations("product");
  const [openDrawer, setOpenDrawer] = useState(false);
  return (
    <Grid container spacing={5} className="items-start">
      <Grid size={"auto"} className="hidden pr-8 lg:flex">
        <SettingsMenu active={active} />
      </Grid>
      <Grid size={"grow"} spacing={5} container>
        <Grid size={12} spacing={2.5} container>
          <Grid size={{ xs: 12, md: "grow" }}>
            <PageHeader
              title={title}
              crumbs={[
                { label: t("settings-home"), href: "/inicio" },
                { label: t("settings-title"), href: "/settings" },
                { label: crumb },
              ]}
              description={description}
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
        <Grid size={12} className="flex flex-col gap-3">
          {children}
        </Grid>
      </Grid>

      <Drawer open={openDrawer} anchor="right" onClose={() => setOpenDrawer(false)}>
        <Box className="min-w-80 p-7">
          <SettingsMenu active={active} />
        </Box>
      </Drawer>
    </Grid>
  );
}
