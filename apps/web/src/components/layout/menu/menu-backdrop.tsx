"use client";

import { useLayoutContext } from "@/components/layout/layout-context";

export default function MenuBackdrop() {
  const { resetLeftMenu, leftShowBackdrop } = useLayoutContext();

  const handleOnClick = () => {
    if (leftShowBackdrop) {
      resetLeftMenu();
    }
  };

  return (
    // Fixed: the page scrolls under the menu, and a click anywhere on it closes the submenu, below the first screen too.
    <>{leftShowBackdrop && <div className="fixed inset-0 z-0" onClick={() => handleOnClick()}></div>}</>
  );
}
