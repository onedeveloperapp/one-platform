"use client";

import DocumentsSection from "./documents-section";
import RightsSection from "./rights-section";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Collapse,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Paper,
  Typography,
} from "@mui/material";

import CardTitle from "@/components/product/card-title";
import { PhoneField } from "@/components/product/fields";
import OutcomeDialog, { type OutcomeLine } from "@/components/product/outcome-dialog";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import { TILE_TONE } from "@/components/product/tile-tone";
import NiArrowHistory from "@/icons/nexture/ni-arrow-history";
import NiCheck from "@/icons/nexture/ni-check";
import NiChevronDown from "@/icons/nexture/ni-chevron-down";
import NiCrossSquare from "@/icons/nexture/ni-cross-square";
import NiPhone from "@/icons/nexture/ni-phone";
import NiPlane from "@/icons/nexture/ni-plane";
import NiShieldCheck from "@/icons/nexture/ni-shield-check";
import NiUserCheck from "@/icons/nexture/ni-user-check";
import { cn } from "@/lib/utils";
import {
  type AgreementTrip,
  type AgreementView as View,
  LINK_TRIP_STATE_KEY,
} from "@/modules/direito-do-passageiro/agency/agreement";
import { answerAgreement, readAgreement } from "@/modules/direito-do-passageiro/agency/link-actions";
import { localTimeLabel, paxErrorKey, TRIP_STATE_TONE } from "@/modules/direito-do-passageiro/agency/passengers";
import { onlyDigits } from "@flyee/fields";

type OpenView = Extract<View, { state: "open" | "handed_over" }>;
type Answer = "agreed" | "declined" | "withdrawn";

/** How long the page reads itself again after a document was sent, while the AI reads it. */
const WATCH_MS = 5 * 60 * 1000;
const EVERY_MS = 10 * 1000;

/**
 * What the passenger does on the agency's link. They came to say whether ONE may follow their flights and the
 * firm tell them of a problem; success is an answer given in the words they read, at a WhatsApp they recognise,
 * understood, and, if they wish, their documents sent. Each card leads with its icon and says where it stands in
 * colour and words (the owner, 2026-11-03): the agreement waiting for an answer, or registered, with the WhatsApp
 * the alerts go to; the trips and whether ONE follows each; the documents, asking only for what has not arrived.
 * An answer is confirmed in a dialog that says what it changed, never in a line at the top the passenger reads
 * past; a trip the agency added after the answer waits for them to agree again; leaving the agreement says what
 * stops before it runs.
 */
export default function AgreementView({ token, initial }: { token: string; initial: OpenView }) {
  const t = useTranslations("product");
  const [view, setView] = useState<OpenView>(initial);
  const [phone, setPhone] = useState("");
  const [changingPhone, setChangingPhone] = useState(false);
  const [busy, setBusy] = useState<Answer | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [phoneProblem, setPhoneProblem] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);
  const [outcome, setOutcome] = useState<{ answer: Answer; followed: number } | null>(null);
  const [showWording, setShowWording] = useState(false);
  const [watchUntil, setWatchUntil] = useState(0);
  const [gone, setGone] = useState(false);
  const status = useRef<HTMLDivElement>(null);

  const holder = view.people.find((person) => person.isHolder) ?? null;
  const agreed = view.consent === "agreed";
  // A yes that no longer covers the passenger's trips (0086): their WhatsApp changed since they agreed, or a trip was
  // added or completed after it. Either way ONE follows those trips only once they agree again.
  const owed = agreed ? view.reagree : null;
  // The WhatsApp is written here when none is on record, or when the passenger says the one on record is not theirs.
  const writingPhone = Boolean(holder) && (!holder?.hasPhone || changingPhone);
  const reading = view.people.some((person) =>
    person.documents.some((document) => document.reading === "pending" || document.reading === "working"),
  );
  // Agreed, the words stay one click away; they are in view whenever the passenger is about to agree to them.
  const wordingOpen = !agreed || owed !== null || changingPhone || showWording;

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

  const fail = (text: string) => {
    setProblem(text);
    setTimeout(() => status.current?.focus(), 0);
  };

  const answer = async (choice: Answer) => {
    if (!view.wording) return;
    setProblem(null);
    setPhoneProblem(null);
    if (choice === "agreed" && writingPhone && onlyDigits(phone).length < 10) {
      setPhoneProblem(t("pax-error-phone"));
      return;
    }
    setBusy(choice);
    const result = await answerAgreement({
      token,
      answer: choice,
      wording: view.wording,
      phone: choice === "agreed" && writingPhone ? onlyDigits(phone) : null,
    });
    setBusy(null);
    setLeaving(false);
    if (!result.ok) {
      if (result.code === "no_phone" || result.code === "invalid_phone") setPhoneProblem(t("pax-error-phone"));
      else fail(t(paxErrorKey(result.code)));
      if (result.code === "wording_changed") await reload();
      return;
    }
    setChangingPhone(false);
    setPhone("");
    setShowWording(false);
    await reload();
    setOutcome({ answer: choice, followed: result.followed });
  };

  // Once deleted, nothing of the passenger is shown again: the page says so and stops.
  if (gone) {
    return (
      <Paper elevation={0} className="bg-background-paper flex flex-col gap-4 rounded-4xl px-6 py-10 sm:px-12">
        <span
          aria-hidden
          className="bg-success/15 text-success flex h-14 w-14 items-center justify-center rounded-full"
        >
          <NiCheck size="large" />
        </span>
        <Typography variant="h1" component="h1" className="mb-0">
          {t("pax-link-gone-title")}
        </Typography>
        <Typography variant="body1">{t("pax-link-gone-body", { agency: view.agency })}</Typography>
      </Paper>
    );
  }

  const chip = !view.wording ? null : owed ? (
    <StatusChip label={t("pax-reagree-chip")} tone="attention" />
  ) : agreed ? (
    <StatusChip label={t("pax-consent-agreed")} tone="positive" />
  ) : view.consent === "declined" ? (
    <StatusChip label={t("pax-consent-declined")} tone="neutral" />
  ) : view.consent === "withdrawn" ? (
    <StatusChip label={t("pax-consent-withdrawn")} tone="neutral" />
  ) : (
    <StatusChip label={t("pax-link-answer-missing")} tone="attention" />
  );

  // The WhatsApp the alerts go to, by its end, with the way to say it is not theirs; or the field to write it in.
  const phoneLine = holder && (
    <Box className="flex flex-col gap-3">
      {holder.phoneEnd && (
        <StateLine
          tone={agreed && !owed && !changingPhone ? "done" : "info"}
          icon={<NiPhone size="medium" />}
          action={
            <Button
              variant="text"
              color="grey"
              size="small"
              disabled={busy !== null}
              onClick={() => {
                setChangingPhone(!changingPhone);
                setPhone("");
                setPhoneProblem(null);
              }}
            >
              {changingPhone ? t("pax-link-phone-keep") : t("pax-link-phone-change")}
            </Button>
          }
        >
          {t("pax-link-phone-on-record", { end: holder.phoneEnd })}
        </StateLine>
      )}
      {writingPhone && (
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
    </Box>
  );

  const agreeButton = (
    <Button
      variant="contained"
      disabled={busy !== null}
      startIcon={<NiCheck size="small" />}
      onClick={() => void answer("agreed")}
    >
      {busy === "agreed" ? t("pax-link-answering") : t("pax-link-agree")}
    </Button>
  );

  const outcomeLines = (): OutcomeLine[] => {
    if (!outcome) return [];
    const mind = { key: "mind", icon: <NiArrowHistory size="medium" />, text: t("pax-link-outcome-change-mind") };
    if (outcome.answer === "declined") {
      return [{ key: "none", icon: <NiPlane size="medium" />, text: t("pax-link-outcome-declined") }, mind];
    }
    if (outcome.answer === "withdrawn") {
      return [{ key: "stop", icon: <NiPlane size="medium" />, text: t("pax-link-outcome-withdrawn") }, mind];
    }
    return [
      {
        key: "trips",
        icon: <NiPlane size="medium" />,
        text: t("pax-link-outcome-trips", { count: outcome.followed }),
      },
      {
        key: "alerts",
        icon: <NiPhone size="medium" />,
        text: holder?.phoneEnd
          ? t("pax-link-outcome-alerts", { firm: view.firm, end: holder.phoneEnd })
          : t("pax-link-outcome-alerts-plain", { firm: view.firm }),
      },
      { key: "decide", icon: <NiUserCheck size="medium" />, text: t("pax-link-outcome-decide") },
      { key: "leave", icon: <NiShieldCheck size="medium" />, text: t("pax-link-outcome-leave") },
    ];
  };

  return (
    <>
      <Paper elevation={0} className="bg-background-paper flex flex-col gap-3 rounded-4xl px-6 py-8 sm:px-12">
        <span
          aria-hidden
          className={cn(
            "flex h-12 w-12 items-center justify-center rounded-2xl",
            TILE_TONE.primary.bg,
            TILE_TONE.primary.text,
          )}
        >
          <NiPlane size="large" />
        </span>
        <Typography variant="overline" component="p" className="text-text-secondary">
          {view.agency}
        </Typography>
        <Typography variant="h1" component="h1" className="mb-0">
          {t("pax-link-title")}
        </Typography>
        <Typography variant="body1">{t("pax-link-intro", { agency: view.agency, firm: view.firm })}</Typography>
      </Paper>

      <Paper
        component="section"
        aria-labelledby="pax-link-agreement"
        elevation={0}
        className="bg-background-paper flex flex-col gap-4 rounded-4xl px-6 py-8 sm:px-12"
      >
        <CardTitle
          id="pax-link-agreement"
          icon={<NiShieldCheck size="medium" />}
          tone="primary"
          title={t("pax-link-agreement-title")}
          chip={chip}
        />
        <Box ref={status} tabIndex={-1} role="status" aria-live="polite" className="outline-none">
          {problem && <Alert severity="error">{problem}</Alert>}
        </Box>
        {!view.wording ? (
          <StateLine tone="waiting">{t("pax-link-no-clause")}</StateLine>
        ) : (
          <>
            {owed ? (
              <StateLine tone="attention" emphasis>
                <strong>{t("pax-link-reagree-lead")}</strong>{" "}
                {owed === "trip_waiting"
                  ? t("pax-link-reagree-trip")
                  : holder?.phoneEnd
                    ? t("pax-link-reagree-phone", { end: holder.phoneEnd })
                    : t("pax-link-reagree-phone-plain")}
              </StateLine>
            ) : agreed ? (
              <StateLine tone="done" emphasis>
                <strong>{t("pax-link-agreed-lead")}</strong> {t("pax-link-agreed-state")}
              </StateLine>
            ) : view.consent === "declined" ? (
              <StateLine tone="info">{t("pax-link-declined-state")}</StateLine>
            ) : view.consent === "withdrawn" ? (
              <StateLine tone="info">{t("pax-link-withdrawn-state")}</StateLine>
            ) : null}
            {agreed && phoneLine}
            {agreed && !owed && !changingPhone && (
              <Box>
                <Button
                  variant="text"
                  color="grey"
                  size="small"
                  aria-expanded={wordingOpen}
                  aria-controls="pax-link-wording"
                  endIcon={
                    <NiChevronDown
                      size="small"
                      className={cn("transition-transform motion-reduce:transition-none", wordingOpen && "rotate-180")}
                    />
                  }
                  onClick={() => setShowWording(!showWording)}
                >
                  {wordingOpen ? t("pax-link-wording-hide") : t("pax-link-wording-show")}
                </Button>
              </Box>
            )}
            <Collapse in={wordingOpen} unmountOnExit={false}>
              <Box id="pax-link-wording" className="bg-grey-25 rounded-2xl p-4">
                <Typography variant="body1" className="whitespace-pre-line">
                  {view.wording}
                </Typography>
              </Box>
            </Collapse>
            {agreed ? (
              <>
                <Box className="flex flex-wrap items-center gap-2">
                  {(owed || changingPhone) && agreeButton}
                  <Button
                    variant="text"
                    color="grey"
                    disabled={busy !== null}
                    startIcon={<NiCrossSquare size="small" />}
                    onClick={() => setLeaving(true)}
                  >
                    {t("pax-link-withdraw")}
                  </Button>
                </Box>
              </>
            ) : (
              <>
                {phoneLine}
                <Box className="flex flex-wrap gap-2">
                  {agreeButton}
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
              </>
            )}
          </>
        )}
      </Paper>

      <TripsSection trips={view.trips} />

      <DocumentsSection
        token={token}
        people={view.people}
        trips={view.trips}
        uploadsLeft={view.uploadsLeft}
        onSent={async () => {
          setWatchUntil(Date.now() + WATCH_MS);
          await reload();
        }}
      />

      <RightsSection token={token} agency={view.agency} firm={view.firm} variant="open" onGone={() => setGone(true)} />

      <Typography variant="body2" className="text-text-secondary px-2">
        {t("pax-link-footer", { agency: view.agency, firm: view.firm })}
      </Typography>

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

      {outcome && (
        <OutcomeDialog
          open
          tone={outcome.answer === "agreed" ? "done" : "info"}
          title={
            outcome.answer === "agreed"
              ? t("pax-link-outcome-agreed-title")
              : outcome.answer === "declined"
                ? t("pax-link-outcome-declined-title")
                : t("pax-link-outcome-withdrawn-title")
          }
          lines={outcomeLines()}
          closeLabel={t("pax-link-outcome-ok")}
          onClose={() => setOutcome(null)}
        />
      )}
    </>
  );
}

/** The trips of the link: each leg, and whether ONE follows the trip now, in colour and words. */
function TripsSection({ trips }: { trips: AgreementTrip[] }) {
  const t = useTranslations("product");
  const followed = trips.filter((trip) => trip.state === "watching").length;
  return (
    <Paper
      component="section"
      aria-labelledby="pax-link-trips"
      elevation={0}
      className="bg-background-paper flex flex-col gap-4 rounded-4xl px-6 py-8 sm:px-12"
    >
      <CardTitle
        id="pax-link-trips"
        icon={<NiPlane size="medium" />}
        tone="accent-2"
        title={t("pax-link-trips-title")}
        chip={
          followed > 0 ? (
            <StatusChip label={t("pax-link-trips-followed", { count: followed })} tone="positive" />
          ) : undefined
        }
      />
      {trips.length === 0 ? (
        <StateLine tone="waiting">{t("pax-link-no-trips")}</StateLine>
      ) : (
        <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
          {trips.map((trip) => (
            <Box component="li" key={trip.id} className="border-grey-100 flex flex-col gap-3 rounded-2xl border p-4">
              <Box className="flex flex-wrap items-center justify-between gap-2">
                <Typography variant="subtitle1" component="h3" className="mb-0">
                  {trip.locator ? t("pax-trip-locator-is", { locator: trip.locator }) : t("pax-trip-no-locator")}
                </Typography>
                <StatusChip label={t(LINK_TRIP_STATE_KEY[trip.state])} tone={TRIP_STATE_TONE[trip.state]} />
              </Box>
              <Box component="ol" className="m-0 flex list-none flex-col gap-2 p-0">
                {trip.legs.map((leg) => (
                  <Box component="li" key={leg.position} className="flex flex-row items-start gap-2">
                    <span aria-hidden className="text-text-secondary flex-none pt-0.5">
                      <NiPlane size="small" />
                    </span>
                    <Typography variant="body2" className="min-w-0 flex-1">
                      {t("pax-trip-leg-line", {
                        flight: leg.flightNumber,
                        origin: leg.originIata,
                        destination: leg.destinationIata,
                        departure: localTimeLabel(leg.departure),
                        arrival: localTimeLabel(leg.arrival),
                      })}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          ))}
        </Box>
      )}
    </Paper>
  );
}
