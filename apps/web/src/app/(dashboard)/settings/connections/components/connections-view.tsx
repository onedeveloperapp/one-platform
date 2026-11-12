"use client";

import SettingsMenu from "../../components/settings-menu";
import CalendarCard from "./calendar-card";
import ConnectCard from "./connect-card";
import NumberCard from "./number-card";
import SignatureAccountCard from "./signature-account-card";
import TemplatesCard from "./templates-card";
import TestChatCard from "./test-chat-card";
import TestFirmCard from "./test-firm-card";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Drawer, Grid, Tooltip } from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import PageHeader from "@/components/product/page-header";
import NiListCircle from "@/icons/nexture/ni-list-circle";
import NiPlug from "@/icons/nexture/ni-plug";
import NiUsers from "@/icons/nexture/ni-users";
import type { ConnectionsState } from "@/lib/whatsapp/connections";

/**
 * The firm's connections. Who manages the firm comes here to put the firm's
 * WhatsApp number to work and to see that it still is: success is a connected
 * number with approved templates. It is one number and what is known about
 * it, with the one thing to do next, never a list of integrations to browse.
 */
export default function ConnectionsView({ state }: { state: ConnectionsState }) {
  const t = useTranslations("product");
  const router = useRouter();
  const [openDrawer, setOpenDrawer] = useState(false);

  const ready = state.kind === "ready" ? state : null;
  const refresh = () => router.refresh();
  const active = ready ? ready.numbers.filter((number) => number.status === "active") : [];
  // The test chat's number is shown by its own card; a real number is what the firm connects here.
  const realActive = active.filter((number) => number.provider !== "test");

  // Nobody connects from a session without the second factor, or from a support visit: the screen says why, once.
  const blocked = ready ? ready.supportVisit || ready.secondFactor !== "ok" : false;

  return (
    <Grid container spacing={5} className="items-start">
      <Grid size={"auto"} className="hidden pr-8 lg:flex">
        <SettingsMenu active="connections" />
      </Grid>
      <Grid size={"grow"} spacing={5} container>
        <Grid size={12} spacing={2.5} container>
          <Grid size={{ xs: 12, md: "grow" }}>
            <PageHeader
              title={t("connections-title")}
              crumbs={[
                { label: t("settings-home"), href: "/inicio" },
                { label: t("settings-title"), href: "/settings" },
                { label: t("settings-connections") },
              ]}
              description={ready ? t("connections-description", { firm: ready.firm.name }) : undefined}
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
                  {t("connections-retry")}
                </Button>
              }
            >
              {t("connections-load-error")}
            </Alert>
          </Grid>
        )}

        {state.kind === "no-firm" && (
          <Grid size={12}>
            <EmptyState
              icon={<NiUsers size="large" />}
              title={t("connections-no-firm-title")}
              description={t("connections-no-firm-body")}
              action={{ label: t("connections-no-firm-action"), href: "/admin" }}
            />
          </Grid>
        )}

        {state.kind === "not-manager" && (
          <Grid size={12}>
            <EmptyState
              icon={<NiPlug size="large" />}
              title={t("connections-not-manager-title")}
              description={t("connections-not-manager-body")}
              action={{ label: t("connections-not-manager-action"), href: "/settings/team" }}
            />
          </Grid>
        )}

        {ready && (
          <>
            {ready.supportVisit ? (
              <Grid size={12}>
                <Alert severity="info" className="neutral bg-background-paper/60!">
                  {t("connections-support-visit")}
                </Alert>
              </Grid>
            ) : ready.secondFactor === "missing" ? (
              <Grid size={12}>
                <Alert
                  severity="warning"
                  className="neutral bg-background-paper/60!"
                  action={
                    <Button color="inherit" size="small" href="/settings/security" LinkComponent={Link}>
                      {t("connections-second-factor-setup")}
                    </Button>
                  }
                >
                  {t("connections-second-factor-missing")}
                </Alert>
              </Grid>
            ) : ready.secondFactor === "challenge" ? (
              <Grid size={12}>
                <Alert
                  severity="warning"
                  className="neutral bg-background-paper/60!"
                  action={
                    <Button
                      color="inherit"
                      size="small"
                      href="/auth/two-factor?next=/settings/connections"
                      LinkComponent={Link}
                    >
                      {t("connections-second-factor-confirm")}
                    </Button>
                  }
                >
                  {t("connections-second-factor-challenge")}
                </Alert>
              </Grid>
            ) : null}

            {ready.failing ? (
              <Grid size={12}>
                <Alert severity="warning" className="neutral bg-background-paper/60!">
                  {t("connections-failing")}
                </Alert>
              </Grid>
            ) : null}

            {ready.numbers
              .filter((number) => number.provider !== "test")
              .map((number) => (
                <NumberCard
                  key={number.id}
                  number={number}
                  blocked={blocked}
                  simulator={ready.environment.simulator}
                  onChanged={refresh}
                />
              ))}

            {/* The test chat is offered no longer (2026-11-11): one already on stays, to be turned off. */}
            {ready.testChat?.state.on ? (
              <TestChatCard
                state={ready.testChat.state}
                url={ready.testChat.url}
                sinceLabel={ready.testChat.sinceLabel}
                blocked={blocked}
                onChanged={refresh}
              />
            ) : null}

            {ready.testFirm ? (
              <TestFirmCard toolsUrl={ready.testFirm.toolsUrl} courtUrl={ready.testFirm.courtUrl} />
            ) : null}

            {realActive.length === 0 || ready.pending.length > 0 ? (
              <ConnectCard
                firmName={ready.firm.name}
                again={ready.numbers.length > 0}
                pending={ready.pending}
                environment={ready.environment}
                blocked={blocked}
                onConnected={refresh}
                openWaPending={ready.openWaPending}
              />
            ) : null}

            {active.length > 0 ? (
              <TemplatesCard templates={ready.templates} readOnly={ready.supportVisit} onChanged={refresh} />
            ) : null}

            <SignatureAccountCard
              account={ready.signature}
              blocked={blocked}
              vault={ready.environment.vault}
              onChanged={refresh}
            />

            <CalendarCard
              state={ready.calendar}
              blocked={blocked}
              vault={ready.environment.vault}
              onChanged={refresh}
            />
          </>
        )}

        <Drawer open={openDrawer} anchor="right" onClose={() => setOpenDrawer(false)}>
          <Box className="min-w-80 p-7">
            <SettingsMenu active="connections" />
          </Box>
        </Drawer>
      </Grid>
    </Grid>
  );
}
