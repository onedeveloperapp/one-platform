"use client";

import { PassengerPicker } from "./passenger-picker";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { Alert, Box, Button, Card, CardContent, Typography } from "@mui/material";

import PersonFields from "@/components/cases/person-fields";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import { type PersonField, personFields, type PersonValues, personValues } from "@/lib/cases/forms";
import { savePassenger } from "@/modules/direito-do-passageiro/agency/actions";
import {
  PAX_ADULT_FORM,
  PAX_MINOR_FORM,
  type PaxDetail,
  paxErrorKey,
  type PaxPerson,
  paxPersonData,
} from "@/modules/direito-do-passageiro/agency/passengers";
import { isMinorOn } from "@flyee/rules/person";

/**
 * The passenger's record: an adult with contacts and address, a child by who they are and the adult of the
 * partnership who answers for them. A field ONE read from a document says so under it until somebody writes it;
 * only what changed is sent, so a save never takes that mark from a field nobody touched. Another WhatsApp for a
 * passenger whose yes covers their trips is confirmed first (the owner, 2026-11-03): an agreement covers the
 * WhatsApp it was given at, so ONE stops following their trips until they agree again at the new one. A passenger
 * whose trip became a case is kept up to date here for their next trips (0106); what the firm received with the
 * case is the firm's, and a change here does not reach it.
 */
export default function PersonCard({
  detail,
  today,
  onSaved,
}: {
  detail: PaxDetail;
  today: string;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const traveler = detail.traveler;
  const initial = useMemo(() => personValues(paxPersonData(traveler)), [traveler]);
  const [values, setValues] = useState<PersonValues>(initial);
  const [guardian, setGuardian] = useState<PaxPerson | null>(detail.guardian);
  const [problem, setProblem] = useState<{ code: string; field?: string | null } | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmingPhone, setConfirmingPhone] = useState(false);
  // A child is told by the birth date as it is typed, so who answers for them is asked at once.
  const minor = isMinorOn(values.birth_date || null, today) === true;
  const shown = minor ? PAX_MINOR_FORM : PAX_ADULT_FORM;
  const read = useMemo(() => new Set<PersonField>(traveler.readFields), [traveler.readFields]);

  const changed = personFields(values, shown, initial);
  const guardianChanged = (guardian?.id ?? null) !== (detail.guardian?.id ?? null);
  const dirty = Object.keys(changed).length > 0 || guardianChanged;
  // The passenger's own yes covers their trips now: another WhatsApp ends that until they agree again at it.
  const phoneEndsFollowing =
    "phone" in changed && !minor && detail.consent === "agreed" && detail.reagree === null && !traveler.guardianId;

  const submit = async (): Promise<string | null> => {
    setBusy(true);
    setProblem(null);
    setSaved(false);
    const result = await savePassenger({
      travelerId: traveler.id,
      fields: changed,
      guardianId: minor ? (guardian?.id ?? null) : null,
    });
    setBusy(false);
    if (!result.ok) {
      setProblem({ code: result.code, field: result.field });
      return t(paxErrorKey(result.code));
    }
    setSaved(true);
    onSaved();
    return null;
  };

  const fieldProblem = problem?.field && (shown as readonly string[]).includes(problem.field) ? problem.field : null;

  return (
    <Card component="section" aria-labelledby="pax-person-title" className="h-full">
      <CardContent className="flex flex-col gap-4">
        <Box className="flex flex-col gap-1">
          <Typography id="pax-person-title" variant="h5" component="h2" className="mb-0">
            {t("pax-person-title")}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {minor ? t("pax-person-minor-help") : t("pax-person-help")}
          </Typography>
        </Box>
        <Box
          component="form"
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!dirty || busy) return;
            if (phoneEndsFollowing) setConfirmingPhone(true);
            else void submit();
          }}
        >
          <PersonFields
            idPrefix="pax-person"
            values={values}
            shown={shown}
            onChange={(next) => {
              setValues(next);
              setSaved(false);
            }}
            errorField={fieldProblem}
            errorText={problem ? t(paxErrorKey(problem.code)) : null}
            disabled={busy}
            read={read}
          />
          {minor && (
            <PassengerPicker
              id="pax-person-guardian"
              label={t("pax-person-guardian")}
              helperText={problem?.field === "guardian" ? t(paxErrorKey(problem.code)) : t("pax-person-guardian-help")}
              error={problem?.field === "guardian"}
              value={guardian}
              exclude={[traveler.id]}
              adultsOnly
              disabled={busy}
              onChange={(next) => {
                setGuardian(next);
                setSaved(false);
              }}
            />
          )}
          {problem && !fieldProblem && problem.field !== "guardian" && (
            <Alert severity="error">{t(paxErrorKey(problem.code))}</Alert>
          )}
          {saved && !dirty && (
            <Alert severity="success" className="neutral bg-background-paper/60!">
              {t("pax-person-saved")}
            </Alert>
          )}
          <Box className="flex justify-end">
            <Button type="submit" variant="contained" disabled={busy || !dirty}>
              {busy ? t("pax-saving") : t("pax-person-save")}
            </Button>
          </Box>
        </Box>
      </CardContent>
      {confirmingPhone && (
        <ConfirmActionDialog
          title={t("pax-phone-change-title", { name: traveler.fullName })}
          consequences={[
            t("pax-phone-change-stops", { name: traveler.fullName }),
            t("pax-phone-change-again", { name: traveler.fullName }),
          ]}
          staysTitle={t("pax-phone-change-stays-title")}
          stays={[t("pax-phone-change-stays-record"), t("pax-phone-change-stays-back")]}
          requireReason={false}
          confirmLabel={t("pax-phone-change-confirm")}
          cancelLabel={t("pax-phone-change-keep")}
          busyLabel={t("pax-saving")}
          tone="warning"
          onConfirm={async () => {
            const failed = await submit();
            if (!failed) setConfirmingPhone(false);
            return failed;
          }}
          onClose={() => setConfirmingPhone(false)}
        />
      )}
    </Card>
  );
}
