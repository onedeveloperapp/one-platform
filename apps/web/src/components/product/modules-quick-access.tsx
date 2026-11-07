"use client";

import { useTranslations } from "next-intl";

import { Box, Grid, Typography } from "@mui/material";

import { QuickActionTile } from "@/components/product/home-tiles";
import ModuleIcon from "@/components/product/module-icon";
import StatusChip from "@/components/product/status-chip";
import NiLock from "@/icons/nexture/ni-lock";
import type { ModuleOffer } from "@/lib/modules/offer";

/**
 * ONE's modules as the home's quick access (migrations 0075, 0078): one card per module, the template's quick
 * action, its column holding the icon that says what the module is. A module the firm contracted opens its own
 * area, where everything of it lives and nothing of another module; one still to come says "Em breve", and one out
 * that the firm did not contract carries a lock, both leading to the overview that says what each is. Each card
 * takes its module's colour (0081), whatever its state, so a module is told apart at a glance.
 *
 * Closest catalog entry: `QuickActionTile`, used as it is, with its badge for the state. It replaced the line of
 * chips under the title (`ModulesStrip`), which named the modules and opened none of them.
 *
 * `inHero` draws the row of the home's hero (`HomeHero`, the owner's model of 2026-11-05): centred, the tiles
 * outlined and smaller, each saying its state in the small line over the module's name, under the hero's own
 * heading instead of one of its own.
 */
export default function ModulesQuickAccess({ offer, inHero = false }: { offer: ModuleOffer; inHero?: boolean }) {
  const t = useTranslations("product");
  const cards = [
    ...offer.contracted.map((module) => ({ module, state: "contracted" as const })),
    ...offer.comingSoon.map((module) => ({ module, state: "soon" as const })),
    ...offer.locked.map((module) => ({ module, state: "locked" as const })),
  ];
  if (cards.length === 0) return null;
  if (inHero) {
    return (
      <Box component="nav" aria-label={t("modules-quick-title")} className="w-full">
        <Box component="ul" className="m-0 flex list-none flex-wrap justify-center gap-3 p-0">
          {cards.map(({ module, state }) => (
            <Box component="li" key={module.key} className="w-full sm:w-64">
              <QuickActionTile
                outlined
                href={state === "contracted" ? `/modulos/${module.key}` : `/modulos#${module.key}`}
                icon={<ModuleIcon name={module.icon} />}
                tone={module.tone}
                eyebrow={
                  state === "contracted"
                    ? t("modules-status-contracted")
                    : state === "soon"
                      ? t("modules-status-soon")
                      : t("modules-status-locked")
                }
                title={module.name}
                badge={state === "locked" ? <NiLock size="small" className="text-text-secondary" /> : undefined}
              />
            </Box>
          ))}
        </Box>
      </Box>
    );
  }
  return (
    <Box component="section" aria-labelledby="modules-quick" className="flex flex-col gap-4">
      <Typography id="modules-quick" variant="h5" component="h2" className="mb-0">
        {t("modules-quick-title")}
      </Typography>
      <Grid container spacing={2.5}>
        {cards.map(({ module, state }) => (
          // A handful of modules, each with its name and its state on one line: three across.
          <Grid key={module.key} size={{ xs: 12, sm: 6, lg: 4 }}>
            <QuickActionTile
              href={state === "contracted" ? `/modulos/${module.key}` : `/modulos#${module.key}`}
              icon={<ModuleIcon name={module.icon} />}
              tone={module.tone}
              title={module.name}
              description={
                module.description ??
                (state === "contracted"
                  ? t("modules-quick-open")
                  : state === "soon"
                    ? t("modules-soon-note")
                    : t("modules-locked-note"))
              }
              badge={
                state === "contracted" ? (
                  <StatusChip tone="positive" label={t("modules-status-contracted")} />
                ) : state === "soon" ? (
                  <StatusChip tone="attention" label={t("modules-status-soon")} />
                ) : (
                  <NiLock size="small" className="text-text-secondary" />
                )
              }
              label={state === "locked" ? `${module.name}, ${t("modules-status-locked")}` : undefined}
            />
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
