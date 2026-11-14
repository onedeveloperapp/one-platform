"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";

import { Box, Link as MuiLink, Typography } from "@mui/material";

import ModuleIcon from "@/components/product/module-icon";
import type { ModuleOffer } from "@/lib/modules/offer";

/**
 * ONE's modules as one discreet line under the home's greeting (the owner, 2026-11-14, who found the menu of the
 * modules a repetition of Casos and kept only a line on the home): each module the firm contracted, its icon and its
 * name leading to its cases; the modules to come and the ones the firm could add, named; and "Ver módulos", the
 * overview in the firm's settings. It replaced the module's tiles in the hero, which led to each module's area.
 *
 * `inHero` is kept for the home's call: the line is drawn the same wherever it is.
 */
export default function ModulesQuickAccess({ offer }: { offer: ModuleOffer; inHero?: boolean }) {
  const t = useTranslations("product");
  if (offer.contracted.length + offer.comingSoon.length + offer.locked.length === 0) return null;
  const names = (list: { name: string }[]) => list.map((module) => module.name).join(", ");
  return (
    <Box
      component="nav"
      aria-label={t("modules-line-label")}
      className="flex w-full flex-row flex-wrap items-center justify-center gap-x-4 gap-y-1"
    >
      {offer.contracted.map((module) => (
        <MuiLink
          key={module.key}
          component={Link}
          href={`/casos?modulo=${module.key}`}
          underline="hover"
          variant="body2"
          className="text-text-primary inline-flex items-center gap-1.5 font-semibold"
        >
          <ModuleIcon name={module.icon} size="small" />
          {module.name}
        </MuiLink>
      ))}
      {offer.comingSoon.length > 0 ? (
        <Typography variant="body2" className="text-text-secondary">
          {t("modules-line-soon", { names: names(offer.comingSoon) })}
        </Typography>
      ) : null}
      {offer.locked.length > 0 ? (
        <Typography variant="body2" className="text-text-secondary">
          {t("modules-line-locked", { names: names(offer.locked) })}
        </Typography>
      ) : null}
      <MuiLink component={Link} href="/settings/modulos" underline="hover" variant="body2" className="font-semibold">
        {t("modules-line-all")}
      </MuiLink>
    </Box>
  );
}
