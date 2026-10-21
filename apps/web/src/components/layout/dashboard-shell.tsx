"use client";

import { usePathname, useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Suspense, useEffect } from "react";

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
import { shellHold } from "@/lib/firm/gate-rules";
import type { MenuViewer } from "@/lib/firm/menu";

/**
 * The frame of the logged area: header, menu, the page and what floats over
 * it. The server layout above it decides WHO may see a page (a firm, a second
 * factor) on the first page somebody opens; on the pages they open after it,
 * this keeps who owes a second factor on the screen that sets it up.
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
  const pathname = usePathname();
  const router = useRouter();
  // The gate on the pages a person opens after the first one: the layout above is not drawn again while
  // somebody moves between its pages, and on those requests it leaves its sends to this (lib/firm/gate.ts).
  // Who must be somewhere else is sent there before the page they asked for is drawn, and what the layout read
  // of them is read again: a factor set up a moment ago lets them go.
  const holdAt = viewer ? shellHold(viewer, pathname) : null;
  useEffect(() => {
    if (!holdAt) return;
    router.replace(holdAt);
    router.refresh();
  }, [holdAt, pathname, router]);
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
          <Suspense fallback={<Loading />}>{holdAt ? <Loading /> : children}</Suspense>
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
