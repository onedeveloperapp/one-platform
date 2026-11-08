"use client";
import Footer from "./footer";
import { PropsWithChildren, useEffect, useMemo, useState } from "react";

import { useLayoutContext } from "@/components/layout/layout-context";
import { DEFAULTS } from "@/config";
import { MenuShowState } from "@/types";

export default function Main({ children }: PropsWithChildren) {
  const { leftPrimaryCurrent, leftMenuWidth } = useLayoutContext();
  const [mounted, setMounted] = useState(false);

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

  // The page sits beside the rail only: a submenu opens over it for a moment and takes no room of it.
  const mainPaddingLeft = mounted && leftPrimaryCurrent === MenuShowState.Show ? leftMenuWidth.primary : 0;

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
