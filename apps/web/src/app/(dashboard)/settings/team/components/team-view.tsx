"use client";

import SettingsMenu from "../../components/settings-menu";
import SupportAccessCard from "../../components/support-access-card";
import WeeklyDigestCard from "../../components/weekly-digest-card";
import { isTeamView, teamCounts, teamRows, type TeamView, teamViewsFor } from "../team-list";
import type { TeamState } from "../team-types";
import CertificatesCard from "./certificates-card";
import CloudSignatureCard from "./cloud-signature-card";
import FirmCard from "./firm-card";
import HearingContactsCard from "./hearing-contacts-card";
import InvitePanel from "./invite-panel";
import OabCard from "./oab-card";
import OfficeCard from "./office-card";
import TeamRoster from "./team-roster";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { type ReactNode, useMemo, useState } from "react";

import { Alert, Box, Button, Drawer, Grid, Tooltip } from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import ListBar, { type ListView } from "@/components/product/list-bar";
import NumberCard from "@/components/product/number-card";
import PageHeader from "@/components/product/page-header";
import type { TileTone } from "@/components/product/tile-tone";
import NiEmail from "@/icons/nexture/ni-email";
import NiListCircle from "@/icons/nexture/ni-list-circle";
import NiShieldCross from "@/icons/nexture/ni-shield-cross";
import NiUsers from "@/icons/nexture/ni-users";
import { isManager } from "@/lib/firm/roles";
import { countText } from "@/lib/numbers/compare";

/** The numbers above the roster, each the view it counts: who manages the firm reads all three. */
const CARD: Partial<Record<TeamView, { icon: ReactNode; tone: TileTone }>> = {
  todos: { icon: <NiUsers size="medium" />, tone: "primary" },
  convites: { icon: <NiEmail size="medium" />, tone: "accent-1" },
  "sem-fator": { icon: <NiShieldCross size="medium" />, tone: "accent-3" },
};

/**
 * Which of the team's pages this is (the owner's canvas "ONE · Configurações", 2026-11-11): what each setting is
 * of decides where it lives.
 * - `team`, the firm's people: who is in the firm and what each one does, the invitations, and the team's
 *   signatures in the cloud for a partner or who manages the firm.
 * - `professional`, the person's own practice: their registrations at the bar, the certificate they sign with in
 *   each court system and their own signature in the cloud. A lawyer's, whatever firm they are in.
 * - `firm`, the firm's own data: its name, the partner's weekly digest and the support of ONE's access.
 */
export type TeamPart = "team" | "professional" | "firm";

const PART_TITLE: Record<TeamPart, string> = {
  team: "team-title",
  professional: "settings-professional-title",
  firm: "settings-firm-title",
};
const PART_CRUMB: Record<TeamPart, string> = {
  team: "settings-team",
  professional: "settings-professional",
  firm: "settings-firm",
};
const PART_ACTIVE = { team: "team", professional: "professional", firm: "firm" } as const;

/**
 * The team of the firm, and the two pages that read what it reads (`part`). On the team's own page the job depends
 * on who opens it: who manages the firm brings people in and keeps each one in the right function; everybody else
 * finds who does what. It is a handful of people, not a ledger, so it reads as a roster with what needs somebody's
 * attention, never as a data table.
 *
 * The roster is a list of the screen pattern (2026-11-07): for who manages the firm, three cards of numbers (the
 * people, the invitations nobody answered, who still owes the second factor), each the view it counts; the bar with
 * the views by function, the search (a name, an e-mail, a registration at the bar) and "Novo" (inviting a person, in
 * the side panel).
 */
export default function TeamView({ state, part }: { state: TeamState; part: TeamPart }) {
  const t = useTranslations("product");
  const router = useRouter();
  const [openDrawer, setOpenDrawer] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [view, setView] = useState<TeamView>("todos");
  const [search, setSearch] = useState("");

  const ready = state.kind === "ready" ? state : null;
  const manager = ready ? isManager(ready.me.role) : false;
  const lawyer = ready ? ready.me.firmFunction === "socio" || ready.me.firmFunction === "advogado" : false;
  // A partner or who manages the firm reads the team's signatures in the cloud and ends any of them.
  const readsTeamSignatures = ready ? manager || ready.me.firmFunction === "socio" : false;
  const refresh = () => router.refresh();

  const people = useMemo(() => ready?.people ?? [], [ready]);
  const invitations = useMemo(() => ready?.invitations ?? [], [ready]);
  const counts = useMemo(() => teamCounts(people, invitations, search), [people, invitations, search]);
  const rows = teamRows(people, invitations, view, search);
  const views: ListView[] = teamViewsFor(manager).map((key) => ({
    key,
    label: t(`team-view-${key}`),
    count: countText(counts[key]),
    group: key === "todos" ? "all" : key === "sem-fator" || key === "convites" ? "manager" : "function",
  }));
  const cards = manager ? (["todos", "convites", "sem-fator"] as const) : [];

  return (
    <Grid container spacing={5} className="items-start">
      <Grid size={"auto"} className="hidden pr-8 lg:flex">
        <SettingsMenu active={PART_ACTIVE[part]} />
      </Grid>
      <Grid size={"grow"} spacing={5} container>
        <Grid size={12} spacing={2.5} container>
          <Grid size={{ xs: 12, md: "grow" }}>
            <PageHeader
              title={t(PART_TITLE[part])}
              crumbs={[
                { label: t("settings-home"), href: "/inicio" },
                { label: t("settings-title"), href: "/settings" },
                { label: t(PART_CRUMB[part]) },
              ]}
              description={
                part === "team" && ready
                  ? t("team-description", { firm: ready.firm.name })
                  : part === "professional"
                    ? t("settings-professional-description")
                    : part === "firm"
                      ? t("settings-firm-description")
                      : undefined
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
                  {t("team-retry")}
                </Button>
              }
            >
              {t("team-load-error")}
            </Alert>
          </Grid>
        )}

        {state.kind === "no-firm" && (
          <Grid size={12}>
            <EmptyState
              icon={<NiUsers size="large" />}
              title={t("team-no-firm-title")}
              description={t("team-no-firm-body")}
              action={{ label: t("team-no-firm-action"), href: "/admin" }}
            />
          </Grid>
        )}

        {ready && part === "team" && (
          <>
            {cards.length > 0 ? (
              <Grid size={12} container spacing={2.5}>
                {cards.map((key) => (
                  <Grid key={key} size={{ xs: 6, sm: 4 }}>
                    <NumberCard
                      icon={CARD[key]?.icon}
                      tone={CARD[key]?.tone ?? "primary"}
                      label={t(`team-card-${key}`)}
                      hint={t(`team-card-${key}-hint`)}
                      value={countText(counts[key])}
                      onClick={() => setView(view === key && key !== "todos" ? "todos" : key)}
                      pressed={view === key}
                    />
                  </Grid>
                ))}
              </Grid>
            ) : null}
            <Grid size={12} className="flex flex-col gap-2">
              <ListBar
                label={t("team-bar-label")}
                viewsTitle={t("list-views-title")}
                views={views}
                view={view}
                onView={(key) => {
                  if (isTeamView(key)) setView(key);
                }}
                search={{
                  label: t("team-search-label"),
                  placeholder: t("list-bar-search"),
                  value: search,
                  onChange: setSearch,
                }}
                create={manager ? { label: t("team-invite"), onClick: () => setInviting(true) } : undefined}
              />
            </Grid>
            <Grid size={12}>
              <TeamRoster
                data={ready}
                view={view}
                title={t(`team-view-${view}`)}
                people={rows.people}
                invitations={rows.invitations}
                narrowed={search.trim() !== ""}
                onChanged={refresh}
                onInvite={() => setInviting(true)}
                onClearSearch={() => setSearch("")}
              />
            </Grid>
            {/* Who goes to hearings for the firm with no account in ONE (0251), for everybody of the firm. */}
            <Grid size={12}>
              <HearingContactsCard />
            </Grid>
            {/* The team's authorizations, for a partner or who manages the firm: each lawyer's own is theirs, in
                Atuação profissional. */}
            {readsTeamSignatures && (
              <CloudSignatureCard data={ready.cloudSignature} mayAuthorize={false} readsTeam onChanged={refresh} />
            )}
          </>
        )}

        {ready && part === "professional" && (
          <>
            <OabCard registrations={ready.myOab} lawyer={lawyer} onChanged={refresh} />
            {lawyer && <CertificatesCard entries={ready.myCertificates} today={ready.today} onChanged={refresh} />}
            {lawyer && (
              <CloudSignatureCard data={ready.cloudSignature} mayAuthorize readsTeam={false} onChanged={refresh} />
            )}
          </>
        )}

        {ready && part === "firm" && (
          <>
            {manager ? <FirmCard data={ready} onChanged={refresh} /> : null}
            {manager ? <OfficeCard data={ready} onChanged={refresh} /> : null}
            <WeeklyDigestCard />
            <SupportAccessCard />
          </>
        )}

        <Drawer open={openDrawer} anchor="right" onClose={() => setOpenDrawer(false)}>
          <Box className="min-w-80 p-7">
            <SettingsMenu active={PART_ACTIVE[part]} />
          </Box>
        </Drawer>
      </Grid>

      {ready && inviting && (
        <InvitePanel
          firmName={ready.firm.name}
          mayInviteAdmin={ready.me.role === "owner"}
          onClose={() => setInviting(false)}
          onInvited={refresh}
        />
      )}
    </Grid>
  );
}
