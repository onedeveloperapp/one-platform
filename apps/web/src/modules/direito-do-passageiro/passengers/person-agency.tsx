"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Box, Button, Typography } from "@mui/material";

import StatusChip from "@/components/product/status-chip";
import { type PersonAgency as Agency, personAgency } from "@/modules/direito-do-passageiro/passengers/agency-actions";
import { legWhen, TRIP_STATUS_KEY, TRIP_STATUS_TONE } from "@/modules/direito-do-passageiro/passengers/passengers";

const dayOf = (value: string | null) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value))
    : "";

/**
 * Where a person of the firm came from an agency (migration 0171): the agency, the day the passenger agreed that
 * their data came to the firm, and the trips ONE follows of them for the agency. Nothing when the person came from
 * none, or their agreement no longer passes the data.
 */
export default function PersonAgency({
  personId,
  onLoaded,
}: {
  personId: string;
  /** How many agencies the person came from, once read. */
  onLoaded?: (count: number) => void;
}) {
  const t = useTranslations("product");
  const [agencies, setAgencies] = useState<Agency[]>([]);

  useEffect(() => {
    let alive = true;
    void personAgency(personId).then(
      (read) => {
        if (!alive) return;
        setAgencies(read ?? []);
        onLoaded?.((read ?? []).length);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [personId, onLoaded]);

  if (agencies.length === 0) return null;
  return (
    <Box className="flex flex-col gap-3">
      {agencies.map((agency) => (
        <Box key={`${agency.agency}-${agency.leadAt}`} className="flex flex-col gap-1">
          <Typography variant="subtitle2" component="h3">
            {t("lead-agency-title", { agency: agency.agency })}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {t("lead-agency-day", { day: dayOf(agency.leadAt) })}
          </Typography>
          {agency.trips.map((trip) => (
            <Box key={trip.id} className="border-grey-100 flex flex-col gap-1 border-b py-2 last:border-b-0">
              <Box className="flex flex-wrap items-center gap-2">
                <StatusChip
                  tone={TRIP_STATUS_TONE[trip.status] ?? "neutral"}
                  label={t(TRIP_STATUS_KEY[trip.status] ?? "passenger-trip-watching")}
                />
                <Box className="flex-1" />
                {trip.caseId ? (
                  <Button component={Link} href={`/casos/${trip.caseId}`} variant="text" size="small">
                    {t("passenger-trip-open-case")}
                  </Button>
                ) : null}
              </Box>
              {trip.legs.map((leg) => (
                <Typography key={leg.position} variant="body2">
                  {[leg.flight, `${leg.origin} → ${leg.destination}`, legWhen(leg.departure)].join(" · ")}
                </Typography>
              ))}
            </Box>
          ))}
        </Box>
      ))}
    </Box>
  );
}
