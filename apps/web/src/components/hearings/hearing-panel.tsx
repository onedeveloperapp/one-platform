"use client";

import { useTranslations } from "next-intl";
import { type ReactNode, useEffect, useState } from "react";

import {
  Alert,
  Box,
  Button,
  FormControlLabel,
  ListSubheader,
  MenuItem,
  Radio,
  RadioGroup,
  TextField,
  Typography,
} from "@mui/material";

import { PhoneField } from "@/components/product/fields";
import SidePanel from "@/components/product/side-panel";
import NiCalendar from "@/icons/nexture/ni-calendar";
import { saveHearing } from "@/lib/hearings/actions";
import { type HearingContact, hearingContacts } from "@/lib/hearings/contacts";
import type { Colleague, HearingRow } from "@/lib/hearings/facts";
import {
  type CourtZones,
  HEARING_KINDS,
  HEARING_MODES,
  HEARING_ZONES,
  hearingErrorKey,
  type HearingKind,
  type HearingMode,
  isHearingField,
  isHearingZone,
  KIND_KEY,
  MODE_KEY,
  momentIn,
  startingZone,
  ZONE_KEY,
} from "@/lib/hearings/hearings";
import { formatPhoneBr, isValidPhoneBr } from "@flyee/fields";

/** A new hearing's lawsuit, and the publication of it the person came from. */
export type HearingSubject = {
  proceedingId: string;
  /** The lawsuit as the dialog names it: "Juizado · 5000123-60.2099.8.09.0051". */
  lawsuitLabel: string;
  publicationId?: string | null;
  /** The zones of the lawsuit's court: its seat's, and the ones some of its comarcas keep. */
  zones?: CourtZones | null;
};

/** A colleague who attends, somebody from outside the firm, or nobody yet. */
const OTHER = "outra";
const NOBODY = "";
/** An attendee from outside of the firm's list (0251), by its id. */
const CONTACT = "contato:";

/** A WhatsApp as the list shows it: the number without the country's 55, masked. */
const phoneWords = (digits: string): string => formatPhoneBr(digits.startsWith("55") ? digits.slice(2) : digits);

/**
 * Where a person writes a hearing: what it is, the day and the time as the
 * court says them and the zone they are in (the court's, started on when it
 * is the court's only one; said by the person when some of its comarcas keep
 * another), how it happens, where or by which link, and who attends.
 * Changing one still to happen is the same form. The firm's calendar takes
 * the change by itself.
 *
 * It opens in the panel at the side of the page (`SidePanel`, the screen pattern of 2026-11-07), as the form of a
 * deadline does (`components/deadlines/deadline-panel.tsx`). Opened from the "Adicionar" of the top, it has no
 * lawsuit yet: `lead` asks for the case and the lawsuit first, and the fields show once there is one.
 */
export default function HearingPanel({
  subject,
  editing,
  colleagues,
  lead,
  panelTitle,
  onClose,
  onSaved,
}: {
  subject?: HearingSubject;
  editing?: HearingRow;
  colleagues: readonly Colleague[];
  /** What comes before the fields: the choice of the case and the lawsuit, when the panel opened with none. */
  lead?: ReactNode;
  /** The panel's name, when the entry that opened it calls it otherwise ("Nova audiência" in the "Adicionar"). */
  panelTitle?: string;
  onClose: () => void;
  onSaved: (code: string) => void;
}) {
  const t = useTranslations("product");
  const was = editing ? momentIn(editing.startsAt, editing.timeZone) : null;
  const courtZones = subject?.zones ?? null;
  const several = Boolean(courtZones && courtZones.others.length > 0);
  // The court's own zones first, then the rest of the country's.
  const zoneChoices = courtZones
    ? [
        ...[courtZones.seat, ...courtZones.others].filter(isHearingZone),
        ...HEARING_ZONES.filter((option) => option !== courtZones.seat && !courtZones.others.includes(option)),
      ]
    : [...HEARING_ZONES];
  const [kind, setKind] = useState<HearingKind>(editing?.kind ?? "conciliacao");
  const [mode, setMode] = useState<HearingMode>(editing?.mode ?? "videoconferencia");
  const [day, setDay] = useState(was?.isoDay ?? "");
  const [time, setTime] = useState(was?.isoTime ?? "");
  const [zone, setZone] = useState<string>(editing?.timeZone ?? startingZone(courtZones));
  // A lawsuit chosen after the panel opened (the "Adicionar" of the top) brings its court's zone.
  const zonesKey = courtZones ? [courtZones.seat, ...courtZones.others].join("|") : "";
  const [zonesSeen, setZonesSeen] = useState(zonesKey);
  if (!editing && zonesKey !== zonesSeen) {
    setZonesSeen(zonesKey);
    setZone(startingZone(courtZones));
  }
  const zoneHelpKey = several && !editing ? "hearing-field-zone-several" : "hearing-field-zone-help";
  const [place, setPlace] = useState(editing?.place ?? "");
  const [link, setLink] = useState(editing?.link ?? "");
  const [attendee, setAttendee] = useState<string>(
    editing?.attendeeUserId ??
      (editing?.attendeeContactId ? `${CONTACT}${editing.attendeeContactId}` : editing?.attendee ? OTHER : NOBODY),
  );
  // The firm's attendees from outside (0251), read as the panel opens; a read that fails offers only "Outra pessoa".
  const [contacts, setContacts] = useState<HearingContact[]>([]);
  useEffect(() => {
    let alive = true;
    void hearingContacts()
      .then((read) => {
        if (alive && read.ok) setContacts(read.contacts);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);
  const chosenContact = attendee.startsWith(CONTACT)
    ? (contacts.find((contact) => `${CONTACT}${contact.id}` === attendee) ?? null)
    : null;
  // Somebody from outside written anew gives their WhatsApp, by which ONE sends the guide and knows the report; a
  // hearing written before with a name and no WhatsApp keeps it so.
  const keepsOldPhone = Boolean(editing && !editing.attendeeUserId && !editing.attendeeContactId && editing.attendee);
  const [attendeeName, setAttendeeName] = useState(editing && !editing.attendeeUserId ? (editing.attendee ?? "") : "");
  const [attendeePhone, setAttendeePhone] = useState("");
  const [notes, setNotes] = useState(editing?.notes ?? "");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ code: string; field: string | null } | null>(null);

  const dayValid = /^\d{4}-\d{2}-\d{2}$/.test(day);
  const timeValid = /^([01]\d|2[0-3]):[0-5]\d$/.test(time);
  const showsPlace = mode !== "videoconferencia";
  const showsLink = mode !== "presencial";
  // Opened with no lawsuit (the "Adicionar" of the top): nothing is sent until one is chosen.
  const waiting = !editing && !subject;

  const submit = async () => {
    if (waiting) return;
    if (!dayValid || !timeValid) {
      setProblem({ code: "invalid_data", field: dayValid ? "time" : "day" });
      return;
    }
    if (!zone) {
      setProblem({ code: "zone_required", field: "time_zone" });
      return;
    }
    if (attendee === OTHER && !keepsOldPhone && !isValidPhoneBr(attendeePhone)) {
      setProblem({ code: attendeePhone ? "invalid_phone" : "phone_required", field: "attendee_phone" });
      return;
    }
    setBusy(true);
    setProblem(null);
    try {
      const result = await saveHearing({
        hearingId: editing?.id ?? null,
        proceedingId: editing ? null : (subject?.proceedingId ?? null),
        kind,
        mode,
        day,
        time,
        timeZone: zone,
        place: showsPlace ? place : null,
        link: showsLink ? link : null,
        attendeeUserId: attendee && attendee !== OTHER && !attendee.startsWith(CONTACT) ? attendee : null,
        // An attendee of the list taken out of it since stays on the hearing as it was.
        attendeeName: chosenContact
          ? chosenContact.name
          : attendee === OTHER
            ? attendeeName
            : attendee.startsWith(CONTACT)
              ? (editing?.attendee ?? null)
              : null,
        attendeePhone: chosenContact ? chosenContact.phone : attendee === OTHER ? attendeePhone : null,
        notes,
        publicationId: editing ? null : (subject?.publicationId ?? null),
      });
      if (!result.ok) {
        setProblem({ code: result.code, field: isHearingField(result.field) ? result.field : null });
        return;
      }
      onSaved(result.code);
    } catch {
      setProblem({ code: "failed", field: null });
    } finally {
      setBusy(false);
    }
  };

  const fieldError = (field: string) => (problem?.field === field ? t(hearingErrorKey(problem.code)) : undefined);
  const shownFields = new Set(["day", "time", "place", "link", "attendee_name", "attendee_phone", "time_zone"]);

  return (
    <SidePanel
      onClose={onClose}
      closeLabel={t("hearing-close")}
      title={panelTitle ?? t(editing ? "hearing-dialog-edit-title" : "hearing-dialog-title")}
      description={
        editing
          ? t("hearing-dialog-edit-intro")
          : subject
            ? t("hearing-dialog-intro", { lawsuit: subject.lawsuitLabel })
            : t("hearing-panel-intro")
      }
      icon={<NiCalendar size="medium" />}
      tone="accent-4"
      busy={busy}
      onSubmit={() => void submit()}
      actions={
        <>
          <Button type="submit" variant="contained" disabled={busy || waiting}>
            {t(editing ? "hearing-submit-edit" : "hearing-submit")}
          </Button>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("hearing-cancel")}
          </Button>
        </>
      }
    >
      {lead}
      {waiting ? null : (
        <Box className="flex flex-col gap-3">
          <TextField
            select
            fullWidth
            size="small"
            id="hearing-kind"
            label={t("hearing-field-kind")}
            value={kind}
            disabled={busy}
            onChange={(event) => setKind(event.target.value as HearingKind)}
          >
            {HEARING_KINDS.map((option) => (
              <MenuItem key={option} value={option}>
                {t(KIND_KEY[option])}
              </MenuItem>
            ))}
          </TextField>
          <Box className="flex gap-2">
            <TextField
              size="small"
              type="date"
              id="hearing-day"
              label={t("hearing-field-day")}
              value={day}
              disabled={busy}
              onChange={(event) => setDay(event.target.value)}
              error={Boolean(fieldError("day"))}
              helperText={fieldError("day")}
              slotProps={{ inputLabel: { shrink: true } }}
              className="min-w-0 flex-1"
            />
            <TextField
              size="small"
              type="time"
              id="hearing-time"
              label={t("hearing-field-time")}
              value={time}
              disabled={busy}
              onChange={(event) => setTime(event.target.value)}
              error={Boolean(fieldError("time"))}
              helperText={fieldError("time")}
              slotProps={{ inputLabel: { shrink: true } }}
              className="w-36"
            />
          </Box>
          <TextField
            select
            fullWidth
            size="small"
            id="hearing-zone"
            label={t("hearing-field-zone")}
            value={zone}
            disabled={busy}
            onChange={(event) => setZone(event.target.value)}
            error={Boolean(fieldError("time_zone"))}
            helperText={fieldError("time_zone") ?? t(zoneHelpKey)}
            slotProps={{ select: { displayEmpty: true }, inputLabel: { shrink: true } }}
          >
            <MenuItem value="" disabled>
              {t("hearing-zone-choose")}
            </MenuItem>
            {zoneChoices.map((option) => (
              <MenuItem key={option} value={option}>
                {t(ZONE_KEY[option])}
              </MenuItem>
            ))}
          </TextField>
          <Box className="flex flex-col gap-1">
            <Typography id="hearing-mode" variant="body2" className="font-semibold">
              {t("hearing-field-mode")}
            </Typography>
            <RadioGroup
              aria-labelledby="hearing-mode"
              value={mode}
              onChange={(event) => setMode(event.target.value as HearingMode)}
            >
              {HEARING_MODES.map((option) => (
                <FormControlLabel
                  key={option}
                  value={option}
                  disabled={busy}
                  control={<Radio size="small" />}
                  label={t(MODE_KEY[option])}
                />
              ))}
            </RadioGroup>
          </Box>
          {showsPlace ? (
            <TextField
              fullWidth
              size="small"
              id="hearing-place"
              label={t("hearing-field-place")}
              value={place}
              disabled={busy}
              onChange={(event) => setPlace(event.target.value.slice(0, 300))}
              error={Boolean(fieldError("place"))}
              helperText={fieldError("place")}
            />
          ) : null}
          {showsLink ? (
            <TextField
              fullWidth
              size="small"
              id="hearing-link"
              label={t("hearing-field-link")}
              value={link}
              disabled={busy}
              onChange={(event) => setLink(event.target.value.slice(0, 500))}
              error={Boolean(fieldError("link"))}
              helperText={fieldError("link") ?? t("hearing-field-link-help")}
              slotProps={{ htmlInput: { inputMode: "url", autoComplete: "off" } }}
            />
          ) : null}
          <TextField
            select
            fullWidth
            size="small"
            id="hearing-attendee"
            label={t("hearing-field-attendee")}
            value={attendee}
            disabled={busy}
            onChange={(event) => setAttendee(event.target.value)}
          >
            <MenuItem value={NOBODY}>{t("hearing-attendee-nobody")}</MenuItem>
            {colleagues.map((person) => (
              <MenuItem key={person.id} value={person.id}>
                {person.name}
              </MenuItem>
            ))}
            {contacts.length > 0 ? <ListSubheader>{t("hearing-attendee-contacts")}</ListSubheader> : null}
            {contacts.map((contact) => (
              <MenuItem key={contact.id} value={`${CONTACT}${contact.id}`}>
                {t("hearing-attendee-contact", { name: contact.name, phone: phoneWords(contact.phone) })}
              </MenuItem>
            ))}
            {/* The attendee of a hearing written before, from outside, not in the list (yet): still a choice. */}
            {attendee.startsWith(CONTACT) && !chosenContact && editing?.attendee ? (
              <MenuItem value={attendee}>{editing.attendee}</MenuItem>
            ) : null}
            <MenuItem value={OTHER}>{t("hearing-attendee-other")}</MenuItem>
          </TextField>
          {attendee === OTHER ? (
            <TextField
              fullWidth
              size="small"
              id="hearing-attendee-name"
              label={t("hearing-field-attendee-name")}
              value={attendeeName}
              disabled={busy}
              onChange={(event) => setAttendeeName(event.target.value.slice(0, 120))}
              error={Boolean(fieldError("attendee_name"))}
              helperText={fieldError("attendee_name")}
            />
          ) : null}
          {attendee === OTHER ? (
            <PhoneField
              fullWidth
              size="small"
              id="hearing-attendee-phone"
              label={t("hearing-field-attendee-phone")}
              value={attendeePhone}
              disabled={busy}
              onChange={(event) => setAttendeePhone(event.target.value)}
              error={Boolean(fieldError("attendee_phone"))}
              helperText={
                fieldError("attendee_phone") ??
                t(keepsOldPhone ? "hearing-field-attendee-phone-keep" : "hearing-field-attendee-phone-help")
              }
            />
          ) : null}
          <TextField
            fullWidth
            size="small"
            id="hearing-notes"
            label={t("hearing-field-notes")}
            value={notes}
            disabled={busy}
            multiline
            minRows={2}
            onChange={(event) => setNotes(event.target.value.slice(0, 1000))}
          />
        </Box>
      )}
      {problem && (!problem.field || !shownFields.has(problem.field)) ? (
        <Alert severity="error" className="neutral bg-background-paper/60!">
          {t(hearingErrorKey(problem.code))}
        </Alert>
      ) : null}
    </SidePanel>
  );
}
