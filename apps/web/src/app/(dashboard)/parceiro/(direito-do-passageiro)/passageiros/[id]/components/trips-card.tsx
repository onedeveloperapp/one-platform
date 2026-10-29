"use client";

import DocumentLine from "./document-line";
import TripDialog from "./trip-dialog";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Card, CardContent, Typography } from "@mui/material";

import EmptyState from "@/components/product/empty-state";
import StatusChip from "@/components/product/status-chip";
import NiPlane from "@/icons/nexture/ni-plane";
import FileButton from "@/modules/direito-do-passageiro/agency/file-button";
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

/** A trip whose flights ONE has not told anything of yet: the agency may still change it. */
const changeable = (trip: PaxTrip) => trip.state === "waiting_consent" || trip.state === "watching";

/**
 * The trips the passenger is on: each with what ONE does of it now, who travels, every leg, and the passenger's
 * ticket and boarding pass of it. An adult holds a trip (the alerts go to their WhatsApp); a child travels along
 * on the trip of the adult who holds it.
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
                        <DocumentLine key={document.id} document={document} />
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
