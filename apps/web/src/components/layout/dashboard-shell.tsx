"use client";

import { useTranslations } from "next-intl";
import { Suspense } from "react";

import { LicenseInfo } from "@mui/x-license";

import AnnouncementBanner from "@/components/layout/announcements/announcement-banner";
import ContentWrapper from "@/components/layout/containers/content-wrapper";
import Header from "@/components/layout/containers/header";
import Loading from "@/components/layout/containers/loading-screen";
import Main from "@/components/layout/containers/main";
import ImpersonationBanner from "@/components/layout/impersonation/impersonation-banner";
import LeftMenu from "@/components/layout/menu/left-menu";
import MenuBackdrop from "@/components/layout/menu/menu-backdrop";
import { ViewerProvider } from "@/components/layout/viewer-context";
import SupportWidget from "@/components/support/support-widget";
import type { MenuViewer } from "@/lib/firm/menu";

LicenseInfo.setLicenseKey(process.env.NEXT_PUBLIC_MUI_X_LICENSE_KEY || "");

/**
 * The frame of the logged area: header, menu, the page and what floats over
 * it. The server layout above it decides WHO may see a page (a firm, a second
 * factor); this only draws.
 */
export default function DashboardShell({
  viewer,
  children,
}: Readonly<{
  /** Who is looking, as the server layout read it: the menus show each person their own items. */
  viewer: MenuViewer | null;
  children: React.ReactNode;
}>) {
  const t = useTranslations("product");
  return (
    <ViewerProvider viewer={viewer}>
      <a
        href="#main-content"
        className="bg-primary text-text-contrast fixed top-3 left-3 z-[2000] -translate-y-20 rounded-lg px-4 py-3 transition-transform focus:translate-y-0"
      >
        {t("skip-to-content")}
      </a>
      <Header />
      <LeftMenu />
      <Main>
        <ContentWrapper>
          <AnnouncementBanner />
          <Suspense fallback={<Loading />}>{children}</Suspense>
        </ContentWrapper>
      </Main>
      <MenuBackdrop />
      <SupportWidget />
      {/*
        Renders only inside a support impersonation, and stays fixed: the
        operator scrolls, and forgetting whose account you are in is the
        failure mode worth designing against.
      */}
      <ImpersonationBanner />
      {/*
        No tracker runs inside the logged area: it shows client names and case
        numbers. The Pixel and GA4 stay on the public site only, behind its
        own consent notice.
      */}
    </ViewerProvider>
  );
}
