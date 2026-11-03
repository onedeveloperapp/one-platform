"use client";

import DocumentLine from "./document-line";
import TripDialog from "./trip-dialog";
import { useTranslations } from "next-intl";
import { type ReactNode, useState } from "react";

import { Alert, Box, Button, Card, CardContent, Typography } from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import ProgressSteps, { ProgressNow } from "@/components/product/progress-steps";
import StatusChip from "@/components/product/status-chip";
import NiBell from "@/icons/nexture/ni-bell";
import NiBriefcase from "@/icons/nexture/ni-briefcase";
import NiPlane from "@/icons/nexture/ni-plane";
import NiUserCheck from "@/icons/nexture/ni-user-check";
import FileButton from "@/modules/direito-do-passageiro/agency/file-button";
import {
  TRIP_HOLDER_KEY,
  TRIP_NOW_KEY,
  TRIP_STEP_KEY,
  tripJourney,
  type TripJourneyStep,
} from "@/modules/direito-do-passageiro/agency/journey";
import {
  localTimeLabel,
  type PaxDetail,
  type PaxDocumentKind,
  paxErrorKey,
  type PaxTrip,
  SEND_DOCUMENT_KEY,
  TRIP_STATE_KEY,
  TRIP_STATE_TONE,
} from "@/modules/direito-do-passageiro/agency/passengers";
import { sendAgencyFile } from "@/modules/direito-do-passageiro/agency/send-files";

const STEP_ICON: Record<TripJourneyStep, ReactNode> = {
  agreement: <NiUserCheck size="small" />,
  watching: <NiPlane size="small" />,
  alerted: <NiBell size="small" />,
  firm: <NiBriefcase size="small" />,
};

/** A day as the steps say it, from a moment ("3 de nov.") or a local time of a ticket (`YYYY-MM-DDTHH:MM`). */
const dayOf = (value: string, local = false) =>
  new Intl.DateTimeFormat("pt-BR", {
    day: "numeric",
    month: "short",
    timeZone: local ? "UTC" : "America/Sao_Paulo",
  }).format(new Date(local ? `${value.slice(0, 16)}:00Z` : value));

/** A trip whose flights ONE has not told anything of yet: the agency may still change it. */
const changeable = (trip: PaxTrip) => trip.state === "waiting_consent" || trip.state === "watching";

/**
 * The trips the passenger is on: each with where it stands along its way (the agreement, the flights ONE follows,
 * a problem told, the passenger with the firm; the owner, 2026-11-03) and what happens now, who travels, every leg,
 * and the passenger's ticket and boarding pass of it. An adult holds a trip (the alerts go to their WhatsApp); a
 * child travels along on the trip of the adult who holds it.
 */
export default function TripsCard({ detail, onChanged }: { detail: PaxDetail; onChanged: () => void }) {
  const t = useTranslations("product");
  const traveler = detail.traveler;
  const [editing, setEditing] = useState<PaxTrip | "new" | null>(null);
  const [sending, setSending] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const locked = traveler.handedOver;
  const self = { id: traveler.id, fullName: traveler.fullName };

  const send = async (trip: PaxTrip, kind: PaxDocumentKind, file: File) => {
    setSending(`${trip.id}:${kind}`);
    setMessage(null);
    const result = await sendAgencyFile(file, { travelerId: traveler.id, kind, tripId: trip.id });
    setSending(null);
    setMessage(
      result.ok ? { ok: true, text: t("pax-document-sent") } : { ok: false, text: t(paxErrorKey(result.code)) },
    );
    if (result.ok) onChanged();
  };

  const holderOf = (trip: PaxTrip) => trip.travelers.find((person) => person.id === trip.holderId) ?? null;
  // The passenger's latest "yes": when the way of their trips began.
  const agreed = detail.consents.filter((consent) => consent.answer === "agreed").at(-1) ?? null;
  const everAgreed = agreed !== null || detail.consent === "agreed";
  const linkUntil =
    detail.confirmLink?.open && detail.confirmLink.expiresAt
      ? new Intl.DateTimeFormat("pt-BR", {
          dateStyle: "short",
          timeStyle: "short",
          timeZone: "America/Sao_Paulo",
        }).format(new Date(detail.confirmLink.expiresAt))
      : null;

  return (
    <Card component="section" aria-labelledby="pax-trips-title">
      <CardContent className="flex flex-col gap-4">
        <Box className="flex flex-wrap items-start justify-between gap-2">
          <Box className="flex flex-col gap-1">
            <Typography id="pax-trips-title" variant="h5" component="h2" className="mb-0">
              {t("pax-trips-title")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {traveler.minor ? t("pax-trips-minor-help") : t("pax-trips-help")}
            </Typography>
          </Box>
          {!locked && !traveler.minor && detail.trips.length > 0 && (
            <Button variant="outlined" color="grey" size="small" onClick={() => setEditing("new")}>
              {t("pax-trip-add")}
            </Button>
          )}
        </Box>

        {detail.trips.length === 0 ? (
          <EmptyState
            titleAs="h3"
            icon={<NiPlane size="large" />}
            title={t("pax-trips-empty-title")}
            description={traveler.minor ? t("pax-trips-minor-help") : t("pax-trips-empty-body")}
            action={
              locked || traveler.minor ? undefined : { label: t("pax-trip-add"), onClick: () => setEditing("new") }
            }
          />
        ) : (
          <Box component="ul" className="m-0 flex list-none flex-col gap-4 p-0">
            {detail.trips.map((trip) => {
              const holder = holderOf(trip);
              const documents = detail.documents.filter((document) => document.tripId === trip.id);
              return (
                <Box
                  component="li"
                  key={trip.id}
                  className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4"
                >
                  <Box className="flex flex-wrap items-center justify-between gap-2">
                    <Typography variant="subtitle2" component="h3">
                      {trip.locator ? t("pax-trip-locator-is", { locator: trip.locator }) : t("pax-trip-no-locator")}
                    </Typography>
                    <StatusChip label={t(TRIP_STATE_KEY[trip.state])} tone={TRIP_STATE_TONE[trip.state]} />
                  </Box>
                  <Typography variant="body2" className="text-text-secondary">
                    {[
                      holder ? t("pax-trip-holder-is", { name: holder.fullName }) : null,
                      trip.travelers.length > 1
                        ? t("pax-trip-with", {
                            names: trip.travelers
                              .filter((person) => person.id !== trip.holderId)
                              .map((person) => person.fullName)
                              .join(", "),
                          })
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Typography>
                  <TripProgress
                    trip={trip}
                    everAgreed={everAgreed}
                    agreedAt={agreed?.createdAt ?? null}
                    linkUntil={linkUntil}
                  />
                  <Box component="ol" className="m-0 flex list-none flex-col gap-1 p-0">
                    {trip.legs.map((leg) => (
                      <Typography component="li" variant="body2" key={leg.position}>
                        {t("pax-trip-leg-line", {
                          flight: leg.flightNumber,
                          origin: leg.originIata,
                          destination: leg.destinationIata,
                          departure: localTimeLabel(leg.departure),
                          arrival: localTimeLabel(leg.arrival),
                        })}
                      </Typography>
                    ))}
                  </Box>
                  {documents.length > 0 && (
                    <Box component="ul" className="m-0 flex list-none flex-col gap-2 p-0">
                      {documents.map((document) => (
                        <DocumentLine key={document.id} document={document} canOpen={!locked} />
                      ))}
                    </Box>
                  )}
                  {!locked && (
                    <Box className="flex flex-wrap gap-2">
                      {changeable(trip) && holder && (
                        <Button variant="outlined" color="grey" size="small" onClick={() => setEditing(trip)}>
                          {t("pax-trip-edit")}
                        </Button>
                      )}
                      {(["ticket", "boarding_pass"] as const).map((kind) => (
                        <FileButton
                          key={kind}
                          variant="text"
                          color="grey"
                          size="small"
                          disabled={sending !== null}
                          label={
                            sending === `${trip.id}:${kind}` ? t("pax-document-sending") : t(SEND_DOCUMENT_KEY[kind])
                          }
                          onFile={(file) => void send(trip, kind, file)}
                        />
                      ))}
                    </Box>
                  )}
                </Box>
              );
            })}
          </Box>
        )}
        {message && (
          <Alert
            severity={message.ok ? "success" : "error"}
            className={message.ok ? "neutral bg-background-paper/60!" : undefined}
          >
            {message.text}
          </Alert>
        )}
      </CardContent>

      {editing && (
        <TripDialog
          trip={editing === "new" ? null : editing}
          holder={editing === "new" ? self : (holderOf(editing) ?? self)}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
    </Card>
  );
}

/** Where one trip stands along its way, and in a sentence what happens now and who it is with. */
function TripProgress({
  trip,
  everAgreed,
  agreedAt,
  linkUntil,
}: {
  trip: PaxTrip;
  everAgreed: boolean;
  agreedAt: string | null;
  linkUntil: string | null;
}) {
  const t = useTranslations("product");
  const journey = tripJourney({ state: trip.state, everAgreed });
  const firstLeg = trip.legs[0] ?? null;
  const steps = journey.steps.map(({ step, state }) => ({
    key: step,
    label: t(TRIP_STEP_KEY[step]),
    state,
    icon: STEP_ICON[step],
    when:
      step === "agreement" && state === "done" && agreedAt
        ? dayOf(agreedAt)
        : step === "watching" && firstLeg
          ? t("pax-journey-flight-on", { day: dayOf(firstLeg.departure, true) })
          : null,
  }));
  const extra =
    trip.state === "waiting_consent"
      ? linkUntil
        ? t("pax-journey-link-until", { date: linkUntil })
        : t("pax-journey-link-none")
      : null;
  return (
    <Box className="flex flex-col gap-4 py-1">
      <ProgressSteps
        steps={steps}
        label={t("pax-journey-title")}
        stateWords={{
          done: t("journey-state-done"),
          current: t("journey-state-current"),
          next: t("journey-state-next"),
          stopped: t("pax-journey-state-stopped"),
        }}
      />
      <ProgressNow
        tone={journey.ended === "firm" ? "done" : journey.ended ? "stopped" : "progress"}
        lead={t(TRIP_HOLDER_KEY[journey.holder])}
        text={t(TRIP_NOW_KEY[trip.state])}
        extra={
          extra ? (
            <Typography variant="body2" className="text-text-secondary">
              {extra}
            </Typography>
          ) : undefined
        }
      />
    </Box>
  );
}
