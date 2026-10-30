"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";

import { Alert, Box, Button, Card, CardContent, Grid, Typography } from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import ModuleIcon from "@/components/product/module-icon";
import PageHeader from "@/components/product/page-header";
import StatusChip from "@/components/product/status-chip";
import { TILE_TONE, type TileTone } from "@/components/product/tile-tone";
import NiLock from "@/icons/nexture/ni-lock";
import NiPuzzle from "@/icons/nexture/ni-puzzle";
import type { ComingModule, ContractedModule, LockedModule, ModuleOffer } from "@/lib/modules/offer";
import { caseKindsOf } from "@/lib/modules/registry";
import { cn } from "@/lib/utils";

export type ModulesState =
  | { kind: "ready"; firm: string; offer: ModuleOffer }
  | { kind: "error" }
  | { kind: "unavailable" };

const day = (value: string) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value))
    : "";

/**
 * ONE's modules for the firm (migrations 0075, 0078). Somebody comes here to know what the firm contracted of ONE
 * and what is on its way: each module the firm has, a package of its subscription, with since when, what it covers
 * and the way into its area; then the modules to come; then the ones out that the firm did not contract. A handful
 * of modules, so cards, never a table; nothing is bought here (the checkout of a package is ONE's billing). Each
 * card carries its module's key as its anchor, which the menu's items of a module to come lead to.
 */
export default function ModulesView({ state }: { state: ModulesState }) {
  const t = useTranslations("product");
  const router = useRouter();
  const ready = state.kind === "ready" ? state : null;

  return (
    <Box className="flex flex-col gap-6">
      <PageHeader
        title={t("modules-title")}
        crumbs={[{ label: t("settings-home"), href: "/inicio" }, { label: t("modules-title") }]}
        description={ready ? t("modules-description", { firm: ready.firm }) : undefined}
      />

      {state.kind === "unavailable" && (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("settings-unavailable")}
        </Alert>
      )}

      {state.kind === "error" && (
        <Alert
          severity="error"
          className="neutral bg-background-paper/60!"
          action={
            <Button color="inherit" size="small" onClick={() => router.refresh()}>
              {t("modules-retry")}
            </Button>
          }
        >
          {t("modules-load-error")}
        </Alert>
      )}

      {ready && (
        <Box component="section" aria-labelledby="modules-contracted" className="flex flex-col gap-4">
          <Typography id="modules-contracted" variant="h5" component="h2" className="mb-0">
            {t("modules-contracted-title")}
          </Typography>
          {ready.offer.contracted.length === 0 ? (
            <EmptyState
              icon={<NiPuzzle size="large" />}
              title={t("modules-none-title")}
              description={t("modules-none-body")}
              titleAs="h3"
            />
          ) : (
            <Grid container spacing={2.5}>
              {ready.offer.contracted.map((module) => (
                <Grid key={module.key} size={{ xs: 12, md: 6 }}>
                  <ContractedCard module={module} />
                </Grid>
              ))}
            </Grid>
          )}
        </Box>
      )}

      {ready && ready.offer.comingSoon.length > 0 && (
        <Box component="section" aria-labelledby="modules-soon" className="flex flex-col gap-4">
          <Box className="flex flex-col gap-1">
            <Typography id="modules-soon" variant="h5" component="h2" className="mb-0">
              {t("modules-soon-title")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {t("modules-soon-body")}
            </Typography>
          </Box>
          <Grid container spacing={2.5}>
            {ready.offer.comingSoon.map((module) => (
              <Grid key={module.key} size={{ xs: 12, md: 6 }}>
                <OtherCard module={module} state="soon" />
              </Grid>
            ))}
          </Grid>
        </Box>
      )}

      {ready && ready.offer.locked.length > 0 && (
        <Box component="section" aria-labelledby="modules-locked" className="flex flex-col gap-4">
          <Box className="flex flex-col gap-1">
            <Typography id="modules-locked" variant="h5" component="h2" className="mb-0">
              {t("modules-locked-title")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {t("modules-locked-body")}
            </Typography>
          </Box>
          <Grid container spacing={2.5}>
            {ready.offer.locked.map((module) => (
              <Grid key={module.key} size={{ xs: 12, md: 6 }}>
                <OtherCard module={module} state="locked" />
              </Grid>
            ))}
          </Grid>
        </Box>
      )}
    </Box>
  );
}

/** The module's icon in the tinted column the app's tiles use. */
function IconTile({ name, tone }: { name: string | null; tone: TileTone }) {
  const style = TILE_TONE[tone];
  return (
    <Box
      aria-hidden
      className={cn("flex h-14 w-14 flex-none items-center justify-center rounded-2xl", style.bg, style.text)}
    >
      <ModuleIcon name={name} />
    </Box>
  );
}

/** A module the firm has: since when, how ONE sells it, what it covers, and the way into its area. */
function ContractedCard({ module }: { module: ContractedModule }) {
  const t = useTranslations("product");
  const kinds = caseKindsOf(module.key);
  const id = `module-${module.key}`;
  return (
    <Card component="article" aria-labelledby={id} id={module.key} className="h-full scroll-mt-28">
      <CardContent className="flex h-full flex-col gap-3">
        <Box className="flex items-center gap-3">
          <IconTile name={module.icon} tone="primary" />
          <Box className="flex min-w-0 flex-wrap items-center gap-2">
            <Typography id={id} variant="h6" component="h3" className="mb-0">
              {module.name}
            </Typography>
            <StatusChip tone="positive" label={t("modules-status-contracted")} />
          </Box>
        </Box>
        <Typography variant="body2" className="text-text-secondary">
          {[
            module.since ? t("modules-since", { date: day(module.since) }) : null,
            module.soldAs === "included" ? t("modules-sold-included") : t("modules-sold-package"),
          ]
            .filter(Boolean)
            .join(" · ")}
        </Typography>
        {module.description && <Typography variant="body1">{module.description}</Typography>}
        {kinds.length > 0 && (
          <Box className="flex flex-col gap-1">
            <Typography variant="subtitle2" component="p">
              {t("modules-kinds-title")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {kinds.map((kind) => t(kind.labelKey)).join(" · ")}
            </Typography>
          </Box>
        )}
        <Box className="mt-auto pt-1">
          <Button variant="contained" size="small" href={`/modulos/${module.key}`} LinkComponent={Link}>
            {t("modules-open-area")}
          </Button>
        </Box>
      </CardContent>
    </Card>
  );
}

/** A module ONE announces, or one out that the firm did not contract: what it covers and how a firm has it. */
function OtherCard({ module, state }: { module: ComingModule | LockedModule; state: "soon" | "locked" }) {
  const t = useTranslations("product");
  const id = `module-${module.key}`;
  return (
    <Card component="article" aria-labelledby={id} id={module.key} className="h-full scroll-mt-28">
      <CardContent className="flex h-full flex-col gap-3">
        <Box className="flex items-center gap-3">
          <IconTile name={module.icon} tone={state === "soon" ? "accent-3" : "secondary"} />
          <Box className="flex min-w-0 flex-wrap items-center gap-2">
            <Typography id={id} variant="h6" component="h3" className="mb-0">
              {module.name}
            </Typography>
            {state === "soon" ? (
              <StatusChip tone="attention" label={t("modules-status-soon")} />
            ) : (
              <Box className="text-text-secondary flex items-center gap-1">
                <NiLock size="small" />
                <Typography variant="body2" component="span">
                  {t("modules-status-locked")}
                </Typography>
              </Box>
            )}
          </Box>
        </Box>
        {module.description && <Typography variant="body1">{module.description}</Typography>}
        <Typography variant="body2" className="text-text-secondary mt-auto">
          {state === "soon" ? t("modules-soon-note") : t("modules-locked-note")}
        </Typography>
      </CardContent>
    </Card>
  );
}
