"use client";

import { PassengerPicker } from "./passenger-picker";
import { useTranslations } from "next-intl";
import { useMemo, useState } from "react";

import { Alert, Box, Button, Card, CardContent, Typography } from "@mui/material";

import PersonFields from "@/components/cases/person-fields";
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
 * only what changed is sent, so a save never takes that mark from a field nobody touched.
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
  // A child is told by the birth date as it is typed, so who answers for them is asked at once.
  const minor = isMinorOn(values.birth_date || null, today) === true;
  const shown = minor ? PAX_MINOR_FORM : PAX_ADULT_FORM;
  const read = useMemo(() => new Set<PersonField>(traveler.readFields), [traveler.readFields]);
  const locked = traveler.handedOver;

  const changed = personFields(values, shown, initial);
  const guardianChanged = (guardian?.id ?? null) !== (detail.guardian?.id ?? null);
  const dirty = Object.keys(changed).length > 0 || guardianChanged;

  const submit = async () => {
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
      return;
    }
    setSaved(true);
    onSaved();
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
            if (dirty && !busy && !locked) void submit();
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
            disabled={busy || locked}
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
              disabled={busy || locked}
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
          {!locked && (
            <Box className="flex justify-end">
              <Button type="submit" variant="contained" disabled={busy || !dirty}>
                {busy ? t("pax-saving") : t("pax-person-save")}
              </Button>
            </Box>
          )}
        </Box>
      </CardContent>
    </Card>
  );
}
