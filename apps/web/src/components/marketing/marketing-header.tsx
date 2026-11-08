"use client";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Box, Button, Drawer, IconButton, List, ListItem } from "@mui/material";

import Logo from "@/components/logo/logo";
import Container from "@/components/marketing/container";
import Link from "@/components/marketing/locale-link";
import NiCross from "@/icons/nexture/ni-cross";
import NiMenu from "@/icons/nexture/ni-menu";
import { cn } from "@/lib/utils";

// The menu of the ONE site while it is being built: contact, help and the
// blog. The hrefs are the internal paths; LocaleLink writes the public address.
const NAV_LINKS = [
  { key: "nav-contact", href: "/contato" },
  { key: "footer-help", href: "/ajuda" },
  { key: "footer-blog", href: "/blog" },
] as const;

/** How far the page scrolls before the home's bar lifts off the top and floats. */
const FLOAT_AFTER = 24;

/** The words of a button on the deep band: the contrast text, a veil of it under the pointer. */
const ON_DEEP = "text-text-contrast/85! hover:text-text-contrast! hover:bg-text-contrast/10!";

/**
 * Public site top navigation: logo, page links, sign-in + primary CTA,
 * collapsing into a drawer on mobile. Reuses the single <Logo> component.
 *
 * The primary CTA comes from the layout, which knows the launch stage
 * (lib/launch.ts): the waitlist until the site opens, sign-up after.
 *
 * On the home, whose top is the deep band (`<Hero tone="deep">`), the header
 * starts on that band, its words in the contrast text and the logo's
 * dark-surface art; once the page scrolls it becomes a deep bar of rounded
 * corners floating clear of the edges. Its height never changes, so nothing
 * under it moves; only colours and the shadow change. Every other page keeps
 * the light bar.
 */
export default function MarketingHeader({ navCta }: { navCta: { label: string; href: string } }) {
  const primaryCta = navCta;
  const t = useTranslations("marketing");
  const [open, setOpen] = useState(false);
  const deep = usePathname() === "/";
  const [floating, setFloating] = useState(false);

  useEffect(() => {
    if (!deep) return;
    const update = () => setFloating(window.scrollY > FLOAT_AFTER);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [deep]);

  return (
    <Box
      component="header"
      className={cn(
        "sticky top-0 z-30 w-full",
        deep
          ? cn(
              "motion-safe:transition-colors motion-safe:duration-200",
              floating ? "bg-transparent" : "bg-background-deep",
            )
          : "bg-background/85 border-grey-100/80 border-b backdrop-blur-md",
      )}
    >
      <Container className="flex h-16 flex-row items-center md:h-20">
        <div
          className={cn(
            "flex h-12 w-full flex-row items-center justify-between md:h-14",
            deep && "rounded-2xl border px-3 md:px-4",
            deep && "motion-safe:transition-[background-color,border-color,box-shadow] motion-safe:duration-200",
            deep && (floating ? "bg-background-deep border-text-contrast/10 shadow-darker-md" : "border-transparent"),
          )}
        >
          <Link href="/" aria-label={t("nav-home")} className="flex items-center">
            <Logo classNameFull="hidden md:block" classNameMobile="md:hidden" tone={deep ? "contrast" : "default"} />
          </Link>

          {/* Desktop nav */}
          <Box component="nav" className="hidden flex-row items-center gap-1 md:flex">
            {NAV_LINKS.map((link) => (
              <Button
                key={link.key}
                variant="text"
                color="text-primary"
                href={link.href}
                LinkComponent={Link}
                className={deep ? ON_DEEP : undefined}
              >
                {t(link.key)}
              </Button>
            ))}
          </Box>

          <Box className="hidden flex-row items-center gap-2 md:flex">
            <Button
              variant="text"
              color="text-primary"
              href="/auth/sign-in"
              LinkComponent={Link}
              className={deep ? ON_DEEP : undefined}
            >
              {t("nav-sign-in")}
            </Button>
            <Button
              variant="contained"
              color="primary"
              href={primaryCta.href}
              LinkComponent={Link}
              data-track="cta_click"
              data-track-cta-id="nav"
            >
              {primaryCta.label}
            </Button>
          </Box>

          {/* Mobile menu button */}
          <IconButton
            aria-label={t("nav-open-menu")}
            className={cn("md:hidden", deep && ON_DEEP)}
            onClick={() => setOpen(true)}
          >
            <NiMenu size="large" />
          </IconButton>
        </div>
      </Container>

      {/* Mobile drawer */}
      <Drawer anchor="right" open={open} onClose={() => setOpen(false)} className="md:hidden">
        <Box className="flex w-72 max-w-[85vw] flex-col gap-2 p-4">
          <Box className="flex flex-row items-center justify-between">
            <Link href="/" aria-label={t("nav-home")} onClick={() => setOpen(false)}>
              <Logo classNameMobile="block" />
            </Link>
            <IconButton aria-label={t("nav-close-menu")} onClick={() => setOpen(false)}>
              <NiCross size="large" />
            </IconButton>
          </Box>
          <List className="flex flex-col gap-1">
            {NAV_LINKS.map((link) => (
              <ListItem key={link.key} disablePadding>
                <Button
                  fullWidth
                  variant="text"
                  color="text-primary"
                  className="justify-start"
                  href={link.href}
                  LinkComponent={Link}
                  onClick={() => setOpen(false)}
                >
                  {t(link.key)}
                </Button>
              </ListItem>
            ))}
            <ListItem disablePadding>
              <Button
                fullWidth
                variant="text"
                color="text-primary"
                className="justify-start"
                href="/auth/sign-in"
                LinkComponent={Link}
                onClick={() => setOpen(false)}
              >
                {t("nav-sign-in")}
              </Button>
            </ListItem>
          </List>
          <Button
            variant="contained"
            color="primary"
            href={primaryCta.href}
            LinkComponent={Link}
            data-track="cta_click"
            data-track-cta-id="nav"
          >
            {primaryCta.label}
          </Button>
        </Box>
      </Drawer>
    </Box>
  );
}
