import NextLink from "next/link";
import { useTranslations } from "next-intl";

import { Box, Link, Typography } from "@mui/material";

import StatusChip from "@/components/product/status-chip";
import type { ModuleOffer } from "@/lib/modules/offer";

/**
 * The modules a firm contracted and the ones to come, in one line under a page's title (migration 0075): each
 * module by its name with its state named beside it (Contratado, Em breve), and the way to the firm's modules.
 * Closest to a row of `StatusChip`s, which it is made of: nothing in the catalog said "these are the packages the
 * firm has" in place, on the home and in the setup, where a person meets them. The way to the modules is a plain
 * link, so it lines up with the names when the line wraps on a narrow screen.
 */
export default function ModulesStrip({ offer }: { offer: ModuleOffer }) {
  const t = useTranslations("product");
  if (offer.contracted.length === 0 && offer.comingSoon.length === 0) return null;
  return (
    <Box
      component="section"
      aria-label={t("modules-strip-label")}
      className="flex flex-wrap items-center gap-x-4 gap-y-2"
    >
      <Typography variant="body2" className="text-text-secondary">
        {t("modules-strip-title")}
      </Typography>
      <Box component="ul" className="m-0 flex list-none flex-wrap items-center gap-x-4 gap-y-2 p-0">
        {offer.contracted.map((module) => (
          <Box component="li" key={module.key} className="flex items-center gap-1.5">
            <Typography variant="subtitle2" component="span">
              {module.name}
            </Typography>
            <StatusChip tone="positive" label={t("modules-status-contracted")} />
          </Box>
        ))}
        {offer.comingSoon.map((module) => (
          <Box component="li" key={module.key} className="flex items-center gap-1.5">
            <Typography variant="body2" component="span" className="text-text-secondary">
              {module.name}
            </Typography>
            <StatusChip tone="info" label={t("modules-status-soon")} />
          </Box>
        ))}
      </Box>
      <Link component={NextLink} href="/settings/modulos" variant="subtitle2" underline="hover">
        {t("modules-strip-link")}
      </Link>
    </Box>
  );
}
