"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { Alert, Box, Button, Card, CardContent, Skeleton, Typography } from "@mui/material";

import CardTitle from "@/components/product/card-title";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import QuickActions from "@/components/product/quick-actions";
import StatusChip from "@/components/product/status-chip";
import NiLuggage from "@/icons/nexture/ni-luggage";
import NiPlus from "@/icons/nexture/ni-plus";
import { type PersonTrip, personTrips, stopFollowing } from "@/modules/direito-do-passageiro/passengers/actions";
import NewPassengerPanel from "@/modules/direito-do-passageiro/passengers/new-passenger-panel";
import {
  legWhen,
  passengerErrorKey,
  TRIP_STATUS_KEY,
  TRIP_STATUS_TONE,
  tripStoppable,
} from "@/modules/direito-do-passageiro/passengers/passengers";
import PersonAgency from "@/modules/direito-do-passageiro/passengers/person-agency";

const dayOf = (value: string) =>
  value
    ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value))
    : "";

/**
 * The trips ONE follows of a person of the firm (migration 0170), on the person's page: each with where it stands,
 * its legs and the documents kept with it, the case its yes opened, and the way to stop following it; and a new trip
 * of the same person, which is how a client who travels again is followed again.
 */
export default function PersonTrips({ personId, personName }: { personId: string; personName: string }) {
  const t = useTranslations("product");
  const router = useRouter();
  const [trips, setTrips] = useState<PersonTrip[] | null | undefined>(undefined);
  const [adding, setAdding] = useState(false);
  const [stopping, setStopping] = useState<PersonTrip | null>(null);
  const [done, setDone] = useState<string | null>(null);
  // 0171: the agencies the person came from as a lead, with the trips ONE follows for them.
  const [agencies, setAgencies] = useState(0);

  const read = useCallback(() => {
    void personTrips(personId).then(setTrips, () => setTrips(null));
  }, [personId]);
  useEffect(() => read(), [read]);

  const followed = trips?.filter((trip) => tripStoppable(trip.status)).length ?? 0;

  return (
    <Card component="section" aria-labelledby="person-trips">
      <CardContent className="flex flex-col gap-3">
        <CardTitle
          id="person-trips"
          icon={<NiLuggage size="medium" />}
          tone="secondary"
          title={t("passenger-trips-title")}
          description={t("passenger-trips-hint")}
          chip={
            followed > 0 ? <StatusChip tone="info" label={t("passenger-trips-followed", { count: followed })} /> : null
          }
          actions={
            <Button
              variant="outlined"
              color="grey"
              size="small"
              startIcon={<NiPlus size="small" />}
              onClick={() => setAdding(true)}
            >
              {t("passenger-trips-add")}
            </Button>
          }
        />
        {done ? (
          <Alert severity="success" className="neutral" onClose={() => setDone(null)}>
            {done}
          </Alert>
        ) : null}
        {trips === undefined ? (
          <Skeleton variant="rounded" height={56} />
        ) : trips === null ? (
          <Alert severity="warning" className="neutral">
            {t("passenger-trips-unread")}
          </Alert>
        ) : trips.length === 0 ? (
          agencies > 0 ? null : (
            <Typography variant="body2" className="text-text-secondary">
              {t("passenger-trips-none")}
            </Typography>
          )
        ) : (
          <Box component="ul" className="m-0 flex list-none flex-col p-0">
            {trips.map((trip) => (
              <Box
                component="li"
                key={trip.id}
                className="border-grey-100 flex flex-col gap-1 border-b py-3 last:border-b-0"
              >
                <Box className="flex flex-wrap items-center gap-2">
                  <StatusChip
                    tone={TRIP_STATUS_TONE[trip.status] ?? "neutral"}
                    label={t(TRIP_STATUS_KEY[trip.status] ?? "passenger-trip-watching")}
                  />
                  {trip.restFollowed ? <StatusChip tone="info" label={t("passenger-trip-rest-followed")} /> : null}
                  {trip.test ? <StatusChip tone="neutral" label={t("agenda-entry-test")} /> : null}
                  <Box className="flex-1" />
                  {trip.caseId ? (
                    <Button component={Link} href={`/casos/${trip.caseId}`} variant="text" size="small">
                      {t("passenger-trip-open-case")}
                    </Button>
                  ) : null}
                  {tripStoppable(trip.status) ? (
                    <QuickActions
                      label={t("passenger-trip-actions")}
                      actions={[{ key: "stop", label: t("passenger-trip-stop"), onClick: () => setStopping(trip) }]}
                    />
                  ) : null}
                </Box>
                {trip.legs.map((leg) => (
                  <Typography key={leg.position} variant="body2">
                    {[leg.flight, `${leg.origin} → ${leg.destination}`, legWhen(leg.departure)].join(" · ")}
                  </Typography>
                ))}
                <Typography variant="caption" className="text-text-secondary">
                  {[
                    t("passenger-trip-agreed", { day: dayOf(trip.agreedAt) }),
                    trip.documents > 0 ? t("passenger-trip-documents", { count: trip.documents }) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </Typography>
              </Box>
            ))}
          </Box>
        )}
        <PersonAgency personId={personId} onLoaded={setAgencies} />
      </CardContent>

      {adding ? (
        <NewPassengerPanel
          personId={personId}
          personName={personName}
          onClose={() => setAdding(false)}
          onDone={() => {
            setAdding(false);
            read();
            router.refresh();
          }}
        />
      ) : null}

      {stopping ? (
        <ConfirmActionDialog
          title={t("passenger-trip-stop-title")}
          intro={t("passenger-trip-stop-intro")}
          consequences={[t("passenger-trip-stop-no-alert"), t("passenger-trip-stop-no-case")]}
          staysTitle={t("passenger-trip-stop-stays-title")}
          stays={[t("passenger-trip-stop-stays-person"), t("passenger-trip-stop-stays-documents")]}
          requireReason={false}
          confirmLabel={t("passenger-trip-stop-confirm")}
          cancelLabel={t("passenger-close")}
          busyLabel={t("passenger-working")}
          onClose={() => setStopping(null)}
          onConfirm={async () => {
            const result = await stopFollowing({ tripId: stopping.id, personId }).catch(() => ({
              ok: false,
              code: "failed",
            }));
            if (!result.ok) return t(passengerErrorKey(result.code));
            setStopping(null);
            setDone(t("passenger-trip-stopped-now"));
            read();
            router.refresh();
            return null;
          }}
        />
      ) : null}
    </Card>
  );
}
