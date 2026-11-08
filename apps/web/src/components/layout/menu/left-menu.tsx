"use client";
import { usePathname, useRouter } from "next/navigation";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "use-intl";

import { Box, Paper, Typography } from "@mui/material";

import { useLayoutContext } from "@/components/layout/layout-context";
import PlanIndicator from "@/components/layout/menu/plan-indicator";
import { PrimaryItem } from "@/components/layout/menu/primary-item";
import { OverviewLink, SecondaryItem } from "@/components/layout/menu/secondary-item";
import { useViewer } from "@/components/layout/viewer-context";
import { DEFAULTS } from "@/config";
import { visibleItems } from "@/lib/firm/menu";
import { cn, isPathMatch } from "@/lib/utils";
import { leftMenuBottomItems, leftMenuItems } from "@/menu-items";
import { MenuItem, MenuShowState, MenuType } from "@/types";

export type OpenedAccordion = { indent: number; id: string };

export default function LeftMenu() {
  const t = useTranslations("dashboard");
  const pathname = usePathname();
  const router = useRouter();
  const {
    leftMenuType,
    leftMenuWidth,
    leftPrimaryCurrent,
    leftSecondaryCurrent,
    showLeftSecondary,
    hideLeftSecondary,
    hideLeft,
    resetLeftMenu,
    onResetLeft,
    leftShowBackdrop,
    setLeftShowBackdrop,
    showLeftMobileButton,
  } = useLayoutContext();

  const selectedPrimary = useRef<undefined | MenuItem>(undefined);
  const [activeItem, setActiveItem] = useState<MenuItem | undefined>(undefined);
  const [openedAccordions, setOpenedAccordions] = useState<OpenedAccordion[]>([]);

  // Who is looking comes from the server layout, so each person's menu is right from the first paint.
  const viewer = useViewer();
  const visibleMenuItems = useMemo(() => visibleItems(leftMenuItems, viewer), [viewer]);
  const visibleBottomItems = useMemo(() => visibleItems(leftMenuBottomItems, viewer), [viewer]);

  useEffect(() => {
    let selectedMenu = visibleMenuItems.find((item) => item.href && isPathMatch(pathname, item.href));
    if (!selectedMenu) {
      selectedMenu = visibleBottomItems.find((item) => item.href && isPathMatch(pathname, item.href));
    }
    selectedPrimary.current = selectedMenu;
    setActiveItem(selectedMenu);
    resetLeftMenu();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, visibleMenuItems, visibleBottomItems]);

  useEffect(() => {
    if (selectedPrimary.current?.id !== activeItem?.id && !leftShowBackdrop) {
      setLeftShowBackdrop(true);
    }
  }, [activeItem?.id, selectedPrimary.current?.id, setLeftShowBackdrop, leftShowBackdrop]);

  useEffect(() => {
    // Back to the item of the page, also on a page no item names, where the group just closed marks nothing.
    onResetLeft(() => setActiveItem(selectedPrimary.current));

    return () => {
      onResetLeft(() => {});
    };
  }, [onResetLeft]);

  const submenuOpen =
    Boolean(activeItem?.children?.length) && leftSecondaryCurrent !== MenuShowState.Hide && leftMenuWidth.secondary > 0;

  const handleSelectPrimaryItem = (item: MenuItem) => {
    if (item.children && item.children.length > 0) {
      // Its icon opens the submenu over the page, and the same icon closes it.
      if (submenuOpen && activeItem?.id === item.id) {
        resetLeftMenu();
      } else {
        setActiveItem(item);
        showLeftSecondary();
      }
    } else {
      setActiveItem(item);
      // close all opened accordions
      // if the item is the same as the current path, hide the secondary menu and reset the left menu
      if (isPathMatch(pathname, item.href || "")) {
        hideLeftSecondary();
        resetLeftMenu();
      } else {
        setOpenedAccordions([]);
        router.push(item.href ?? "");
      }
    }
  };

  useEffect(() => {
    if (!activeItem) {
      if (showLeftMobileButton) {
        hideLeftSecondary();
      } else {
        hideLeft();
      }
    }
  }, [hideLeft, activeItem, showLeftMobileButton, hideLeftSecondary]);

  useEffect(() => {
    if (!activeItem?.children && leftSecondaryCurrent === MenuShowState.Hide) {
      hideLeftSecondary();
    }
  }, [activeItem, hideLeftSecondary, leftSecondaryCurrent]);

  const leftSecondaryDefaultWidth = useMemo(() => DEFAULTS.leftMenuWidth[leftMenuType].secondary, [leftMenuType]);

  // A link followed closes the submenu at once, also one that stays on the path (/modulos#...), which the reset of a
  // new path never sees. One opened in another tab leaves it as it was.
  const closeAfterLink = (event: React.MouseEvent<HTMLElement>) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return;
    if ((event.target as HTMLElement).closest("a")) resetLeftMenu();
  };

  // No screen supplies its own secondary menu content today; the slot stays so
  // a future screen can, without changing the menu's layout logic.
  const customSecondaryContent: React.ReactNode = null;
  return (
    <nav
      id="primary-navigation"
      aria-label={t("menu-navigation")}
      className="bg-background-paper shadow-darker-xs fixed z-10 mt-20 flex h-[calc(100%-5rem)] flex-row rounded-r-2xl"
    >
      <Box
        className={cn(
          "flex h-full shrink-0 grow-0 flex-col items-center overflow-x-hidden py-2.5! transition-all duration-(--layout-duration)",
        )}
        style={{
          ...(leftPrimaryCurrent !== MenuShowState.Hide && leftMenuWidth.primary > 0
            ? { width: `${leftMenuWidth.primary}px` }
            : { width: "0px" }),
        }}
      >
        <Box
          className={cn(
            leftMenuType === MenuType.SingleLayer &&
              leftPrimaryCurrent !== MenuShowState.Hide &&
              leftMenuWidth.primary > 0 &&
              "overflow-y-scroll px-4 py-2",
            "absolute flex h-full min-h-full shrink-0 grow-0 flex-col items-center gap-0.5 overflow-y-auto",
          )}
          style={{
            ...(leftPrimaryCurrent !== MenuShowState.Hide && leftMenuWidth.primary > 0
              ? { width: `${leftMenuWidth.primary}px` }
              : { width: "0px" }),
          }}
          tabIndex={0}
          aria-label={t("menu-navigation")}
        >
          {/* In the list the items take the whole width, as the ones at the foot do: the column would otherwise shrink
              to its widest label and sit centred (the template's demo menu hid it, its nested items widening it). The
              icon rails keep their fixed tiles centred. */}
          <Box className={cn("flex flex-1 flex-col gap-0.5", leftMenuType === MenuType.SingleLayer && "w-full")}>
            {visibleMenuItems.map((item) =>
              leftMenuType !== MenuType.SingleLayer ? (
                <PrimaryItem
                  className={cn(leftShowBackdrop && "z-20")}
                  item={item}
                  key={`left-menu-primary-item-${leftMenuType}-${item.id}`}
                  onSelect={(item) => handleSelectPrimaryItem(item)}
                  isActive={activeItem?.id === item.id}
                  expanded={submenuOpen && activeItem?.id === item.id}
                  menuType={leftMenuType}
                />
              ) : (
                <SecondaryItem
                  className={cn(leftShowBackdrop && "z-20")}
                  item={item}
                  key={`left-menu-primary-item-${leftMenuType}-${item.id}`}
                  indent={0}
                  openedAccordions={openedAccordions}
                  setOpenedAccordions={setOpenedAccordions}
                />
              ),
            )}
          </Box>
          <Box className={cn("mb-5 flex w-full flex-col items-center gap-0.5")}>
            {/* Which plan this workspace is on. */}
            <PlanIndicator menuType={leftMenuType} />
            {visibleBottomItems.map((item) =>
              leftMenuType !== MenuType.SingleLayer ? (
                <PrimaryItem
                  className={cn(leftShowBackdrop && "z-20")}
                  item={item}
                  key={`left-menu-bottom-item-${leftMenuType}-${item.id}`}
                  onSelect={(item) => handleSelectPrimaryItem(item)}
                  isActive={activeItem?.id === item.id}
                  expanded={submenuOpen && activeItem?.id === item.id}
                  menuType={leftMenuType}
                />
              ) : (
                <SecondaryItem
                  className={cn(leftShowBackdrop && "z-20")}
                  item={item}
                  key={`left-menu-bottom-item-${leftMenuType}-${item.id}`}
                  indent={0}
                  openedAccordions={openedAccordions}
                  setOpenedAccordions={setOpenedAccordions}
                />
              ),
            )}
          </Box>
        </Box>
      </Box>
      {leftMenuType !== MenuType.SingleLayer && (
        <Box
          className={cn(
            "shadow-line-left flex h-full shrink-0 grow-0 overflow-x-hidden transition-all duration-(--layout-duration)",
            leftShowBackdrop && "z-20",
          )}
          style={{ width: submenuOpen ? `${leftMenuWidth.secondary}px` : 0 }}
        >
          {/* Closed, its links are out of reach of the keyboard and of a screen reader, not only of the eye. */}
          <Box className="h-full w-full" inert={!submenuOpen} onClick={closeAfterLink}>
            <Paper elevation={0} className="outline-line h-full w-full rounded-4xl py-8 outline -outline-offset-1">
              <Box className="relative h-full w-full overflow-x-hidden">
                <Box
                  style={{ width: leftSecondaryDefaultWidth }}
                  className={cn(
                    "absolute flex h-full min-h-full flex-col gap-2 overflow-y-scroll pr-[1rem] pl-[1.375rem]",
                  )}
                  // A labelled, scrollable navigation region: without the role
                  // the label is not allowed on a plain div.
                  role="navigation"
                  tabIndex={0}
                  aria-label={t("menu-subnavigation")}
                >
                  {customSecondaryContent ? (
                    customSecondaryContent
                  ) : (
                    <>
                      {activeItem?.label && (
                        // The group's own page is the subtle link beside its title ("Todos"), never an item below.
                        <Box className="mb-4 flex items-baseline justify-between gap-3 px-2.5">
                          <Typography variant="h6" className="text-primary">
                            {t(activeItem.label)}
                          </Typography>
                          {activeItem.href ? <OverviewLink item={activeItem} /> : null}
                        </Box>
                      )}
                      {/* The "compare plans" CTA that used to sit here was
                          unreachable by customers: this panel only renders for
                          a menu item WITH children, and the only one is the
                          superadmin group — so the pitch was shown to the
                          platform operator and to nobody who could buy. The
                          plan surface now lives in the primary rail
                          (<PlanIndicator/>), which every workspace sees. */}
                      <Box className="flex h-full w-full flex-1 flex-col gap-2">
                        {activeItem?.children &&
                          activeItem?.children?.length > 0 &&
                          activeItem?.children?.map((item) => (
                            <SecondaryItem
                              item={item}
                              key={`left-menu-secondary-item-${leftMenuType}-${activeItem.id}-${item.id}`}
                              indent={0}
                              openedAccordions={openedAccordions}
                              setOpenedAccordions={setOpenedAccordions}
                            />
                          ))}
                      </Box>
                    </>
                  )}
                </Box>
              </Box>
            </Paper>
          </Box>
        </Box>
      )}
    </nav>
  );
}
