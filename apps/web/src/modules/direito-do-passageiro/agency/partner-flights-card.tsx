"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Alert, Box, Button, Card, CardContent, Skeleton, Typography } from "@mui/material";

import CardTitle from "@/components/product/card-title";
import EmptyState from "@/components/product/empty-state";
import { ProgressBar } from "@/components/product/progress-steps";
import StatusChip from "@/components/product/status-chip";
import NiPlane from "@/icons/nexture/ni-plane";
import { cn } from "@/lib/utils";
import { FLIGHT_NOW_LEAD_KEY, flightProgress } from "@/modules/direito-do-passageiro/agency/flight-progress";
import { type FlightsRead, readPartnerFlights } from "@/modules/direito-do-passageiro/agency/flight-progress-actions";
import { anyMoving, useFlightNowText, useFlightsRead } from "@/modules/direito-do-passageiro/agency/trip-flight";

/**
 * The agency's passengers' flights as they happen, on its home (the owner, 2026-11-03): each trip ONE follows in the
 * next days, the soonest first, with its passenger, where its flight is along its way and in a sentence what happens
 * now; read again every minute while one is under way or about to be. Once a passenger agreed, the agency sees their
 * whole way, as the firm sees a case's. The passenger module's section of the partner's home (`partnerHome` of its
 * definition): the core opens it through the registry, never by name.
 */
export default function PartnerFlightsCard() {
  const t = useTranslations("product");
  const [first, setFirst] = useState<FlightsRead | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    void readPartnerFlights()
      .catch((): FlightsRead => ({ ok: false }))
      .then((read) => {
        if (live) setFirst(read);
      });
    return () => {
      live = false;
    };
  }, [attempt]);
  return (
    <Card component="section" aria-labelledby="pax-flights-title">
      <CardContent className="flex flex-col gap-4">
        {first === null ? (
          <>
            <CardTitle
              id="pax-flights-title"
              icon={<NiPlane size="medium" />}
              tone="primary"
              title={t("pax-flights-title")}
            />
            <Skeleton variant="rounded" height={96} />
          </>
        ) : (
          <PartnerFlightsList
            initial={first}
            onRetry={() => {
              setFirst(null);
              setAttempt((count) => count + 1);
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

/** The card's body over a first read: its title, the trips with their flights, read again while one moves. */
export function PartnerFlightsList({ initial, onRetry }: { initial: FlightsRead; onRetry: () => void }) {
  const t = useTranslations("product");
  const nowText = useFlightNowText();
  const read = useFlightsRead(initial, readPartnerFlights, anyMoving);
  if (!read.ok) {
    return (
      <>
        <CardTitle
          id="pax-flights-title"
          icon={<NiPlane size="medium" />}
          tone="primary"
          title={t("pax-flights-title")}
        />
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={onRetry}>
              {t("pax-flights-retry")}
            </Button>
          }
        >
          {t("pax-flights-failed")}
        </Alert>
      </>
    );
  }
  const rows = read.trips
    .filter((trip) => trip.legs.length > 0)
    .map((trip) => ({ trip, progress: flightProgress(trip.legs) }));
  // In the air is a leg that left and has not arrived: a passenger between two flights is on the ground.
  const inAir = rows.filter((row) => row.progress.now?.kind === "in_air").length;
  return (
    <>
      <CardTitle
        id="pax-flights-title"
        icon={<NiPlane size="medium" />}
        tone="primary"
        title={t("pax-flights-title")}
        description={t("pax-flights-description", { days: read.days })}
        chip={inAir > 0 ? <StatusChip label={t("pax-flights-in-air", { count: inAir })} tone="info" /> : undefined}
      />
      {rows.length === 0 ? (
        <EmptyState
          titleAs="h3"
          icon={<NiPlane size="large" />}
          title={t("pax-flights-empty-title")}
          description={t("pax-flights-empty-body")}
          action={{ label: t("pax-flights-empty-action"), href: "/parceiro/passageiros" }}
        />
      ) : (
        <Box component="ul" className="m-0 flex list-none flex-col gap-2 p-0">
          {rows.map(({ trip, progress }) => (
            <Box component="li" key={trip.tripId}>
              <Link
                href={`/parceiro/passageiros/${trip.travelerId}`}
                className={cn(
                  "border-grey-100 hover:bg-grey-25 flex flex-col gap-2 rounded-2xl border p-4 no-underline",
                  "outline-offset-2 transition-colors focus-visible:outline-2 sm:flex-row sm:items-center sm:gap-4",
                )}
              >
                <Box className="flex min-w-0 flex-col gap-0.5 sm:w-56 sm:flex-none">
                  <Typography variant="subtitle2" component="span" className="text-text-primary break-words">
                    {trip.holder}
                  </Typography>
                  <Typography variant="body2" component="span" className="text-text-secondary">
                    {trip.locator ? t("pax-trip-locator-is", { locator: trip.locator }) : t("pax-trip-no-locator")}
                  </Typography>
                </Box>
                <Box className="flex min-w-0 flex-1 flex-col gap-1.5">
                  {progress.now && (
                    <Typography variant="body2" component="span" className="text-text-primary">
                      <strong>{t(FLIGHT_NOW_LEAD_KEY[progress.now.kind])}</strong> {nowText(progress.now, read.today)}
                    </Typography>
                  )}
                  <ProgressBar
                    steps={progress.steps.length}
                    reached={progress.started ? progress.reached : -1}
                    state={progress.state}
                    label={t("pax-flights-bar", {
                      done: progress.steps.filter((step) => step.state === "done").length,
                      steps: progress.steps.length,
                    })}
                  />
                </Box>
              </Link>
            </Box>
          ))}
        </Box>
      )}
    </>
  );
}
