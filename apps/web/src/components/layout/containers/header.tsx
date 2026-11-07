"use client";
import Notifications from "../notifications/notifications";
import PendingCenter from "../pending/pending-center";
import User from "../user/user";
import Link from "next/link";
import * as React from "react";
import { useEffect, useState } from "react";
import { useTranslations } from "use-intl";

import { Box, Button, Typography } from "@mui/material";

import AddMenu from "@/components/layout/add/add-menu";
import { useLayoutContext } from "@/components/layout/layout-context";
import { GlobalSearchButton, GlobalSearchField } from "@/components/layout/search/global-search";
import { useViewer } from "@/components/layout/viewer-context";
import Logo from "@/components/logo/logo";
import ModuleIcon from "@/components/product/module-icon";
import { TILE_TONE } from "@/components/product/tile-tone";
import NiMenuSplit from "@/icons/nexture/ni-menu-split";
import type { MenuViewer } from "@/lib/firm/menu";
import { cn } from "@/lib/utils";

/**
 * Which module somebody of a partner works in, beside the logo (the owner, 2026-11-03): the agency's area is a
 * module's, and its people read at once whose area they are in. The module's icon on its own tint and its name
 * (the icon alone on a phone, the name still said to assistive technology). Nothing for a firm's people, whose menu
 * lists the modules.
 */
function PartnerModules({ viewer }: { viewer: MenuViewer | null }) {
  const t = useTranslations("dashboard");
  const modules = viewer?.partner ? (viewer.partnerModules ?? []) : [];
  if (modules.length === 0) return null;
  return (
    <Box className="flex flex-row items-center gap-2">
      {modules.map((module) => (
        <Box
          key={module.key}
          className={cn("flex h-10 flex-row items-center gap-2 rounded-2xl px-3", TILE_TONE[module.tone].bg)}
        >
          <ModuleIcon name={module.icon} size="small" className={TILE_TONE[module.tone].text} />
          <span className="sr-only">{t("partner-module")}</span>
          <Typography
            variant="body2"
            component="span"
            className="text-text-primary sr-only font-semibold whitespace-nowrap sm:not-sr-only"
          >
            {module.name}
          </Typography>
        </Box>
      ))}
    </Box>
  );
}

export default function Header() {
  const t = useTranslations("dashboard");
  const { showLeftInMobile, showLeftMobileButton, leftMenuWidth, leftShowBackdrop } = useLayoutContext();
  const viewer = useViewer();
  // What waits for somebody is the firm's; who is held on the security screen sees it once they pass.
  const showPending = Boolean(viewer?.hasFirm) && !viewer?.owesSecondFactor;
  // The search finds the firm's cases: for somebody of a firm, once past the second factor.
  const showSearch = showPending && !viewer?.partner;

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return (
      <Box
        component="header"
        // Matches the mounted header's h-20: it used to be shorter, which both
        // shifted the layout on hydration and left no room for the logo.
        className="flex h-20 flex-none flex-row items-center"
        style={{ padding: `0 var(--main-padding)` }}
      >
        <Box className="flex h-full flex-row items-center gap-6">
          <Link href="/inicio">
            <Logo
              classNameFull="ml-2 hidden h-[54px] w-auto md:block"
              classNameMobile="ml-2 h-[54px] w-auto md:hidden"
            />
          </Link>
          <PartnerModules viewer={viewer} />
        </Box>
      </Box>
    );
  }

  return (
    <Box className="mui-fixed fixed z-20 h-16 w-full" component="header">
      <Box
        className={cn(
          "bg-background-paper flex h-full w-full flex-none flex-row items-center rounded-br-2xl sm:h-20",
          leftShowBackdrop && "pointer-events-none",
        )}
        style={{ padding: `0 var(--main-padding)` }}
      >
        <Box className="bg-background-paper shadow-darker-xs absolute inset-0 -z-10 rounded-b-2xl"></Box>
        {/* Left menu button */}
        <Button
          variant="text"
          size="large"
          color="text-primary"
          className={cn(
            "icon-only hover-icon-shrink [&.active]:text-primary [&.active]:bg-grey-25 hover:bg-grey-25",
            showLeftMobileButton ? "flex" : "hidden",
            leftMenuWidth.primary > 0 && "active",
          )}
          onClick={() => showLeftInMobile()}
          aria-label={t("menu-open")}
          aria-expanded={leftMenuWidth.primary > 0}
          aria-controls="primary-navigation"
          startIcon={<NiMenuSplit size={24} />}
        />
        <Box className="flex h-full flex-row items-center gap-6">
          {/* Logo — 2× the 27px default, sized against the 80px header. */}
          <Link href="/inicio">
            <Logo
              classNameFull="ml-2 hidden h-[54px] w-auto md:block"
              classNameMobile="ml-2 h-[54px] w-auto md:hidden"
            />
          </Link>

          <PartnerModules viewer={viewer} />
        </Box>

        {showSearch ? <GlobalSearchField /> : null}

        {/* Right buttons: what may be added (the firm's, once past the second factor), then what waits. */}
        <Box className="ml-auto flex flex-row items-center sm:gap-1">
          {showSearch ? <GlobalSearchButton /> : null}
          {showSearch ? <AddMenu /> : null}
          {showPending ? <PendingCenter /> : null}
          <Notifications />
        </Box>

        {/* User Avatar and Menu */}
        <User />
      </Box>
    </Box>
  );
}
