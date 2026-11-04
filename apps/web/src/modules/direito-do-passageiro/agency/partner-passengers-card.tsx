"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Alert, Box, Button, Card, CardContent, Skeleton } from "@mui/material";

import CardTitle from "@/components/product/card-title";
import EmptyState from "@/components/product/empty-state";
import { ProgressList, type ProgressListRow } from "@/components/product/progress-steps";
import NiArrowRight from "@/icons/nexture/ni-arrow-right";
import NiUsers from "@/icons/nexture/ni-users";
import { listPassengers } from "@/modules/direito-do-passageiro/agency/actions";
import { PASSENGER_JOURNEY, passengerReached, TRIP_STEP_KEY } from "@/modules/direito-do-passageiro/agency/journey";
import {
  CONSENT_KEY,
  localTimeLabel,
  type PaxRow,
  REAGREE_CHIP_KEY,
} from "@/modules/direito-do-passageiro/agency/passengers";

/** How many passengers in progress the home shows; the list of them all is one click further. */
const RECENT_PASSENGERS = 5;

/** Where a passenger is along their way, as the list of passengers shows it, in one line of the home. */
function progressOf(row: PaxRow) {
  // A yes that no longer covers their trips (their WhatsApp changed, or a trip waits, 0086) is an agreement owed again.
  const reagree = !row.handedOver && row.consent === "agreed" && row.reagree !== null;
  return { reagree, ...passengerReached({ consent: row.consent, handedOver: row.handedOver, reagree }) };
}

/**
 * The agency's passengers in progress, on its home (the owner, 2026-11-03): the first few of its list (the next to
 * fly first), one line each with where the passenger is along their way, the agreement, the flights ONE follows or
 * the firm, and the way to all of them. A passenger whose way stopped (they said no, or took the agreement back)
 * is left to the list. The firm's home shows its latest cases the same way. `initial` is a first read already in
 * hand, which the card shows before reading again only when asked to.
 */
export default function PartnerPassengersCard({ initial }: { initial?: PaxRow[] }) {
  const t = useTranslations("product");
  const [rows, setRows] = useState<PaxRow[] | "failed" | null>(initial ?? null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (initial && attempt === 0) return;
    let live = true;
    void listPassengers({ search: "", filter: "all", offset: 0 })
      .then((read) => (read.ok ? read.page.rows : ("failed" as const)))
      .catch(() => "failed" as const)
      .then((read) => {
        if (live) setRows(read);
      });
    return () => {
      live = false;
    };
  }, [attempt, initial]);

  const going = Array.isArray(rows)
    ? rows.filter((row) => progressOf(row).state !== "stopped").slice(0, RECENT_PASSENGERS)
    : [];
  const lines: ProgressListRow[] = going.map((row) => {
    const progress = progressOf(row);
    const consent = row.consent ?? "none";
    const step = t(TRIP_STEP_KEY[PASSENGER_JOURNEY[progress.reached]]);
    const standing = row.handedOver ? null : progress.reagree ? t(REAGREE_CHIP_KEY) : t(CONSENT_KEY[consent]);
    return {
      key: row.id,
      href: `/parceiro/passageiros/${row.id}`,
      title: row.fullName,
      detail:
        [standing, row.nextDeparture ? t("pax-row-next", { date: localTimeLabel(row.nextDeparture) }) : null]
          .filter(Boolean)
          .join(" · ") || null,
      step,
      steps: PASSENGER_JOURNEY.length,
      reached: progress.reached,
      state: progress.state,
      label: t("journey-bar-label", {
        label: step,
        position: progress.reached + 1,
        total: PASSENGER_JOURNEY.length,
      }),
    };
  });

  return (
    <Card component="section" aria-labelledby="pax-recent-title">
      <CardContent className="flex flex-col gap-4">
        <CardTitle
          id="pax-recent-title"
          icon={<NiUsers size="medium" />}
          tone="secondary"
          title={t("pax-recent-title")}
          description={lines.length > 0 ? t("pax-recent-body") : undefined}
        />
        {rows === null ? (
          <Skeleton variant="rounded" height={160} />
        ) : rows === "failed" ? (
          <Alert
            severity="error"
            className="neutral bg-background-paper/60!"
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => {
                  setRows(null);
                  setAttempt((count) => count + 1);
                }}
              >
                {t("pax-recent-retry")}
              </Button>
            }
          >
            {t("pax-recent-failed")}
          </Alert>
        ) : lines.length === 0 ? (
          <EmptyState
            icon={<NiUsers size="large" />}
            title={t("pax-recent-empty-title")}
            description={t("pax-recent-empty-body")}
            action={{ label: t("pax-recent-all"), href: "/parceiro/passageiros" }}
            titleAs="h3"
          />
        ) : (
          <>
            <ProgressList label={t("pax-recent-title")} rows={lines} />
            <Box className="-ml-2">
              <Button
                component={Link}
                href="/parceiro/passageiros"
                variant="text"
                color="primary"
                size="small"
                endIcon={<NiArrowRight size="small" />}
              >
                {t("pax-recent-all")}
              </Button>
            </Box>
          </>
        )}
      </CardContent>
    </Card>
  );
}
