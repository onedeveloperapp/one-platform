"use client";

import SettingsMenu from "../components/settings-menu";
import PartnershipForecast from "./partnership-forecast";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useMemo, useState } from "react";

import { Alert, Avatar, Box, Button, Card, CardContent, Drawer, Grid, Tooltip, Typography } from "@mui/material";

import PartnerInvitePanel from "@/components/partners/partner-invite-panel";
import CardTitle from "@/components/product/card-title";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import EmptyState from "@/components/product/empty-state";
import ListBar, { type ListView } from "@/components/product/list-bar";
import MetricBars from "@/components/product/metric-bars";
import NumberCard from "@/components/product/number-card";
import PageHeader from "@/components/product/page-header";
import QuickActions from "@/components/product/quick-actions";
import StatusChip from "@/components/product/status-chip";
import type { TileTone } from "@/components/product/tile-tone";
import UsageMeter from "@/components/product/usage-meter";
import NiArchive from "@/icons/nexture/ni-archive";
import NiBinEmpty from "@/icons/nexture/ni-bin-empty";
import NiBuilding from "@/icons/nexture/ni-building";
import NiEmail from "@/icons/nexture/ni-email";
import NiListCircle from "@/icons/nexture/ni-list-circle";
import NiScale from "@/icons/nexture/ni-scale";
import { moduleOf } from "@/lib/modules/registry";
import { countText } from "@/lib/numbers/compare";
import { endPartnership, revokePartnerInvitation } from "@/lib/partners/actions";
import type { FirmPartnership, FirmPartnersState, OpenPartnerInvitation } from "@/lib/partners/facts";
import { partnerErrorKey, type PartnershipCosts } from "@/lib/partners/partner";
import {
  casesGoing,
  firstPartnerView,
  isPartnerView,
  partnerCounts,
  partnerRows,
  type PartnerView,
  partnerViewsFor,
} from "@/lib/partners/partners-list";

const day = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value))
    : "";

/** The numbers above the list, each the view it counts. */
const CARD: Record<PartnerView, { icon: ReactNode; tone: TileTone }> = {
  ativas: { icon: <NiBuilding size="medium" />, tone: "secondary" },
  encerradas: { icon: <NiArchive size="medium" />, tone: "accent-2" },
  convites: { icon: <NiEmail size="medium" />, tone: "accent-1" },
};

/** What each view's card says of what it holds. */
const VIEW_BODY: Record<PartnerView, string> = {
  ativas: "partners-view-ativas-body",
  encerradas: "partners-view-encerradas-body",
  convites: "partners-view-convites-body",
};

/**
 * The firm's travel agencies (migration 0069). Who manages the firm comes here to set a partnership up: invite the
 * agency, see that it accepted, follow what it brings, end it when it ends. Everybody else finds which agencies send
 * the firm passengers. Each partnership says what the firm has of it (0075): its cases, and, to who manages the
 * firm, what it costs today; nothing of a passenger who did not say yes. A handful of partnerships, so a list of
 * cards, never a table.
 *
 * It is a list of the screen pattern (2026-11-07): cards of numbers (the partnerships in force, the cases they
 * brought that still go on, the invitations nobody answered, what ended), the bar with its views, the search and
 * "Novo" (inviting an agency, in the side panel); a partnership that ends is kept with its reason, never deleted.
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
  const manager = Boolean(ready?.manager);
  const mayInvite = Boolean(manager && module);
  const moduleName = (key: string) => {
    const nameKey = moduleOf(key)?.nameKey;
    return nameKey ? t(nameKey) : key;
  };

  const partnerships = useMemo(() => ready?.partnerships ?? [], [ready]);
  const invitations = useMemo(() => ready?.invitations ?? [], [ready]);
  const [view, setView] = useState<PartnerView>(() => firstPartnerView(partnerships, invitations, manager));
  const [search, setSearch] = useState("");
  const counts = useMemo(() => partnerCounts(partnerships, invitations, search), [partnerships, invitations, search]);
  const rows = partnerRows(partnerships, invitations, view, search);
  const going = ready?.factsFailed ? null : casesGoing(partnerships);
  const views: ListView[] = partnerViewsFor(manager).map((key) => ({
    key,
    label: t(`partners-view-${key}`),
    count: countText(counts[key]),
    group: key === "convites" ? "invitations" : "partnerships",
  }));
  const nothing = ready !== null && partnerships.length === 0 && invitations.length === 0;
  const empty = rows.partnerships.length + rows.invitations.length === 0;

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
                { label: t("settings-module-partners") },
              ]}
              description={t("partners-description")}
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

        {nothing && (
          <Grid size={12}>
            <EmptyState
              icon={<NiBuilding size="large" />}
              title={t("partners-empty-title")}
              description={manager ? t("partners-empty-body") : t("partners-empty-body-member")}
              action={mayInvite ? { label: t("partners-invite"), onClick: () => setInviting(true) } : undefined}
            />
          </Grid>
        )}

        {ready && !nothing && (
          <>
            {/* How many each holds under the search; each card opens the list it counts, the cases the firm's own. */}
            <Grid size={12} container spacing={2.5}>
              <Grid size={{ xs: 6, lg: 3 }}>
                <NumberCard
                  icon={CARD.ativas.icon}
                  tone={CARD.ativas.tone}
                  label={t("partners-card-ativas")}
                  hint={t("partners-card-ativas-hint")}
                  value={countText(counts.ativas)}
                  onClick={() => setView("ativas")}
                  pressed={view === "ativas"}
                />
              </Grid>
              {going !== null ? (
                <Grid size={{ xs: 6, lg: 3 }}>
                  <NumberCard
                    icon={<NiScale size="medium" />}
                    tone="primary"
                    label={t("partners-card-casos")}
                    hint={t("partners-card-casos-hint")}
                    value={countText(going)}
                    href="/casos?ver=agencia"
                  />
                </Grid>
              ) : null}
              {manager ? (
                <Grid size={{ xs: 6, lg: 3 }}>
                  <NumberCard
                    icon={CARD.convites.icon}
                    tone={CARD.convites.tone}
                    label={t("partners-card-convites")}
                    hint={t("partners-card-convites-hint")}
                    value={countText(counts.convites)}
                    onClick={() => setView(view === "convites" ? "ativas" : "convites")}
                    pressed={view === "convites"}
                  />
                </Grid>
              ) : null}
              <Grid size={{ xs: 6, lg: 3 }}>
                <NumberCard
                  icon={CARD.encerradas.icon}
                  tone={CARD.encerradas.tone}
                  label={t("partners-card-encerradas")}
                  hint={t("partners-card-encerradas-hint")}
                  value={countText(counts.encerradas)}
                  onClick={() => setView(view === "encerradas" ? "ativas" : "encerradas")}
                  pressed={view === "encerradas"}
                />
              </Grid>
            </Grid>

            <Grid size={12}>
              <ListBar
                label={t("partners-bar-label")}
                viewsTitle={t("list-views-title")}
                views={views}
                view={view}
                onView={(key) => {
                  if (isPartnerView(key)) setView(key);
                }}
                search={{
                  label: t("partners-search-label"),
                  placeholder: t("list-bar-search"),
                  value: search,
                  onChange: setSearch,
                }}
                create={mayInvite ? { label: t("partners-invite"), onClick: () => setInviting(true) } : undefined}
              />
            </Grid>

            <Grid size={12}>
              <Card component="section" aria-labelledby="partners-list">
                <CardContent className="flex flex-col gap-4">
                  <CardTitle
                    id="partners-list"
                    icon={CARD[view].icon}
                    tone={CARD[view].tone}
                    title={t(`partners-view-${view}`)}
                    description={t(VIEW_BODY[view])}
                  />
                  {view !== "convites" && ready.factsFailed && (
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
                  {view === "ativas" && ready.costs && (
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
                  {empty ? (
                    search.trim() ? (
                      <EmptyState
                        titleAs="h3"
                        icon={<NiBuilding size="large" />}
                        title={t("partners-none-found-title")}
                        description={t("partners-none-found-body")}
                        action={{ label: t("partners-none-found-action"), onClick: () => setSearch("") }}
                        className="py-8"
                      />
                    ) : (
                      <EmptyState
                        titleAs="h3"
                        icon={CARD[view].icon}
                        title={t(`partners-view-${view}-empty`)}
                        description={t(`partners-view-${view}-empty-body`)}
                        action={
                          view !== "encerradas" && mayInvite
                            ? { label: t("partners-invite"), onClick: () => setInviting(true) }
                            : undefined
                        }
                        className="py-8"
                      />
                    )
                  ) : (
                    <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
                      {rows.partnerships.map((partnership) => (
                        <PartnershipItem
                          key={partnership.linkId}
                          partnership={partnership}
                          manager={manager}
                          costs={ready.costs}
                          forecastDays={ready.forecastDays}
                          moduleName={moduleName(partnership.module)}
                          onEnd={() => setEnding(partnership)}
                        />
                      ))}
                      {rows.invitations.map((invitation) => (
                        <InvitationItem
                          key={invitation.id}
                          invitation={invitation}
                          onRevoke={() => void revoke(invitation.id)}
                        />
                      ))}
                    </Box>
                  )}
                </CardContent>
              </Card>
            </Grid>
          </>
        )}

        <Drawer open={openDrawer} anchor="right" onClose={() => setOpenDrawer(false)}>
          <Box className="min-w-80 p-7">
            <SettingsMenu active="partners" />
          </Box>
        </Drawer>
      </Grid>

      {ready && inviting && module && (
        <PartnerInvitePanel
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
          stays={[t("partners-end-stays"), t("partners-end-stays-kept")]}
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

/**
 * One partnership: the agency, its state and since when, what ended it and why, and what the firm has of it (its
 * cases, and to who manages the firm what it costs today and what it foresees). Ending it is one click away.
 */
function PartnershipItem({
  partnership,
  manager,
  costs,
  forecastDays,
  moduleName,
  onEnd,
}: {
  partnership: FirmPartnership;
  manager: boolean;
  costs: PartnershipCosts | null;
  forecastDays: number;
  moduleName: string;
  onEnd: () => void;
}) {
  const t = useTranslations("product");
  const active = partnership.status === "active";
  return (
    <Box component="li" className="border-grey-100 flex flex-col gap-4 rounded-2xl border p-4">
      <Box className="flex flex-row items-start gap-3">
        <Avatar alt="" className="bg-secondary/10 text-secondary h-10 w-10">
          <NiBuilding size="medium" />
        </Avatar>
        <Box className="flex min-w-0 flex-1 flex-col gap-1">
          <Box className="flex flex-wrap items-center gap-2">
            <Typography variant="subtitle2" component="p" className="break-words">
              {partnership.partner}
            </Typography>
            <StatusChip
              tone={active ? "positive" : "neutral"}
              label={active ? t("partners-status-active") : t("partners-status-ended")}
            />
          </Box>
          <Typography variant="body2" className="text-text-secondary">
            {[
              moduleName,
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
        <QuickActions
          label={t("partners-actions", { partner: partnership.partner })}
          actions={
            manager && active
              ? [{ key: "end", label: t("partners-end"), icon: <NiArchive size="medium" />, onClick: onEnd }]
              : []
          }
        />
      </Box>
      {partnership.facts && (
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: costs ? 6 : 12 }}>
            <MetricBars
              whole={false}
              spacing="dense"
              items={[
                { key: "going", label: t("partners-cases-going"), value: partnership.facts.casesGoing },
                {
                  key: "awaiting",
                  label: t("partners-cases-awaiting"),
                  hint: t("partners-cases-awaiting-hint"),
                  value: partnership.facts.awaitingClient,
                },
                { key: "total", label: t("partners-cases-total"), value: partnership.facts.casesTotal },
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
          {costs && partnership.facts.readingsToday !== null && (
            <Grid size={{ xs: 12, md: 6 }}>
              <UsageMeter
                headline={t("partners-readings-headline", {
                  used: partnership.facts.readingsToday,
                  limit: costs.readingsDaily,
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
                    value: Math.max(0, costs.readingsDaily - partnership.facts.readingsToday),
                    display: String(Math.max(0, costs.readingsDaily - partnership.facts.readingsToday)),
                    tone: "empty",
                  },
                ]}
              />
            </Grid>
          )}
        </Grid>
      )}
      {active && partnership.facts?.forecast && (
        <PartnershipForecast
          forecast={partnership.facts.forecast}
          passengers={partnership.facts.passengers}
          days={forecastDays}
        />
      )}
    </Box>
  );
}

/** One invitation to an agency nobody answered yet: the agency, the e-mail it went to and until when it lasts. */
function InvitationItem({ invitation, onRevoke }: { invitation: OpenPartnerInvitation; onRevoke: () => void }) {
  const t = useTranslations("product");
  return (
    <Box component="li" className="border-grey-100 flex flex-row items-start gap-3 rounded-2xl border p-4">
      <Avatar alt="" className="bg-accent-1/10 text-accent-1 h-10 w-10">
        <NiEmail size="medium" />
      </Avatar>
      <Box className="flex min-w-0 flex-1 flex-col">
        <Typography variant="subtitle2" component="p" className="break-words">
          {invitation.partnerName ?? invitation.email}
        </Typography>
        <Typography variant="body2" className="text-text-secondary break-all">
          {t("partners-invitation-line", { email: invitation.email, date: day(invitation.expiresAt) })}
        </Typography>
      </Box>
      <QuickActions
        label={t("partners-invitation-actions", { partner: invitation.partnerName ?? invitation.email })}
        actions={[
          {
            key: "revoke",
            label: t("partners-invitation-revoke"),
            icon: <NiBinEmpty size="medium" />,
            onClick: onRevoke,
          },
        ]}
      />
    </Box>
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
