"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Typography,
} from "@mui/material";

import { PhoneField } from "@/components/product/fields";
import StatusChip from "@/components/product/status-chip";
import {
  agreementDocumentKey,
  type AgreementPerson,
  type AgreementTrip,
  type AgreementView as View,
  LINK_TRIP_STATE_KEY,
} from "@/modules/direito-do-passageiro/agency/agreement";
import { downloadJson } from "@/modules/direito-do-passageiro/agency/download-json";
import FileButton from "@/modules/direito-do-passageiro/agency/file-button";
import {
  answerAgreement,
  exportAgreement,
  forgetAgreement,
  readAgreement,
} from "@/modules/direito-do-passageiro/agency/link-actions";
import {
  DOCUMENT_KIND_KEY,
  localTimeLabel,
  type PaxDocumentKind,
  paxErrorKey,
  TRIP_STATE_TONE,
} from "@/modules/direito-do-passageiro/agency/passengers";
import { sendLinkFile } from "@/modules/direito-do-passageiro/agency/send-files";
import { onlyDigits } from "@flyee/fields";

type OpenView = Extract<View, { state: "open" | "handed_over" }>;

/** How long the page reads itself again after a document was sent, while the AI reads it. */
const WATCH_MS = 5 * 60 * 1000;
const EVERY_MS = 10 * 1000;

/**
 * What the passenger does on the agency's link. They came to say whether ONE may follow their flights and the
 * firm tell them of a problem; success is an answer given in the words they read, and, if they wish, their
 * documents sent. The words are shown whole, as they are kept with the answer; a change of mind is one click,
 * and leaving the agreement says what stops.
 */
export default function AgreementView({ token, initial }: { token: string; initial: OpenView }) {
  const t = useTranslations("product");
  const [view, setView] = useState<OpenView>(initial);
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState<"agreed" | "declined" | "withdrawn" | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [phoneProblem, setPhoneProblem] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const [watchUntil, setWatchUntil] = useState(0);
  const [rights, setRights] = useState<"download" | "forget" | null>(null);
  const [forgetting, setForgetting] = useState(false);
  const [gone, setGone] = useState(false);
  const status = useRef<HTMLDivElement>(null);

  const holder = view.people.find((person) => person.isHolder) ?? null;
  const agreed = view.consent === "agreed";
  const reading = view.people.some((person) =>
    person.documents.some((document) => document.reading === "pending" || document.reading === "working"),
  );

  const reload = async () => {
    const result = await readAgreement(token);
    if (result.ok && (result.view.state === "open" || result.view.state === "handed_over")) setView(result.view);
  };

  // While a document sent here is being read, the page reads itself again, so its result shows while they wait.
  useEffect(() => {
    if (!reading || Date.now() > watchUntil) return;
    const timer = setInterval(() => {
      if (Date.now() > watchUntil) clearInterval(timer);
      else void reload();
    }, EVERY_MS);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reading, watchUntil]);

  const say = (next: { ok: boolean; text: string }) => {
    setMessage(next);
    setTimeout(() => status.current?.focus(), 0);
  };

  const answer = async (choice: "agreed" | "declined" | "withdrawn") => {
    if (!view.wording) return;
    setPhoneProblem(null);
    if (choice === "agreed" && holder && !holder.hasPhone && onlyDigits(phone).length < 10) {
      setPhoneProblem(t("pax-error-phone"));
      return;
    }
    setBusy(choice);
    const result = await answerAgreement({
      token,
      answer: choice,
      wording: view.wording,
      phone: holder && !holder.hasPhone ? onlyDigits(phone) : null,
    });
    setBusy(null);
    setLeaving(false);
    if (!result.ok) {
      if (result.code === "no_phone" || result.code === "invalid_phone") setPhoneProblem(t("pax-error-phone"));
      else say({ ok: false, text: t(paxErrorKey(result.code)) });
      if (result.code === "wording_changed") await reload();
      return;
    }
    await reload();
    say({
      ok: true,
      text:
        choice === "agreed"
          ? t("pax-link-agreed", { count: result.followed })
          : choice === "declined"
            ? t("pax-link-declined")
            : t("pax-link-withdrawn"),
    });
  };

  const send = async (person: AgreementPerson, kind: PaxDocumentKind, tripId: string | null, file: File) => {
    const key = `${person.id}:${kind}:${tripId ?? ""}`;
    setSending(key);
    setMessage(null);
    const result = await sendLinkFile(token, file, { travelerId: person.id, kind, tripId });
    setSending(null);
    if (!result.ok) {
      say({ ok: false, text: t(paxErrorKey(result.code)) });
      return;
    }
    setWatchUntil(Date.now() + WATCH_MS);
    await reload();
    say({ ok: true, text: t("pax-link-document-sent") });
  };

  const download = async () => {
    setRights("download");
    setMessage(null);
    const result = await exportAgreement(token);
    setRights(null);
    if (!result.ok) {
      say({ ok: false, text: t(paxErrorKey(result.code)) });
      return;
    }
    downloadJson(result.data, "meus-dados.json");
  };

  const forget = async () => {
    setRights("forget");
    const result = await forgetAgreement(token);
    setRights(null);
    setForgetting(false);
    if (!result.ok) {
      say({ ok: false, text: t(paxErrorKey(result.code)) });
      return;
    }
    setGone(true);
  };

  // Once deleted, nothing of the passenger is shown again: the page says so and stops.
  if (gone) {
    return (
      <Paper elevation={0} className="bg-background-paper flex flex-col gap-3 rounded-4xl px-6 py-10 sm:px-12">
        <Typography variant="h1" component="h1" className="mb-0">
          {t("pax-link-gone-title")}
        </Typography>
        <Typography variant="body1">{t("pax-link-gone-body", { agency: view.agency })}</Typography>
      </Paper>
    );
  }

  return (
    <>
      <Paper elevation={0} className="bg-background-paper flex flex-col gap-3 rounded-4xl px-6 py-8 sm:px-12">
        <Typography variant="overline" component="p" className="text-text-secondary">
          {view.agency}
        </Typography>
        <Typography variant="h1" component="h1" className="mb-0">
          {t("pax-link-title")}
        </Typography>
        <Typography variant="body1">{t("pax-link-intro", { agency: view.agency, firm: view.firm })}</Typography>
      </Paper>

      <Box ref={status} tabIndex={-1} role="status" aria-live="polite" className="outline-none">
        {message && (
          <Alert
            severity={message.ok ? "success" : "error"}
            className={message.ok ? "neutral bg-background-paper/60!" : undefined}
          >
            {message.text}
          </Alert>
        )}
      </Box>

      <Paper
        component="section"
        aria-labelledby="pax-link-agreement"
        elevation={0}
        className="bg-background-paper flex flex-col gap-4 rounded-4xl px-6 py-8 sm:px-12"
      >
        <Box className="flex flex-wrap items-center justify-between gap-2">
          <Typography id="pax-link-agreement" variant="h4" component="h2" className="mb-0">
            {t("pax-link-agreement-title")}
          </Typography>
          {agreed && <StatusChip label={t("pax-consent-agreed")} tone="positive" />}
        </Box>
        {view.wording ? (
          <>
            <Box className="bg-grey-25 rounded-2xl p-4">
              <Typography variant="body1" className="whitespace-pre-line">
                {view.wording}
              </Typography>
            </Box>
            {agreed ? (
              <Box className="flex flex-col gap-3">
                <Typography variant="body2">{t("pax-link-agreed-state")}</Typography>
                <Box>
                  <Button variant="text" color="grey" disabled={busy !== null} onClick={() => setLeaving(true)}>
                    {t("pax-link-withdraw")}
                  </Button>
                </Box>
              </Box>
            ) : (
              <Box className="flex flex-col gap-3">
                {view.consent === "declined" && <Typography variant="body2">{t("pax-link-declined-state")}</Typography>}
                {view.consent === "withdrawn" && (
                  <Typography variant="body2">{t("pax-link-withdrawn-state")}</Typography>
                )}
                {holder && !holder.hasPhone && (
                  <PhoneField
                    id="pax-link-phone"
                    label={t("pax-link-phone")}
                    value={phone}
                    size="small"
                    fullWidth
                    disabled={busy !== null}
                    error={Boolean(phoneProblem)}
                    helperText={phoneProblem ?? t("pax-link-phone-help")}
                    invalidMessage={t("pax-error-phone")}
                    onChange={(event) => setPhone(event.target.value)}
                  />
                )}
                <Box className="flex flex-wrap gap-2">
                  <Button variant="contained" disabled={busy !== null} onClick={() => void answer("agreed")}>
                    {busy === "agreed" ? t("pax-link-answering") : t("pax-link-agree")}
                  </Button>
                  {view.consent !== "declined" && (
                    <Button
                      variant="text"
                      color="grey"
                      disabled={busy !== null}
                      onClick={() => void answer("declined")}
                    >
                      {busy === "declined" ? t("pax-link-answering") : t("pax-link-decline")}
                    </Button>
                  )}
                </Box>
              </Box>
            )}
          </>
        ) : (
          <Alert severity="info" className="neutral bg-background-paper/60!">
            {t("pax-link-no-clause")}
          </Alert>
        )}
      </Paper>

      <TripsSection trips={view.trips} />

      <Paper
        component="section"
        aria-labelledby="pax-link-documents"
        elevation={0}
        className="bg-background-paper flex flex-col gap-4 rounded-4xl px-6 py-8 sm:px-12"
      >
        <Typography id="pax-link-documents" variant="h4" component="h2" className="mb-0">
          {t("pax-link-documents-title")}
        </Typography>
        <Typography variant="body2" className="text-text-secondary">
          {view.uploadsLeft > 0 ? t("pax-link-documents-help") : t("pax-error-upload-limit")}
        </Typography>
        <Box component="ul" className="m-0 flex list-none flex-col gap-4 p-0">
          {view.people.map((person) => {
            const kinds: { kind: PaxDocumentKind; tripId: string | null; label: string }[] = [
              { kind: "identity", tripId: null, label: t("pax-document-send-identity") },
              ...(person.isHolder
                ? [{ kind: "address_proof" as const, tripId: null, label: t("pax-document-send-address") }]
                : []),
              ...view.trips.map((trip) => ({
                kind: "boarding_pass" as const,
                tripId: trip.id,
                label: trip.locator
                  ? t("pax-link-send-boarding-of", { locator: trip.locator })
                  : t("pax-document-send-boarding"),
              })),
            ];
            return (
              <Box
                component="li"
                key={person.id}
                className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4"
              >
                <Typography variant="subtitle2" component="h3">
                  {person.minor ? t("pax-link-person-minor", { name: person.fullName }) : person.fullName}
                </Typography>
                {person.documents.length > 0 && (
                  <Box component="ul" className="m-0 flex list-none flex-col gap-1 p-0">
                    {person.documents.map((document) => (
                      <Typography component="li" variant="body2" key={document.id}>
                        {t("pax-link-document-line", {
                          kind: t(DOCUMENT_KIND_KEY[document.kind]),
                          state: t(agreementDocumentKey(document)),
                        })}
                      </Typography>
                    ))}
                  </Box>
                )}
                {view.uploadsLeft > 0 && (
                  <Box className="flex flex-wrap gap-2">
                    {kinds.map((item) => {
                      const key = `${person.id}:${item.kind}:${item.tripId ?? ""}`;
                      return (
                        <FileButton
                          key={key}
                          variant="outlined"
                          color="grey"
                          size="small"
                          disabled={sending !== null}
                          label={sending === key ? t("pax-document-sending") : item.label}
                          onFile={(file) => void send(person, item.kind, item.tripId, file)}
                        />
                      );
                    })}
                  </Box>
                )}
              </Box>
            );
          })}
        </Box>
      </Paper>

      <Paper
        component="section"
        aria-labelledby="pax-link-rights"
        elevation={0}
        className="bg-background-paper flex flex-col gap-3 rounded-4xl px-6 py-8 sm:px-12"
      >
        <Typography id="pax-link-rights" variant="h4" component="h2" className="mb-0">
          {t("pax-link-rights-title")}
        </Typography>
        <Typography variant="body2" className="text-text-secondary">
          {t("pax-link-rights-body", { agency: view.agency })}
        </Typography>
        <Box className="flex flex-wrap gap-2">
          <Button variant="outlined" color="grey" disabled={rights !== null} onClick={() => void download()}>
            {rights === "download" ? t("pax-privacy-downloading") : t("pax-link-rights-download")}
          </Button>
          <Button variant="text" color="error" disabled={rights !== null} onClick={() => setForgetting(true)}>
            {t("pax-link-rights-forget")}
          </Button>
        </Box>
      </Paper>

      <Typography variant="body2" className="text-text-secondary px-2">
        {t("pax-link-footer", { agency: view.agency, firm: view.firm })}
      </Typography>

      {forgetting && (
        <Dialog open onClose={rights ? undefined : () => setForgetting(false)} aria-labelledby="pax-link-forget-title">
          <DialogTitle id="pax-link-forget-title">{t("pax-link-forget-title")}</DialogTitle>
          <DialogContent>
            <Typography variant="body1">
              {t("pax-link-forget-body", { agency: view.agency, firm: view.firm })}
            </Typography>
          </DialogContent>
          <DialogActions>
            <Button variant="text" color="grey" disabled={rights !== null} onClick={() => setForgetting(false)}>
              {t("pax-link-forget-keep")}
            </Button>
            <Button variant="contained" color="error" disabled={rights !== null} onClick={() => void forget()}>
              {rights === "forget" ? t("pax-link-forgetting") : t("pax-link-forget-confirm")}
            </Button>
          </DialogActions>
        </Dialog>
      )}

      {leaving && (
        <Dialog open onClose={busy ? undefined : () => setLeaving(false)} aria-labelledby="pax-link-leave-title">
          <DialogTitle id="pax-link-leave-title">{t("pax-link-withdraw-title")}</DialogTitle>
          <DialogContent>
            <Typography variant="body1">{t("pax-link-withdraw-body")}</Typography>
          </DialogContent>
          <DialogActions>
            <Button variant="text" color="grey" disabled={busy !== null} onClick={() => setLeaving(false)}>
              {t("pax-link-withdraw-keep")}
            </Button>
            <Button variant="contained" color="error" disabled={busy !== null} onClick={() => void answer("withdrawn")}>
              {busy === "withdrawn" ? t("pax-link-answering") : t("pax-link-withdraw-confirm")}
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
}

/** The trips of the link: each leg, and whether ONE follows it now. */
function TripsSection({ trips }: { trips: AgreementTrip[] }) {
  const t = useTranslations("product");
  return (
    <Paper
      component="section"
      aria-labelledby="pax-link-trips"
      elevation={0}
      className="bg-background-paper flex flex-col gap-4 rounded-4xl px-6 py-8 sm:px-12"
    >
      <Typography id="pax-link-trips" variant="h4" component="h2" className="mb-0">
        {t("pax-link-trips-title")}
      </Typography>
      {trips.length === 0 ? (
        <Typography variant="body2" className="text-text-secondary">
          {t("pax-link-no-trips")}
        </Typography>
      ) : (
        <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
          {trips.map((trip) => (
            <Box component="li" key={trip.id} className="border-grey-100 flex flex-col gap-2 rounded-2xl border p-4">
              <Box className="flex flex-wrap items-center justify-between gap-2">
                <Typography variant="subtitle2" component="h3">
                  {trip.locator ? t("pax-trip-locator-is", { locator: trip.locator }) : t("pax-trip-no-locator")}
                </Typography>
                <StatusChip label={t(LINK_TRIP_STATE_KEY[trip.state])} tone={TRIP_STATE_TONE[trip.state]} />
              </Box>
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
            </Box>
          ))}
        </Box>
      )}
    </Paper>
  );
}
