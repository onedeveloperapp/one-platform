"use client";

import SettingsMenu from "../components/settings-menu";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Card, CardContent, Drawer, Grid, Tooltip, Typography } from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import PageHeader from "@/components/product/page-header";
import StatusChip from "@/components/product/status-chip";
import NiListCircle from "@/icons/nexture/ni-list-circle";
import NiPuzzle from "@/icons/nexture/ni-puzzle";
import type { ComingModule, ContractedModule, ModuleOffer } from "@/lib/modules/offer";
import { caseKindsOf, moduleOf } from "@/lib/modules/registry";

export type ModulesState =
  | { kind: "ready"; firm: string; offer: ModuleOffer }
  | { kind: "error" }
  | { kind: "unavailable" };

const day = (value: string) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value))
    : "";

/**
 * The firm's modules (migration 0075). Somebody comes here to know what the firm contracted of ONE and what is on
 * its way: each module the firm has, a package of its subscription, with since when, what it covers and where its
 * partner is managed; then the modules to come. A handful of modules, so cards, never a table; nothing is bought
 * here (the checkout of a package is ONE's billing).
 */
export default function ModulesView({ state }: { state: ModulesState }) {
  const t = useTranslations("product");
  const router = useRouter();
  const [openDrawer, setOpenDrawer] = useState(false);
  const ready = state.kind === "ready" ? state : null;

  return (
    <Grid container spacing={5} className="items-start">
      <Grid size={"auto"} className="hidden pr-8 lg:flex">
        <SettingsMenu active="modules" />
      </Grid>
      <Grid size={"grow"} spacing={5} container>
        <Grid size={12} spacing={2.5} container>
          <Grid size={{ xs: 12, md: "grow" }}>
            <PageHeader
              title={t("modules-title")}
              crumbs={[
                { label: t("settings-home"), href: "/inicio" },
                { label: t("settings-title"), href: "/settings" },
                { label: t("settings-modules") },
              ]}
              description={ready ? t("modules-description", { firm: ready.firm }) : undefined}
            />
          </Grid>
          <Grid size={{ xs: 12, md: "auto" }} className="lg:hidden">
            <Tooltip title={t("settings-open-menu")}>
              <Button
                className="icon-only surface-standard"
                color="grey"
                variant="surface"
                onClick={() => setOpenDrawer(true)}
                aria-label={t("settings-open-menu")}
              >
                <NiListCircle size={"medium"} />
              </Button>
            </Tooltip>
          </Grid>
        </Grid>

        {state.kind === "unavailable" && (
          <Grid size={12}>
            <Alert severity="info" className="neutral bg-background-paper/60!">
              {t("settings-unavailable")}
            </Alert>
          </Grid>
        )}

        {state.kind === "error" && (
          <Grid size={12}>
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
          </Grid>
        )}

        {ready && (
          <Grid size={12}>
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
          </Grid>
        )}

        {ready && ready.offer.comingSoon.length > 0 && (
          <Grid size={12}>
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
                    <ComingCard module={module} />
                  </Grid>
                ))}
              </Grid>
            </Box>
          </Grid>
        )}

        <Drawer open={openDrawer} anchor="right" onClose={() => setOpenDrawer(false)}>
          <Box className="min-w-80 p-7">
            <SettingsMenu active="modules" />
          </Box>
        </Drawer>
      </Grid>
    </Grid>
  );
}

/** A module the firm has: since when, how ONE sells it, what it covers, and where its partner is managed. */
function ContractedCard({ module }: { module: ContractedModule }) {
  const t = useTranslations("product");
  const kinds = caseKindsOf(module.key);
  const hasPartner = (moduleOf(module.key)?.partnerArea.length ?? 0) > 0;
  const id = `module-${module.key}`;
  return (
    <Card component="article" aria-labelledby={id} className="h-full">
      <CardContent className="flex h-full flex-col gap-3">
        <Box className="flex flex-wrap items-center gap-2">
          <Typography id={id} variant="h6" component="h3" className="mb-0">
            {module.name}
          </Typography>
          <StatusChip tone="positive" label={t("modules-status-contracted")} />
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
        {hasPartner && (
          <Box className="mt-auto flex flex-col gap-2 pt-1">
            <Typography variant="body2" className="text-text-secondary">
              {t("modules-partner-line")}
            </Typography>
            <Box>
              <Button variant="outlined" color="grey" size="small" href="/settings/parceiros" LinkComponent={Link}>
                {t("modules-partner-action")}
              </Button>
            </Box>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

/** A module ONE announces: what it will cover, and that it will be a package of the subscription. */
function ComingCard({ module }: { module: ComingModule }) {
  const t = useTranslations("product");
  const id = `module-${module.key}`;
  return (
    <Card component="article" aria-labelledby={id} className="h-full">
      <CardContent className="flex h-full flex-col gap-3">
        <Box className="flex flex-wrap items-center gap-2">
          <Typography id={id} variant="h6" component="h3" className="mb-0">
            {module.name}
          </Typography>
          <StatusChip tone="info" label={t("modules-status-soon")} />
        </Box>
        {module.description && <Typography variant="body1">{module.description}</Typography>}
        <Typography variant="body2" className="text-text-secondary mt-auto">
          {t("modules-soon-note")}
        </Typography>
      </CardContent>
    </Card>
  );
}
