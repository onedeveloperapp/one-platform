"use client";

import type { CaseState } from "../case-types";
import { useTranslations } from "next-intl";
import { useState } from "react";

import {
  Alert,
  Box,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  FormControlLabel,
  Radio,
  RadioGroup,
  Typography,
} from "@mui/material";

import DocumentSlot, { type SlotState } from "@/components/cases/document-slot";
import DialogHeader from "@/components/product/dialog-header";
import { TILE_TONE } from "@/components/product/tile-tone";
import NiKeyboard from "@/icons/nexture/ni-keyboard";
import NiTicket from "@/icons/nexture/ni-ticket";
import { finishCaseUpload, saveFlightSegment } from "@/lib/cases/actions";
import { caseErrorKey, formatLocalTime } from "@/lib/cases/cases";
import { documentReadingOf, legComplete, prefillErrorKey, type PrefillLeg } from "@/lib/cases/document-prefill";
import { dropUnsaved, sendForReading } from "@/lib/cases/prefill-browser";

type Ready = Extract<CaseState, { kind: "ready" }>;

/**
 * The legs of a case's trip from its document (migration 0085): the ticket, the boarding pass, a screenshot of the
 * booking or a photo of a printed one. ONE reads the flights; the person confirms which go in and says in which the
 * problem happened (a choice no document holds), and the document joins the case as its ticket, where its check runs
 * as on any other (an accepted ticket adds no leg the case already has). Typing a leg is the contingency.
 */
export default function TicketDialog({
  state,
  onManual,
  onClose,
  onSaved,
}: {
  state: Ready;
  /** The person types the leg instead. */
  onManual: () => void;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [slot, setSlot] = useState<SlotState>({ kind: "empty" });
  const [file, setFile] = useState<{ id: string | null; name: string } | null>(null);
  const [legs, setLegs] = useState<PrefillLeg[]>([]);
  const [chosen, setChosen] = useState<ReadonlySet<number>>(new Set());
  const [affected, setAffected] = useState<string>("unknown");
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState<string[]>([]);

  const send = async (picked: File) => {
    const before = file?.id ?? null;
    setFile({ id: null, name: picked.name });
    setSlot({ kind: "reading" });
    setLegs([]);
    setFailures([]);
    const sent = await sendForReading(picked, "ticket");
    if (before) dropUnsaved([before]);
    setFile({ id: sent.fileId, name: picked.name });
    if (!sent.ok) {
      setSlot({ kind: "failed", sentence: t(prefillErrorKey(sent.code)) });
      return;
    }
    const reading = documentReadingOf(sent.output, state.today);
    const read = reading.legs;
    setLegs(read);
    setChosen(new Set(read.flatMap((leg, index) => (legComplete(leg) ? [index] : []))));
    setAffected(read.length === 1 ? "0" : "unknown");
    const sentence =
      read.length === 0
        ? [t("case-trip-ticket-none"), reading.note].filter(Boolean).join(" ")
        : [t("prefill-read-ok", { identified: reading.identified || t("case-trip-ticket-kind") }), reading.note]
            .filter(Boolean)
            .join(" ");
    setSlot({ kind: "read", tone: read.some(legComplete) ? "positive" : "attention", sentence });
  };

  const close = () => {
    dropUnsaved([file?.id]);
    onClose();
  };

  const save = async () => {
    setBusy(true);
    const failed: string[] = [];
    let saved = 0;
    for (const [index, leg] of legs.entries()) {
      if (!chosen.has(index)) continue;
      const result = await saveFlightSegment(state.case.id, null, {
        ...leg,
        booking_reference: leg.booking_reference || null,
        actual_departure_local: null,
        actual_arrival_local: null,
        affected: affected === String(index),
      });
      if (result.ok) saved += 1;
      else
        failed.push(
          t("case-trip-ticket-leg-failed", { flight: leg.flight_number, reason: t(caseErrorKey(result.code)) }),
        );
    }
    // The document the legs came from joins the case as its ticket, also when a leg had to be typed after.
    if (file?.id) {
      const joined = await finishCaseUpload({ caseId: state.case.id, fileId: file.id, kind: "ticket", partyId: null });
      if (!joined.ok) dropUnsaved([file.id]);
    }
    setBusy(false);
    if (failed.length > 0) {
      setFailures(failed);
      setFile(null);
      setChosen(new Set());
      if (saved > 0) onSaved();
      return;
    }
    onSaved();
  };

  const reading = slot.kind === "reading";
  const legWords = (leg: PrefillLeg) =>
    t("case-trip-ticket-leg", {
      flight: leg.flight_number || "?",
      from: leg.origin_iata || "?",
      to: leg.destination_iata || "?",
      departure: leg.scheduled_departure_local ? formatLocalTime(leg.scheduled_departure_local) : "?",
    });

  return (
    <Dialog
      open
      onClose={busy || reading ? undefined : close}
      maxWidth="sm"
      fullWidth
      aria-labelledby="case-ticket-dialog"
    >
      <DialogHeader
        id="case-ticket-dialog"
        title={t("case-trip-ticket-title")}
        onClose={close}
        closeLabel={t("cases-close")}
      />
      <DialogContent>
        <Box className="flex flex-col gap-4">
          <Typography variant="body2" className="text-text-secondary">
            {t("case-trip-ticket-intro")}
          </Typography>
          <Box component="ul" className="m-0 flex list-none flex-col gap-3 p-0">
            <DocumentSlot
              id="case-ticket-doc"
              icon={<NiTicket size="medium" className={TILE_TONE.primary.text} />}
              title={t("case-trip-ticket-slot")}
              hint={t("case-trip-ticket-slot-hint")}
              state={slot}
              fileName={file?.name}
              primary
              disabled={busy}
              labels={{
                send: t("prefill-send"),
                again: t("prefill-again"),
                sending: t("prefill-sending"),
                reading: t("prefill-reading"),
                read: t("prefill-read"),
                failed: t("prefill-failed"),
              }}
              onFile={(picked) => void send(picked)}
            />
          </Box>

          {legs.length > 0 && (
            <Box className="flex flex-col gap-2">
              <Alert severity="info" className="neutral">
                {t("case-trip-ticket-confirm")}
              </Alert>
              <Typography variant="subtitle2" component="h3" className="mb-0">
                {t("case-trip-ticket-legs")}
              </Typography>
              <Box component="ul" className="m-0 flex list-none flex-col gap-1 p-0">
                {legs.map((leg, index) => (
                  <Box component="li" key={index} className="flex flex-col">
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={chosen.has(index)}
                          disabled={busy || !legComplete(leg)}
                          onChange={(event) =>
                            setChosen((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.add(index);
                              else next.delete(index);
                              return next;
                            })
                          }
                        />
                      }
                      label={legWords(leg)}
                    />
                    {!legComplete(leg) && (
                      <Typography variant="body2" className="text-text-secondary pl-8">
                        {t("case-trip-ticket-leg-missing")}
                      </Typography>
                    )}
                  </Box>
                ))}
              </Box>
              {legs.some(legComplete) && (
                <Box className="flex flex-col gap-1">
                  <Typography variant="subtitle2" component="h3" id="case-ticket-affected" className="mb-0">
                    {t("case-trip-ticket-affected")}
                  </Typography>
                  <RadioGroup
                    aria-labelledby="case-ticket-affected"
                    value={affected}
                    onChange={(event) => setAffected(event.target.value)}
                  >
                    {legs.map((leg, index) =>
                      legComplete(leg) ? (
                        <FormControlLabel
                          key={index}
                          value={String(index)}
                          control={<Radio size="small" />}
                          label={legWords(leg)}
                          disabled={busy || !chosen.has(index)}
                        />
                      ) : null,
                    )}
                    <FormControlLabel
                      value="unknown"
                      control={<Radio size="small" />}
                      label={t("case-trip-ticket-affected-unknown")}
                      disabled={busy}
                    />
                  </RadioGroup>
                </Box>
              )}
            </Box>
          )}

          {failures.length > 0 && (
            <Alert severity="warning">
              {failures.map((failure) => (
                <Box key={failure}>{failure}</Box>
              ))}
            </Alert>
          )}
        </Box>
      </DialogContent>
      <DialogActions className="flex-wrap justify-between gap-2">
        <Button
          variant="text"
          color="grey"
          startIcon={<NiKeyboard size="small" />}
          disabled={busy || reading}
          onClick={async () => {
            // The document sent stays with the case as its ticket: its check reads it as any other.
            if (file?.id) {
              setBusy(true);
              const joined = await finishCaseUpload({
                caseId: state.case.id,
                fileId: file.id,
                kind: "ticket",
                partyId: null,
              });
              if (!joined.ok) dropUnsaved([file.id]);
              setBusy(false);
            }
            onManual();
          }}
        >
          {t("prefill-manual")}
        </Button>
        <Box className="flex gap-2">
          <Button variant="text" color="grey" onClick={close} disabled={busy || reading}>
            {failures.length > 0 ? t("cases-close") : t("cases-cancel")}
          </Button>
          <Button variant="contained" disabled={busy || reading || chosen.size === 0} onClick={() => void save()}>
            {busy ? t("cases-working") : t("case-trip-ticket-save", { count: chosen.size })}
          </Button>
        </Box>
      </DialogActions>
    </Dialog>
  );
}
