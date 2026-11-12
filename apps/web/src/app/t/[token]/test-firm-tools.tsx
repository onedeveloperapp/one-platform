"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Card, CardContent, Typography } from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import StateLine from "@/components/product/state-line";
import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import IllustrationLaunch from "@/icons/illustrations/illustration-launch";
import NiPlane from "@/icons/nexture/ni-plane";
import NiRefresh from "@/icons/nexture/ni-refresh";
import NiScale from "@/icons/nexture/ni-scale";
import { readTestFirm, runTestFirmTool } from "@/lib/test-chat/actions";
import { FIRM_TOOLS, type TestFirmTrip, type TestFirmView } from "@/lib/test-chat/test-chat";
import { formatPhoneBr } from "@flyee/fields";

/**
 * A test firm's tools (migration 0220): the page behind the firm's link, which takes the test chat's place now
 * that the firm tests with a real WhatsApp number. It lists the trips ONE follows for the firm (its agency's
 * passengers and its own), each with the tools that make its flight happen as a source would say it; what ONE
 * tells of a problem goes to the passenger's real WhatsApp through the firm's number. The way to the test court
 * is at the top. No conversation here: it is on the phone and in the firm's attendance.
 */

type Notice = { trip: string; tone: "success" | "info" | "warning" | "error"; text: string };

const clockOf = (local: string | null) => (local ? local.slice(11, 16) : "");
const dayOf = (local: string | null) =>
  local && /^\d{4}-\d{2}-\d{2}/.test(local) ? `${local.slice(8, 10)}/${local.slice(5, 7)}` : "";

/** What a source says of a leg, in words. */
const LEG_KEY: Record<string, string> = {
  scheduled: "test-chat-leg-scheduled",
  delayed: "test-chat-leg-delayed-unknown",
  cancelled: "test-chat-leg-cancelled",
  changed: "test-chat-leg-changed",
  landed: "test-chat-leg-landed",
};

const LEG_TONE: Record<string, StatusTone> = {
  scheduled: "positive",
  delayed: "attention",
  cancelled: "danger",
  changed: "attention",
  landed: "neutral",
};

/** Why ONE could not write, in words. */
function reasonKey(reason: string | null): string {
  switch (reason) {
    case "opted_out":
      return "test-chat-reason-opted-out";
    case "no_template":
      return "test-chat-reason-no-template";
    case "no_number":
      return "test-chat-reason-no-number";
    case "trip_closed":
      return "test-chat-reason-trip-closed";
    default:
      return "test-chat-reason-other";
  }
}

export default function TestFirmTools({ token, initial }: { token: string; initial: TestFirmView }) {
  const t = useTranslations("product");
  const [view, setView] = useState<TestFirmView>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);

  const refresh = async () => {
    const read = await readTestFirm(token).catch(() => null);
    if (read?.ok) setView(read.view);
  };

  const runTool = async (trip: TestFirmTrip, key: string) => {
    setBusy(trip.id);
    setNotice(null);
    const result = await runTestFirmTool(token, trip.id, key).catch(() => ({ ok: false, code: "failed" }) as const);
    await refresh();
    setBusy(null);
    const say = (tone: Notice["tone"], text: string) => setNotice({ trip: trip.id, tone, text });
    if (!result.ok) return say("error", t("test-chat-tool-error"));
    if (result.code === "told") say("success", t("test-chat-told"));
    else if (result.code === "quiet") say("info", t("test-chat-quiet", { hours: Math.round(view.delayMinutes / 60) }));
    else if (result.code === "already") say("info", t("test-chat-already"));
    else if (result.code === "moved") say("success", t("test-firm-moved"));
    else if (result.code === "nothing") say("info", t("test-chat-nothing-to-move"));
    else if (result.code === "reset") say("info", t("test-chat-reset-done"));
    else if (result.code === "not_told") {
      const reason = "reason" in result ? (result.reason ?? null) : null;
      say("warning", t("test-chat-not-told", { reason: t(reasonKey(reason)) }));
    }
  };

  return (
    <Box className="flex min-h-screen w-full justify-center px-3 py-4 sm:px-4 sm:py-8">
      <Box className="flex w-full max-w-3xl flex-col gap-4">
        <Box className="flex flex-col gap-1 px-1">
          <Box className="flex flex-row flex-wrap items-center gap-2">
            <Typography variant="h1" component="h1" className="mb-0 text-2xl sm:text-3xl">
              {t("test-firm-title")}
            </Typography>
            <StatusChip tone="info" label={t("test-firm-chip")} />
          </Box>
          <Typography variant="body2" className="text-text-secondary">
            {view.firm}
          </Typography>
        </Box>

        <Card component="section" aria-labelledby="test-firm-channel">
          <CardContent className="flex flex-col gap-3">
            <Typography id="test-firm-channel" variant="h5" component="h2" className="mb-0">
              {t("test-firm-channel")}
            </Typography>
            {view.number ? (
              <StateLine tone="done">
                {t("test-firm-number", { phone: formatPhoneBr(view.number.phone.replace(/^55/, "")) })}
              </StateLine>
            ) : (
              <StateLine tone="attention">{t("test-firm-no-number")}</StateLine>
            )}
            <Box>
              <Button
                variant="outlined"
                color="grey"
                href={`/t/${token}/tribunal`}
                startIcon={<NiScale size="small" />}
              >
                {t("test-chat-court")}
              </Button>
            </Box>
          </CardContent>
        </Card>

        {view.trips.length === 0 ? (
          <Card>
            <CardContent>
              <EmptyState
                illustration={<IllustrationLaunch />}
                title={t("test-firm-empty-title")}
                description={t("test-firm-empty-body")}
                framed={false}
              />
            </CardContent>
          </Card>
        ) : (
          view.trips.map((trip) => (
            <TripCard
              key={trip.id}
              trip={trip}
              busy={busy !== null}
              working={busy === trip.id}
              notice={notice?.trip === trip.id ? notice : null}
              onTool={(key) => void runTool(trip, key)}
            />
          ))
        )}
      </Box>
    </Box>
  );
}

function TripCard({
  trip,
  busy,
  working,
  notice,
  onTool,
}: {
  trip: TestFirmTrip;
  busy: boolean;
  working: boolean;
  notice: Notice | null;
  onTool: (key: string) => void;
}) {
  const t = useTranslations("product");
  const legStatus = (status: string, estimated: string | null) =>
    status === "delayed" && estimated
      ? t("test-chat-leg-delayed", { time: clockOf(estimated) })
      : t(LEG_KEY[status] ?? "test-chat-leg-scheduled");
  const headingId = `test-firm-trip-${trip.id}`;
  return (
    <Card component="section" aria-labelledby={headingId}>
      <CardContent className="flex flex-col gap-3">
        <Box className="flex min-w-0 flex-col">
          <Typography id={headingId} variant="h5" component="h2" className="mb-0">
            {trip.passenger}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {t(trip.fromAgency ? "test-firm-trip-agency" : "test-firm-trip-firm", { end: trip.phoneEnd })}
          </Typography>
        </Box>

        <Box component="ul" className="m-0 flex list-none flex-col gap-2 p-0">
          {trip.legs.map((leg) => (
            <Box component="li" key={leg.position} className="flex flex-row flex-wrap items-center gap-2">
              <NiPlane size="small" className="text-text-secondary" />
              <Typography variant="body2" className="min-w-0 flex-1 basis-60">
                {t("test-firm-leg", {
                  day: dayOf(leg.departure),
                  flight: leg.flight,
                  from: leg.origin,
                  departure: clockOf(leg.departure),
                  to: leg.destination,
                  arrival: clockOf(leg.arrival),
                })}
              </Typography>
              <StatusChip
                tone={LEG_TONE[leg.status] ?? "neutral"}
                label={legStatus(leg.status, leg.estimatedArrival)}
              />
            </Box>
          ))}
        </Box>

        {trip.caseId ? <StateLine tone="done">{t("test-firm-trip-case")}</StateLine> : null}

        <Box className="flex flex-row flex-wrap gap-2">
          {FIRM_TOOLS.map((tool, index) => (
            <Button
              key={tool.key}
              variant={index === 0 ? "contained" : "outlined"}
              color={index === 0 ? "primary" : "grey"}
              disabled={busy}
              onClick={() => onTool(tool.key)}
            >
              {working && index === 0 ? t("test-firm-working") : t(tool.label)}
            </Button>
          ))}
          <Button
            variant="text"
            color="grey"
            disabled={busy}
            onClick={() => onTool("reset")}
            startIcon={<NiRefresh size="small" />}
          >
            {t("test-chat-tool-reset")}
          </Button>
        </Box>

        {notice ? (
          <Alert severity={notice.tone} className="neutral bg-background-paper/60!">
            {notice.text}
          </Alert>
        ) : null}
      </CardContent>
    </Card>
  );
}
