"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Box, Typography } from "@mui/material";

import ProgressSteps, { ProgressNow } from "@/components/product/progress-steps";
import NiPin from "@/icons/nexture/ni-pin";
import NiPlane from "@/icons/nexture/ni-plane";
import {
  FLIGHT_NOW_LEAD_KEY,
  FLIGHT_STEP_KEY,
  type FlightNow,
  flightProgress,
  type FlightStep,
  type FlightTrip,
  lastRead,
  stepTimeLabel,
} from "@/modules/direito-do-passageiro/agency/flight-progress";
import type { FlightsRead } from "@/modules/direito-do-passageiro/agency/flight-progress-actions";

/** How often a screen reads the flights again while one is under way or about to be. */
export const FLIGHTS_EVERY_MS = 60 * 1000;

/** A moment as the source line says it, in Brasília's time: the hour today, the day too on another. */
function readAt(instant: string, today: string): string {
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(at);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return stepTimeLabel(`${part("year")}-${part("month")}-${part("day")}T${part("hour")}:${part("minute")}`, today);
}

/**
 * Reads the flights again while one is under way or about to be (`keepReading` of what was read last), every minute
 * the page is in front of the person; a read that fails keeps what was read before, and the newest answer wins.
 */
export function useFlightsRead(
  initial: FlightsRead,
  read: () => Promise<FlightsRead>,
  keepReading: (current: FlightsRead) => boolean,
): FlightsRead {
  const [current, setCurrent] = useState(initial);
  // A new read from the server (the page read again after a change) takes the place of what was read here.
  const [given, setGiven] = useState(initial);
  if (given !== initial) {
    setGiven(initial);
    setCurrent(initial);
  }
  const asked = useRef(0);
  const active = keepReading(current);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const mine = ++asked.current;
      void read().then(
        (next) => {
          if (next.ok && mine === asked.current) setCurrent(next);
        },
        () => undefined,
      );
    }, FLIGHTS_EVERY_MS);
    return () => clearInterval(timer);
  }, [active, read]);
  return current;
}

/** Whether a trip's flights still move: it has legs and its way did not arrive nor stop. */
export const stillMoving = (trip: FlightTrip): boolean =>
  trip.legs.length > 0 && flightProgress(trip.legs).state === "progress";

/** Whether any trip of a read still moves: the screen keeps reading it while one does. */
export const anyMoving = (read: FlightsRead): boolean => read.ok && read.trips.some(stillMoving);

/** The sentence of what happens now, in the words of the `product` namespace. */
export function useFlightNowText() {
  const t = useTranslations("product");
  return (now: FlightNow, today: string): string => {
    switch (now.kind) {
      case "before":
        return t("pax-flight-now-before", {
          flight: now.flightNumber,
          airport: now.airport,
          time: stepTimeLabel(now.at, today),
        });
      case "in_air":
        return t(now.late ? "pax-flight-now-in-air-late" : "pax-flight-now-in-air", {
          flight: now.flightNumber,
          from: now.from,
          to: now.to,
          time: stepTimeLabel(now.at, today),
        });
      case "connection":
        return t("pax-flight-now-connection", {
          flight: now.flightNumber,
          airport: now.airport,
          time: stepTimeLabel(now.at, today),
        });
      case "arrived":
        return t("pax-flight-now-arrived", { airport: now.airport, time: stepTimeLabel(now.at, today) });
      case "cancelled":
        return t("pax-flight-now-cancelled", { flight: now.flightNumber });
      case "changed":
        return t("pax-flight-now-changed", { flight: now.flightNumber });
    }
  };
}

/**
 * One trip's flight, step by step (the owner, 2026-11-03): each leg leaving and arriving, done with when it did,
 * under way, or still to come with when it is expected; then in a sentence what happens now, and where the steps
 * come from (FlightAware and when it was last read, or the test chat). The steps of a flight with no problem: a
 * cancelled leg stops the way where it was, and the trip's own way above says what came of it.
 */
export default function TripFlight({ trip, today }: { trip: FlightTrip; today: string }) {
  const t = useTranslations("product");
  const nowText = useFlightNowText();
  const progress = flightProgress(trip.legs);
  if (progress.steps.length === 0 || !progress.now) return null;
  const when = (step: FlightStep) => {
    const time = stepTimeLabel(step.at, today);
    if (step.state === "done")
      return t(step.late ? "pax-flight-when-happened-late" : "pax-flight-when-happened", { time });
    if (step.state === "stopped") return null;
    return t(step.late ? "pax-flight-when-expected-late" : "pax-flight-when-expected", { time });
  };
  const read = lastRead(trip.legs);
  const source =
    trip.source === "simulated"
      ? t("pax-flight-source-simulated")
      : read
        ? t("pax-flight-source-read", { time: readAt(read, today) })
        : t("pax-flight-source-unread");
  return (
    <Box className="flex flex-col gap-4 py-1">
      <Typography variant="subtitle2" component="h4" className="mb-0">
        {t("pax-flight-title")}
      </Typography>
      <ProgressSteps
        steps={progress.steps.map((step) => ({
          key: step.key,
          label: t(FLIGHT_STEP_KEY[step.kind], { airport: step.airport }),
          state: step.state,
          when: when(step),
          icon: step.kind === "departure" ? <NiPlane size="small" /> : <NiPin size="small" />,
        }))}
        label={t("pax-flight-title")}
        stateWords={{
          done: t("journey-state-done"),
          current: t("journey-state-current"),
          next: t("journey-state-next"),
          stopped: t("pax-flight-state-stopped"),
        }}
      />
      <ProgressNow
        tone={progress.state === "done" ? "done" : progress.state === "stopped" ? "stopped" : "progress"}
        lead={t(FLIGHT_NOW_LEAD_KEY[progress.now.kind])}
        text={nowText(progress.now, today)}
        extra={
          <Typography variant="body2" className="text-text-secondary">
            {source}
          </Typography>
        }
      />
    </Box>
  );
}
