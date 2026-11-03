"use client";

import SettingsMenu from "../components/settings-menu";
import PartnershipForecast from "./partnership-forecast";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Card, CardContent, Drawer, Grid, Tooltip, Typography } from "@mui/material";

import PartnerInviteDialog from "@/components/partners/partner-invite-dialog";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import EmptyState from "@/components/product/empty-state";
import MetricBars from "@/components/product/metric-bars";
import PageHeader from "@/components/product/page-header";
import StatusChip from "@/components/product/status-chip";
import UsageMeter from "@/components/product/usage-meter";
import NiBuilding from "@/icons/nexture/ni-building";
import NiListCircle from "@/icons/nexture/ni-list-circle";
import NiUserPlus from "@/icons/nexture/ni-user-plus";
import { moduleOf } from "@/lib/modules/registry";
import { endPartnership, revokePartnerInvitation } from "@/lib/partners/actions";
import type { FirmPartnership, FirmPartnersState } from "@/lib/partners/facts";
import { partnerErrorKey, type PartnershipCosts } from "@/lib/partners/partner";

const day = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value))
    : "";

/**
 * The firm's travel agencies (migration 0069). Who manages the firm comes here to set a partnership up: invite the
 * agency, see that it accepted, follow what it brings, end it when it ends. Everybody else finds which agencies send
 * the firm passengers. Each partnership says what the firm has of it (0075): its cases, and, to who manages the
 * firm, what it costs today; nothing of a passenger who did not say yes. A handful of partnerships, so a list of
 * cards, never a table.
 */
export default function PartnersView({ state, modules }: { state: FirmPartnersState; modules: readonly string[] }) {
  const t = useTranslations("product");
  const router = useRouter();
  const [openDrawer, setOpenDrawer] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [ending, setEnding] = useState<FirmPartnership | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const refresh = () => router.refresh();

  const ready = state.kind === "ready" ? state : null;
  // An agency is invited to the firm's module: the first one it uses, the only one today.
  const module = modules[0] ?? null;
  const mayInvite = Boolean(ready?.manager && module);
  const moduleName = (key: string) => {
    const nameKey = moduleOf(key)?.nameKey;
    return nameKey ? t(nameKey) : key;
  };

  const revoke = async (invitationId: string) => {
    setProblem(null);
    const result = await revokePartnerInvitation(invitationId);
    if (!result.ok) setProblem(result.code);
    refresh();
  };

  return (
    <Grid container spacing={5} className="items-start">
      <Grid size={"auto"} className="hidden pr-8 lg:flex">
        <SettingsMenu active="partners" />
      </Grid>
      <Grid size={"grow"} spacing={5} container>
        <Grid size={12} spacing={2.5} container>
          <Grid size={{ xs: 12, md: "grow" }}>
            <PageHeader
              title={t("partners-title")}
              crumbs={[
                { label: t("settings-home"), href: "/inicio" },
                { label: t("settings-title"), href: "/settings" },
                { label: t("settings-partners") },
              ]}
              description={t("partners-description")}
              action={
                mayInvite ? (
                  <Button
                    variant="contained"
                    startIcon={<NiUserPlus size="medium" />}
                    onClick={() => setInviting(true)}
                  >
                    {t("partners-invite")}
                  </Button>
                ) : undefined
              }
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
                <Button color="inherit" size="small" onClick={refresh}>
                  {t("partners-retry")}
                </Button>
              }
            >
              {t("partners-load-error")}
            </Alert>
          </Grid>
        )}

        {problem && (
          <Grid size={12}>
            <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
              {t(partnerErrorKey(problem))}
            </Alert>
          </Grid>
        )}

        {ready && ready.partnerships.length === 0 && ready.invitations.length === 0 && (
          <Grid size={12}>
            <EmptyState
              icon={<NiBuilding size="large" />}
              title={t("partners-empty-title")}
              description={ready.manager ? t("partners-empty-body") : t("partners-empty-body-member")}
              action={mayInvite ? { label: t("partners-invite"), onClick: () => setInviting(true) } : undefined}
            />
          </Grid>
        )}

        {ready && ready.partnerships.length > 0 && (
          <Grid size={12}>
            <Card component="section" aria-labelledby="partners-list">
              <CardContent className="flex flex-col gap-4">
                <Typography id="partners-list" variant="h5" component="h2" className="mb-0">
                  {t("partners-list-title")}
                </Typography>
                {ready.factsFailed && (
                  <Alert
                    severity="error"
                    className="neutral bg-background-paper/60!"
                    action={
                      <Button color="inherit" size="small" onClick={refresh}>
                        {t("partners-retry")}
                      </Button>
                    }
                  >
                    {t("partners-facts-error")}
                  </Alert>
                )}
                {ready.costs && (
                  <UsageMeter
                    headline={t("partners-flights-headline", {
                      used: ready.costs.flightReadsToday,
                      share: ready.costs.flightReadsShare,
                    })}
                    caption={t("partners-flights-caption")}
                    ariaLabel={t("partners-flights-aria")}
                    segments={flightSegments(ready.costs, ready.partnerships, t)}
                  />
                )}
                <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
                  {ready.partnerships.map((partnership) => (
                    <Box
                      component="li"
                      key={partnership.linkId}
                      className="border-grey-100 flex flex-col gap-4 rounded-2xl border p-4"
                    >
                      <Box className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        <Box className="flex min-w-0 flex-1 flex-col gap-1">
                          <Box className="flex flex-wrap items-center gap-2">
                            <Typography variant="subtitle2" component="p" className="break-words">
                              {partnership.partner}
                            </Typography>
                            <StatusChip
                              tone={partnership.status === "active" ? "positive" : "neutral"}
                              label={
                                partnership.status === "active"
                                  ? t("partners-status-active")
                                  : t("partners-status-ended")
                              }
                            />
                          </Box>
                          <Typography variant="body2" className="text-text-secondary">
                            {[
                              moduleName(partnership.module),
                              t("partners-since", { date: day(partnership.startedAt) }),
                              partnership.endedAt ? t("partners-ended-on", { date: day(partnership.endedAt) }) : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </Typography>
                          {partnership.endReason && (
                            <Typography variant="body2" className="text-text-secondary break-words">
                              {t("partners-ended-reason", { reason: partnership.endReason })}
                            </Typography>
                          )}
                        </Box>
                        {ready.manager && partnership.status === "active" && (
                          <Button variant="outlined" color="grey" size="small" onClick={() => setEnding(partnership)}>
                            {t("partners-end")}
                          </Button>
                        )}
                      </Box>
                      {partnership.facts && (
                        <Grid container spacing={3}>
                          <Grid size={{ xs: 12, md: ready.costs ? 6 : 12 }}>
                            <MetricBars
                              whole={false}
                              spacing="dense"
                              items={[
                                {
                                  key: "going",
                                  label: t("partners-cases-going"),
                                  value: partnership.facts.casesGoing,
                                },
                                {
                                  key: "awaiting",
                                  label: t("partners-cases-awaiting"),
                                  hint: t("partners-cases-awaiting-hint"),
                                  value: partnership.facts.awaitingClient,
                                },
                                {
                                  key: "total",
                                  label: t("partners-cases-total"),
                                  value: partnership.facts.casesTotal,
                                },
                              ]}
                            />
                            {partnership.facts.casesTotal > 0 && (
                              <Button
                                className="mt-3"
                                variant="text"
                                color="primary"
                                size="small"
                                href="/casos?ver=agencia"
                                LinkComponent={Link}
                              >
                                {t("partners-cases-open")}
                              </Button>
                            )}
                          </Grid>
                          {ready.costs && partnership.facts.readingsToday !== null && (
                            <Grid size={{ xs: 12, md: 6 }}>
                              <UsageMeter
                                headline={t("partners-readings-headline", {
                                  used: partnership.facts.readingsToday,
                                  limit: ready.costs.readingsDaily,
                                })}
                                caption={t("partners-readings-caption")}
                                ariaLabel={t("partners-readings-aria", { partner: partnership.partner })}
                                segments={[
                                  {
                                    key: "used",
                                    label: t("partners-readings-used"),
                                    value: partnership.facts.readingsToday,
                                    display: String(partnership.facts.readingsToday),
                                    tone: "primary",
                                  },
                                  {
                                    key: "left",
                                    label: t("partners-readings-left"),
                                    value: Math.max(0, ready.costs.readingsDaily - partnership.facts.readingsToday),
                                    display: String(
                                      Math.max(0, ready.costs.readingsDaily - partnership.facts.readingsToday),
                                    ),
                                    tone: "empty",
                                  },
                                ]}
                              />
                            </Grid>
                          )}
                        </Grid>
                      )}
                      {partnership.status === "active" && partnership.facts?.forecast && (
                        <PartnershipForecast forecast={partnership.facts.forecast} days={ready.forecastDays} />
                      )}
                    </Box>
                  ))}
                </Box>
              </CardContent>
            </Card>
          </Grid>
        )}

        {ready && ready.invitations.length > 0 && (
          <Grid size={12}>
            <Card component="section" aria-labelledby="partners-invitations">
              <CardContent className="flex flex-col gap-4">
                <Typography id="partners-invitations" variant="h5" component="h2" className="mb-0">
                  {t("partners-invitations-title")}
                </Typography>
                <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
                  {ready.invitations.map((invitation) => (
                    <Box
                      component="li"
                      key={invitation.id}
                      className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4 sm:flex-row sm:items-center"
                    >
                      <Box className="flex min-w-0 flex-1 flex-col">
                        <Typography variant="subtitle2" component="p" className="break-words">
                          {invitation.partnerName ?? invitation.email}
                        </Typography>
                        <Typography variant="body2" className="text-text-secondary break-all">
                          {t("partners-invitation-line", { email: invitation.email, date: day(invitation.expiresAt) })}
                        </Typography>
                      </Box>
                      <Button variant="text" color="grey" size="small" onClick={() => void revoke(invitation.id)}>
                        {t("partners-invitation-revoke")}
                      </Button>
                    </Box>
                  ))}
                </Box>
              </CardContent>
            </Card>
          </Grid>
        )}

        <Drawer open={openDrawer} anchor="right" onClose={() => setOpenDrawer(false)}>
          <Box className="min-w-80 p-7">
            <SettingsMenu active="partners" />
          </Box>
        </Drawer>
      </Grid>

      {ready && inviting && module && (
        <PartnerInviteDialog
          mode="agency"
          module={module}
          title={t("partners-invite-title")}
          onClose={() => setInviting(false)}
          onInvited={refresh}
        />
      )}

      {ending && (
        <ConfirmActionDialog
          title={t("partners-end-title", { partner: ending.partner })}
          consequences={[t("partners-end-consequence-1"), t("partners-end-consequence-2")]}
          staysTitle={t("partners-end-stays-title")}
          stays={[t("partners-end-stays")]}
          reasonLabel={t("partners-end-reason")}
          reasonHelp={t("partners-end-reason-help")}
          reasonMinLength={4}
          confirmLabel={t("partners-end-confirm")}
          cancelLabel={t("partners-cancel")}
          busyLabel={t("partners-ending")}
          tone="danger"
          onConfirm={async (reason) => {
            const result = await endPartnership(ending.linkId, reason);
            if (!result.ok) return t(partnerErrorKey(result.code));
            refresh();
            return null;
          }}
          onClose={() => setEnding(null)}
        />
      )}
    </Grid>
  );
}

type Words = (key: string, values?: Record<string, string | number>) => string;

/**
 * The firm's flight reads of the day against its share: what its partnerships' trips read, what its own trips read,
 * and what is left. Each pool named, so the agencies' part of the firm's share is read at a glance.
 */
function flightSegments(costs: PartnershipCosts, partnerships: FirmPartnership[], t: Words) {
  const ofPartners = partnerships.reduce((sum, link) => sum + (link.facts?.flightReadsToday ?? 0), 0);
  const own = Math.max(0, costs.flightReadsToday - ofPartners);
  const left = Math.max(0, costs.flightReadsShare - costs.flightReadsToday);
  return [
    {
      key: "partners",
      label: t("partners-flights-partners"),
      value: ofPartners,
      display: String(ofPartners),
      tone: "primary" as const,
    },
    { key: "own", label: t("partners-flights-own"), value: own, display: String(own), tone: "secondary" as const },
    { key: "left", label: t("partners-flights-left"), value: left, display: String(left), tone: "empty" as const },
  ];
}
