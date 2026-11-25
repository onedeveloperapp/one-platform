"use client";

import type { CaseSegment, CaseState } from "../case-types";
import TicketDialog from "./ticket-dialog";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, ButtonBase, Dialog, DialogActions, DialogContent, Typography } from "@mui/material";

import SegmentFields from "@/components/cases/segment-fields";
import CollapsibleCard from "@/components/product/collapsible-card";
import DialogHeader from "@/components/product/dialog-header";
import EmptyState from "@/components/product/empty-state";
import QuickActions from "@/components/product/quick-actions";
import StateLine from "@/components/product/state-line";
import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import IllustrationLaunch from "@/icons/illustrations/illustration-launch";
import NiCrossSquare from "@/icons/nexture/ni-cross-square";
import { removeFlightSegment, saveFlightSegment } from "@/lib/cases/actions";
import { caseErrorKey, formatLocalTime } from "@/lib/cases/cases";
import { segmentFields, type SegmentValues, segmentValues } from "@/lib/cases/forms";
import { beforeCourt, opensOnArrival } from "@/lib/cases/sections";
import { lookupFlight, recheckFlight } from "@/modules/direito-do-passageiro/flights/actions";
import type { LegChecks, SourceView, WallTime } from "@/modules/direito-do-passageiro/flights/facts";
import { flightErrorKey, lookupFailureKey, recordFailureKey } from "@/modules/direito-do-passageiro/flights/words";
import { arrivalDelayMinutes } from "@flyee/rules/flight";

type Ready = Extract<CaseState, { kind: "ready" }>;

/** Minutes as people say them: `3 h 20 min`. */
const hoursAndMinutes = (minutes: number) =>
  minutes >= 60 ? `${Math.floor(minutes / 60)} h${minutes % 60 ? ` ${minutes % 60} min` : ""}` : `${minutes} min`;

/** How a leg stands against ANAC's official record, by its chip. */
const AGREEMENT: Record<string, { tone: StatusTone; key: string }> = {
  agrees: { tone: "positive", key: "flight-record-agrees" },
  differs: { tone: "attention", key: "flight-record-differs" },
  cancelled: { tone: "info", key: "flight-record-cancelled" },
  diverted: { tone: "info", key: "flight-record-diverted" },
  nothing_to_compare: { tone: "neutral", key: "flight-record-found" },
};

/** What a leg of the flight no schedule foresaw is, by the code the record gives it. */
const UNSCHEDULED_KEY: Record<string, string> = {
  extra: "flight-unscheduled-extra",
  return: "flight-unscheduled-return",
  included: "flight-unscheduled-included",
  duplicated: "flight-unscheduled-duplicated",
  other: "flight-unscheduled-other",
};

/** A time of a source as people at the airport read it: Brasília's said as such. */
function timeWords(time: WallTime, t: ReturnType<typeof useTranslations>): string {
  if (!time) return "?";
  return time.basis === "brasilia"
    ? t("flight-time-brasilia", { time: formatLocalTime(time.wall) })
    : formatLocalTime(time.wall);
}

/**
 * The trip: each leg as the ticket prints it, the one where the problem
 * happened marked, and the delay at arrival when both times are known (the
 * difference of two local times of the same airport: no time zone needed).
 * Under each leg, what ANAC's official record says of its flight, checked
 * by the backend by itself, and how the case's own times stand against it;
 * and, for a leg the record cannot answer yet (a flight of the last weeks,
 * a leg abroad), what FlightAware says, asked by a person.
 */
export default function TripCard({
  state,
  writable,
  onChanged,
}: {
  state: Ready;
  writable: boolean;
  onChanged: (saved?: boolean) => void;
}) {
  const t = useTranslations("product");
  const [editing, setEditing] = useState<CaseSegment | "new" | null>(null);
  // New legs start from the trip's document, which ONE reads (0085); typing one is the contingency, in that dialog.
  const [fromTicket, setFromTicket] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const remove = async (segment: CaseSegment) => {
    setBusy(segment.id);
    setProblem(null);
    const result = await removeFlightSegment(state.case.id, segment.id);
    setBusy(null);
    if (!result.ok) setProblem(result.code);
    else onChanged();
  };

  // The trip in one line, and whether the leg of the problem is marked: the rules read that leg.
  const legs = state.segments
    .map((segment) =>
      [segment.flight_number, [segment.origin_iata, segment.destination_iata].filter(Boolean).join(" → ")]
        .filter(Boolean)
        .join(" "),
    )
    .filter(Boolean);
  const affected = state.segments.find((segment) => segment.affected) ?? null;
  const affectedDelay = affected
    ? arrivalDelayMinutes(affected.scheduled_arrival_local, affected.actual_arrival_local)
    : null;
  const unmarked = beforeCourt(state.case.status) && state.segments.length > 0 && affected === null;
  // ONE marks the leg itself once ANAC's record answered for every leg (0228): until then it is ONE's to do.
  const checking = state.segments.some((segment) =>
    ["waiting", "not_published"].includes(state.flights.bySegment[segment.id]?.vra?.status ?? ""),
  );
  // ONE asking the record now is ONE at work; a month of the record not out yet is a wait of weeks, said as one.
  const asking = state.segments.some((segment) => state.flights.bySegment[segment.id]?.vra?.status === "waiting");
  const [marking, setMarking] = useState<string | null>(null);
  const mark = async (segment: CaseSegment, affectedNow: boolean) => {
    setMarking(segment.id);
    setProblem(null);
    const result = await saveFlightSegment(state.case.id, segment.id, { affected: affectedNow });
    setMarking(null);
    if (!result.ok) setProblem(result.code);
    else onChanged();
  };
  // What the record said of a leg, in a few words, for the person who says which leg it was.
  const legWords = (segment: CaseSegment): string => {
    const view = state.flights.bySegment[segment.id]?.vra ?? null;
    if (view?.status === "found") {
      if (view.cancelled) return t("case-trip-leg-cancelled");
      if (view.diverted) return t("case-trip-leg-diverted");
      const late = view.comparison?.arrivalDelayMinutes ?? null;
      if (late !== null)
        return late > 0 ? t("case-trip-leg-late", { delay: hoursAndMinutes(late) }) : t("case-trip-leg-ontime");
    }
    const own = arrivalDelayMinutes(segment.scheduled_arrival_local, segment.actual_arrival_local);
    return own !== null && own > 0
      ? t("case-trip-leg-late-own", { delay: hoursAndMinutes(own) })
      : t("case-trip-leg-unknown");
  };

  return (
    <CollapsibleCard
      id="case-trip"
      title={t("case-trip-title")}
      summary={
        state.segments.length === 0
          ? t("case-trip-empty-title")
          : [
              legs.join(", ") || t("case-trip-summary-legs", { count: state.segments.length }),
              affectedDelay !== null && affectedDelay > 0
                ? t("case-trip-delay", { delay: hoursAndMinutes(affectedDelay) })
                : null,
            ]
              .filter(Boolean)
              .join(" · ")
      }
      ask={
        unmarked
          ? asking
            ? { tone: "working", label: t("case-card-working-checking") }
            : checking
              ? { tone: "client", label: t("card-state-trip-working") }
              : { tone: "firm", label: t("card-state-trip-mark") }
          : null
      }
      description={t("case-trip-body")}
      add={
        writable && state.segments.length > 0
          ? { label: t("case-trip-add-legs"), onClick: () => setFromTicket(true) }
          : null
      }
      defaultOpen={opensOnArrival(state.case.status, "trip", unmarked, state.segments.length === 0)}
    >
      {problem && (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
          {t(caseErrorKey(problem))}
        </Alert>
      )}

      {state.segments.length === 0 && (
        <EmptyState
          titleAs="h3"
          layout="row"
          framed={false}
          illustration={<IllustrationLaunch />}
          title={t("case-trip-empty-title")}
          description={t("case-trip-empty-docs")}
          action={writable ? { label: t("case-trip-send-ticket"), onClick: () => setFromTicket(true) } : undefined}
          secondaryAction={writable ? { label: t("prefill-manual"), onClick: () => setEditing("new") } : undefined}
        />
      )}

      {unmarked && writable ? (
        // The question of the leg, with its answers beside it: one click on the leg (the owner, 2026-11-12).
        <Box className="flex flex-col gap-3">
          {/* ONE asks the client in the chat (0240): a wait, never the firm's task. */}
          <StateLine tone="waiting" emphasis>
            <strong>{t("case-trip-ask-title")}</strong> {checking ? t("case-trip-ask-waiting") : t("case-trip-ask-why")}
          </StateLine>
          <Box className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {state.segments.map((segment) => (
              <ButtonBase
                key={segment.id}
                disabled={marking !== null}
                onClick={() => void mark(segment, true)}
                className="border-grey-200 hover:border-grey-300 hover:bg-grey-25 focus-visible:bg-grey-25 flex flex-col items-start gap-0.5 rounded-xl border px-4 py-3 text-left transition-colors"
              >
                <Typography variant="body2" component="span" className="font-semibold">
                  {[segment.flight_number, [segment.origin_iata, segment.destination_iata].filter(Boolean).join(" → ")]
                    .filter(Boolean)
                    .join(" · ") || t("client-trip-leg", { position: segment.position })}
                </Typography>
                <Typography variant="caption" component="span" className="text-text-secondary">
                  {legWords(segment)}
                </Typography>
                <Typography variant="body2" component="span" className="text-text-primary pt-1 font-semibold underline">
                  {marking === segment.id ? t("case-trip-ask-marking") : t("case-trip-ask-pick")}
                </Typography>
              </ButtonBase>
            ))}
          </Box>
        </Box>
      ) : null}

      {state.segments.map((segment) => {
        const delay = arrivalDelayMinutes(segment.scheduled_arrival_local, segment.actual_arrival_local);
        const times = [
          segment.scheduled_departure_local
            ? t("case-trip-scheduled", {
                departure: formatLocalTime(segment.scheduled_departure_local),
                arrival: formatLocalTime(segment.scheduled_arrival_local) || "?",
              })
            : null,
          segment.actual_arrival_local
            ? t("case-trip-actual-arrival", { time: formatLocalTime(segment.actual_arrival_local) })
            : null,
        ].filter(Boolean);
        return (
          <Box key={segment.id} className="border-grey-100 flex flex-col gap-2 rounded-2xl border p-4">
            <Box className="flex flex-wrap items-start justify-between gap-2">
              <Box className="flex min-w-0 flex-col">
                <Typography variant="body1" className="font-semibold">
                  {[segment.flight_number, [segment.origin_iata, segment.destination_iata].filter(Boolean).join(" → ")]
                    .filter(Boolean)
                    .join(" · ") || t("client-trip-leg", { position: segment.position })}
                </Typography>
                {segment.booking_reference && (
                  <Typography variant="body2" className="text-text-secondary">
                    {t("case-trip-booking", { code: segment.booking_reference })}
                  </Typography>
                )}
              </Box>
              <Box className="flex flex-wrap items-center gap-2">
                {segment.affected && <StatusChip tone="attention" label={t("client-trip-affected")} />}
                {delay !== null && delay > 0 && (
                  <StatusChip tone="info" label={t("case-trip-delay", { delay: hoursAndMinutes(delay) })} />
                )}
                {writable ? (
                  <>
                    <Button variant="outlined" color="grey" size="small" onClick={() => setEditing(segment)}>
                      {t("case-trip-edit")}
                    </Button>
                    <QuickActions
                      label={t("case-trip-more", { flight: segment.flight_number ?? String(segment.position) })}
                      actions={[
                        {
                          key: "remove",
                          label: t("client-trip-remove"),
                          icon: <NiCrossSquare size="medium" />,
                          disabled: busy !== null,
                          onClick: () => void remove(segment),
                        },
                      ]}
                    />
                  </>
                ) : null}
              </Box>
            </Box>
            {times.map((line) => (
              <Typography key={line} variant="body2">
                {line}
              </Typography>
            ))}
            {segment.affected && segment.affected_by === "one" && beforeCourt(state.case.status) ? (
              // What ONE marked, said as ONE's and as something that may be wrong, with the way to undo it.
              <StateLine
                tone="done"
                action={
                  writable ? (
                    <Button
                      variant="text"
                      color="grey"
                      size="small"
                      disabled={marking !== null}
                      onClick={() => void mark(segment, false)}
                    >
                      {t("case-trip-marked-not-this")}
                    </Button>
                  ) : undefined
                }
              >
                {t("case-trip-marked-by-one")}
              </StateLine>
            ) : null}
            {segment.source === "client" && (
              <Typography variant="body2" className="text-text-secondary">
                {t("case-trip-by-client")}
              </Typography>
            )}
            <LegCheck
              caseId={state.case.id}
              segment={segment}
              checks={state.flights.bySegment[segment.id] ?? { vra: null, flightaware: null }}
              lookupAvailable={state.flights.lookupAvailable}
              writable={writable}
              onChanged={onChanged}
            />
          </Box>
        );
      })}

      {fromTicket && (
        <TicketDialog
          state={state}
          onManual={() => {
            setFromTicket(false);
            setEditing("new");
          }}
          onClose={() => setFromTicket(false)}
          onSaved={() => {
            setFromTicket(false);
            onChanged();
          }}
        />
      )}
      {editing && (
        <SegmentDialog
          caseId={state.case.id}
          segment={editing === "new" ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
    </CollapsibleCard>
  );
}

/**
 * What the sources said of one leg's flight. The official record speaks first; a private source is said
 * as such. What a person can do comes with each state: ask the record again, ask FlightAware, or take the
 * record's real times into the case.
 */
function LegCheck({
  caseId,
  segment,
  checks,
  lookupAvailable,
  writable,
  onChanged,
}: {
  caseId: string;
  segment: CaseSegment;
  checks: LegChecks;
  lookupAvailable: boolean;
  writable: boolean;
  onChanged: (saved?: boolean) => void;
}) {
  const t = useTranslations("product");
  const [busy, setBusy] = useState<"recheck" | "lookup" | "apply" | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const vra = checks.vra;
  const fa = checks.flightaware;
  const flight = segment.flight_number ?? "";

  const act = async (kind: "recheck" | "lookup" | "apply", work: () => Promise<{ ok: boolean; code: string }>) => {
    setBusy(kind);
    setProblem(null);
    try {
      const result = await work();
      if (!result.ok) setProblem(result.code);
      onChanged(result.ok);
    } catch {
      setProblem("failed");
    } finally {
      setBusy(null);
    }
  };

  // The record's real times, at each airport, may become the case's own when the case lacks them or differs.
  const realArrival = vra?.status === "found" ? vra.times?.actualArrival : null;
  const realDeparture = vra?.status === "found" ? vra.times?.actualDeparture : null;
  const mayApply =
    writable &&
    vra?.status === "found" &&
    vra.comparison?.agreement !== "cancelled" &&
    realArrival?.basis === "airport" &&
    (!segment.actual_arrival_local || vra.comparison?.actualArrivalDifference !== 0);
  const mayAskRecord = writable && vra !== null && ["not_found", "failed", "not_published"].includes(vra.status);
  const mayLookUp =
    writable &&
    lookupAvailable &&
    vra !== null &&
    vra.status !== "incomplete" &&
    // A flight the record has in full needs no private source; one that ends elsewhere still lacks its arrival.
    (vra.status !== "found" || vra.endsAt !== null) &&
    fa?.status !== "waiting";

  return (
    <Box className="border-grey-100 flex flex-col gap-2 border-t pt-2">
      {vra ? <RecordLines source="vra" view={vra} flight={flight} /> : null}
      {fa ? <RecordLines source="flightaware" view={fa} flight={flight} /> : null}
      {problem ? (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
          {t(flightErrorKey(problem))}
        </Alert>
      ) : null}
      {mayApply || mayAskRecord || mayLookUp ? (
        <Box className="flex flex-wrap gap-2">
          {mayApply ? (
            <Button
              variant="outlined"
              color="grey"
              size="small"
              disabled={busy !== null}
              onClick={() =>
                void act("apply", () =>
                  saveFlightSegment(caseId, segment.id, {
                    actual_arrival_local: realArrival?.wall ?? null,
                    ...(realDeparture?.basis === "airport" ? { actual_departure_local: realDeparture.wall } : {}),
                  }),
                )
              }
            >
              {t("flight-apply-record")}
            </Button>
          ) : null}
          {mayAskRecord ? (
            <Button
              variant="text"
              color="grey"
              size="small"
              disabled={busy !== null}
              onClick={() => void act("recheck", () => recheckFlight(caseId, segment.id))}
            >
              {t("flight-recheck")}
            </Button>
          ) : null}
          {mayLookUp ? (
            <Button
              variant="text"
              color="grey"
              size="small"
              disabled={busy !== null}
              onClick={() => void act("lookup", () => lookupFlight(caseId, segment.id))}
            >
              {busy === "lookup" ? t("flight-looking-up") : t("flight-lookup")}
            </Button>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}

/** What one source said of the leg's flight, in a few lines. */
function RecordLines({ source, view, flight }: { source: "vra" | "flightaware"; view: SourceView; flight: string }) {
  const t = useTranslations("product");
  const official = source === "vra";
  const month = view.month ? `${view.month.slice(5, 7)}/${view.month.slice(0, 4)}` : "";

  if (view.status !== "found" || !view.times || !view.comparison) {
    const key = official
      ? {
          waiting: "flight-record-waiting",
          incomplete: "flight-record-incomplete",
          not_published: "flight-record-not-published",
          not_found: "flight-record-not-found",
          failed: recordFailureKey(view.error),
          found: "flight-record-waiting",
        }[view.status]
      : {
          waiting: "flight-fa-waiting",
          incomplete: "flight-fa-failed",
          not_published: "flight-fa-failed",
          not_found: "flight-fa-not-found",
          failed: lookupFailureKey(view.error),
          found: "flight-fa-waiting",
        }[view.status];
    return (
      <Typography
        variant="body2"
        className="text-text-secondary"
        role={view.status === "waiting" ? "status" : undefined}
      >
        {t(key, { month, flight, when: view.checkedLabel ?? "" })}
      </Typography>
    );
  }

  const comparison = view.comparison;
  // A cancelled flight whose aircraft went on by legs no schedule foresaw is not only a cancellation.
  const chip =
    comparison.agreement === "cancelled" && view.unscheduled.length > 0
      ? { tone: AGREEMENT.cancelled.tone, key: "flight-record-cancelled-unscheduled" }
      : (AGREEMENT[comparison.agreement] ?? AGREEMENT.nothing_to_compare);
  const delay = comparison.arrivalDelayMinutes;
  const reachedDelay = comparison.reachedDestinationDelayMinutes;
  // A private source is said as such, and runway times as what they are.
  const privateNote = view.basis === "runway" ? "flight-fa-runway" : "flight-fa-private";
  const departureOnly = official ? "flight-record-departure-times" : "flight-fa-departure-times";
  const lines = [
    comparison.agreement === "cancelled"
      ? t(official ? "flight-record-says-cancelled" : "flight-fa-says-cancelled")
      : t(view.endsAt ? departureOnly : official ? "flight-record-times" : "flight-fa-times", {
          scheduledDeparture: timeWords(view.times.scheduledDeparture, t),
          actualDeparture: timeWords(view.times.actualDeparture, t),
          scheduledArrival: timeWords(view.times.scheduledArrival, t),
          actualArrival: timeWords(view.times.actualArrival, t),
        }),
    view.stops.length > 0 ? t("flight-stops", { stops: view.stops.join(", ") }) : null,
    ...view.cancelledLegs.map((leg) => t("flight-record-leg-cancelled", leg)),
    view.endsAt ? t("flight-ends-elsewhere", { airport: view.endsAt }) : null,
    view.justification ? t("flight-record-justification", { text: view.justification }) : null,
    delay !== null && delay > 0 ? t("flight-delay", { delay: hoursAndMinutes(delay) }) : null,
    view.operatedAs ? t("flight-operated-as", { flight: view.operatedAs }) : null,
    comparison.actualArrivalDifference !== null &&
    comparison.agreement === "differs" &&
    comparison.actualArrivalDifference !== 0
      ? t("flight-arrival-differs", { minutes: Math.abs(comparison.actualArrivalDifference) })
      : null,
    comparison.scheduledDepartureDifference !== null &&
    comparison.agreement === "differs" &&
    Math.abs(comparison.scheduledDepartureDifference) > 0
      ? t("flight-schedule-differs", { minutes: Math.abs(comparison.scheduledDepartureDifference) })
      : null,
    official ? null : t(privateNote, { when: view.checkedLabel ?? "" }),
  ].filter((line): line is string => Boolean(line));
  const unscheduled = view.unscheduled.map((leg) =>
    t("flight-unscheduled-leg", {
      kind: t(UNSCHEDULED_KEY[leg.kind] ?? UNSCHEDULED_KEY.other),
      origin: leg.origin,
      destination: leg.destination,
      departure: timeWords(leg.departure, t),
      arrival: timeWords(leg.arrival, t),
    }),
  );

  return (
    <Box className="flex flex-col gap-1">
      <Box className="flex flex-wrap items-center gap-2">
        <StatusChip tone={official ? chip.tone : "neutral"} label={official ? t(chip.key) : t("flight-fa-label")} />
        {official && view.month ? (
          <Typography variant="body2" className="text-text-secondary">
            {t("flight-record-month", { month })}
          </Typography>
        ) : null}
      </Box>
      {lines.map((line) => (
        <Typography key={line} variant="body2">
          {line}
        </Typography>
      ))}
      {unscheduled.length > 0 ? (
        <Box className="flex flex-col gap-1">
          <Typography variant="body2" className="text-text-secondary">
            {t("flight-unscheduled-title")}
          </Typography>
          <Box component="ul" className="m-0 flex flex-col gap-1 pl-5">
            {unscheduled.map((line) => (
              <Typography key={line} component="li" variant="body2">
                {line}
              </Typography>
            ))}
          </Box>
          {view.reachedDestination && reachedDelay !== null ? (
            <Typography variant="body2">
              {t("flight-reached-destination", {
                time: timeWords(view.reachedDestination, t),
                delay: hoursAndMinutes(Math.max(reachedDelay, 0)),
              })}
            </Typography>
          ) : null}
        </Box>
      ) : null}
    </Box>
  );
}

function SegmentDialog({
  caseId,
  segment,
  onClose,
  onSaved,
}: {
  caseId: string;
  segment: CaseSegment | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [values, setValues] = useState<SegmentValues>(segmentValues(segment));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ code: string; field?: string | null } | null>(null);

  const submit = async () => {
    setBusy(true);
    setProblem(null);
    const result = await saveFlightSegment(caseId, segment?.id ?? null, segmentFields(values));
    setBusy(false);
    if (!result.ok) {
      setProblem({ code: result.code, field: result.field });
      return;
    }
    onSaved();
  };

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="case-segment-dialog">
      <DialogHeader
        id="case-segment-dialog"
        title={segment ? t("case-trip-edit-title") : t("client-trip-add")}
        onClose={onClose}
        closeLabel={t("cases-close")}
      />
      <Box
        component="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <DialogContent>
          <Box className="flex flex-col gap-4 pt-1">
            <SegmentFields
              idPrefix={`case-segment-${segment?.id ?? "new"}`}
              values={values}
              onChange={setValues}
              errorField={problem?.field}
              errorText={problem ? t(caseErrorKey(problem.code)) : null}
              disabled={busy}
            />
            {problem && !problem.field && (
              <Alert severity="error" className="neutral bg-background-paper/60!">
                {t(caseErrorKey(problem.code))}
              </Alert>
            )}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("cases-cancel")}
          </Button>
          <Button type="submit" variant="contained" disabled={busy}>
            {busy ? t("cases-working") : t("cases-save")}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
