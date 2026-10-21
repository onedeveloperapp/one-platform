"use client";
import Footer from "./footer";
import { usePathname } from "next/navigation";
import { PropsWithChildren, useEffect, useMemo, useState } from "react";

import { useLayoutContext } from "@/components/layout/layout-context";
import { DEFAULTS } from "@/config";
import { isPathMatch } from "@/lib/utils";
import { leftMenuItems } from "@/menu-items";
import { leftMenuBottomItems } from "@/menu-items";
import { MenuShowState } from "@/types";
import { MenuItem } from "@/types";

export default function Main({ children }: PropsWithChildren) {
  const { leftPrimaryCurrent, leftSecondaryCurrent, leftMenuWidth } = useLayoutContext();
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setMounted(true);
  }, []);

  // The shell animates its own resizing (the menu opening and closing) with
  // --layout-duration. It is set a moment after the shell mounts, so the first
  // layout does not animate into place. It is set here and not by the root
  // theme provider: writing a custom property on <html> restyles the whole
  // document, and a public page has no shell to animate.
  useEffect(() => {
    const timer = window.setTimeout(
      () => document.documentElement.style.setProperty("--layout-duration", `${DEFAULTS.transitionDuration}ms`),
      200,
    );
    return () => window.clearTimeout(timer);
  }, []);

  const [activeItem, setActiveItem] = useState<MenuItem | undefined>(undefined);

  useEffect(() => {
    let selectedMenu = leftMenuItems.find((item) => item.href && isPathMatch(pathname, item.href));
    if (!selectedMenu && leftMenuBottomItems) {
      selectedMenu = leftMenuBottomItems.find((item) => item.href && isPathMatch(pathname, item.href));
    }
    setActiveItem(selectedMenu);
  }, [pathname]);

  const [mainPaddingLeft] = useMemo(() => {
    if (!mounted) return [0];

    let mainPaddingLeft = 0;

    if (leftPrimaryCurrent === MenuShowState.Show) {
      mainPaddingLeft += leftMenuWidth.primary;
    }
    if (leftSecondaryCurrent === MenuShowState.Show && activeItem?.children && leftMenuWidth.secondary > 0) {
      mainPaddingLeft += leftMenuWidth.secondary;
    }

    return [mainPaddingLeft];
  }, [leftPrimaryCurrent, leftSecondaryCurrent, leftMenuWidth, mounted, activeItem]);

  const styles = useMemo(
    () => ({
      width: "100%",
      paddingLeft: `${mainPaddingLeft}px`,
    }),
    [mainPaddingLeft],
  );

  return (
    <main
      id="main-content"
      tabIndex={-1}
      className="flex h-full min-h-0 w-full flex-col pt-20 duration-(--layout-duration)"
      style={styles}
    >
      {children}
      <Footer />
    </main>
  );
}
