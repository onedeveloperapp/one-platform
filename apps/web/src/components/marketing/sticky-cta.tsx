"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

import { Button } from "@mui/material";

import Link from "@/components/marketing/locale-link";
import { cn } from "@/lib/utils";

/**
 * The page's primary action fixed at the foot of a phone's screen, with the
 * same label, shown from the moment the hero's buttons (`[data-hero-actions]`,
 * set by <Hero>) leave the screen upward and for the rest of the page, as the
 * sales-page model does. Phones only (`md:hidden`). So that it never covers
 * the last line of the site (the footer's rights and the company that sells),
 * it adds its own height of the deep band after the footer, at the end of the
 * page. It leaves room at its right for the support button when the page has
 * one (`[data-support-widget]`), which floats in that corner. While hidden it
 * is inert, so the keyboard never lands on it; reduced motion shows it with no
 * slide.
 */
export default function StickyCta({ label, href }: { label: string; href: string }) {
  const [pastHero, setPastHero] = useState(false);
  // The support button floats in the right corner on every public page that has a channel: leave it room.
  const [beside, setBeside] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setBeside(Boolean(document.querySelector("[data-support-widget]")));
    const hero = document.querySelector("[data-hero-actions]");
    if (!hero) return;
    const observer = new IntersectionObserver(([entry]) =>
      setPastHero(!entry.isIntersecting && entry.boundingClientRect.bottom < 0),
    );
    observer.observe(hero);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div
        inert={!pastHero}
        aria-hidden={!pastHero}
        className={cn(
          "border-grey-100 bg-background-paper/95 shadow-darker-md fixed bottom-3 left-3 z-40 rounded-2xl border p-2 backdrop-blur-md md:hidden",
          beside ? "right-19" : "right-3",
          "motion-safe:transition-[transform,opacity] motion-safe:duration-200",
          pastHero ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-[150%] opacity-0",
        )}
      >
        <Button
          fullWidth
          size="large"
          variant="contained"
          color="primary"
          href={href}
          LinkComponent={Link}
          data-track="cta_click"
          data-track-cta-id="sticky"
        >
          {label}
        </Button>
      </div>
      {/* The room the bar takes, after the footer: the page ends on the deep band, never under the bar. */}
      {mounted && createPortal(<div aria-hidden className="bg-background-deep h-20 md:hidden" />, document.body)}
    </>
  );
}
