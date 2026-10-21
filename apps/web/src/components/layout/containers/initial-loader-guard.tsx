"use client";

import { useEffect } from "react";

/**
 * Hides #initial-loader once React has mounted. public/initial-loader.js does
 * it on a page rendered by the server, but a document React builds in the
 * browser (the error shell Next serves for a 404 thrown by a page) never runs
 * that beforeInteractive script, and the white overlay would cover the page
 * forever. Same steps as the script: fade, then drop from layout.
 */
export default function InitialLoaderGuard() {
  useEffect(() => {
    const loader = document.getElementById("initial-loader");
    if (!loader || loader.style.display === "none") return;
    loader.style.opacity = "0";
    loader.style.pointerEvents = "none";
    const timer = window.setTimeout(() => {
      loader.style.display = "none";
    }, 500);
    return () => window.clearTimeout(timer);
  }, []);
  return null;
}
