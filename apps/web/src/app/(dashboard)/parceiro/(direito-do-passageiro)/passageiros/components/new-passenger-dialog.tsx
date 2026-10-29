"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Dialog, DialogActions, DialogContent, Typography } from "@mui/material";

import PersonFields from "@/components/cases/person-fields";
import DialogHeader from "@/components/product/dialog-header";
import { emptyPerson, type PersonField, personFields, type PersonValues } from "@/lib/cases/forms";
import { savePassenger } from "@/modules/direito-do-passageiro/agency/actions";
import { paxErrorKey } from "@/modules/direito-do-passageiro/agency/passengers";

/** Who the passenger is, at the start: the rest comes from their documents, which ONE reads, or from them. */
const FIRST_FIELDS: readonly PersonField[] = ["full_name", "cpf", "birth_date", "phone", "email"];

/**
 * Adds a passenger to the partnership. Only the name is needed to start; the passenger's page opens right after,
 * where the documents, the trips and the link are one click away.
 */
export default function NewPassengerDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (travelerId: string) => void;
}) {
  const t = useTranslations("product");
  const [values, setValues] = useState<PersonValues>(emptyPerson);
  const [problem, setProblem] = useState<{ code: string; field?: string | null } | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setProblem(null);
    const result = await savePassenger({
      travelerId: null,
      fields: personFields(values, FIRST_FIELDS),
      guardianId: null,
    });
    setBusy(false);
    if (!result.ok) {
      setProblem({ code: result.code, field: result.field });
      return;
    }
    onCreated(result.travelerId);
  };

  const fieldProblem =
    problem?.field && (FIRST_FIELDS as readonly string[]).includes(problem.field) ? problem.field : null;

  return (
    <Dialog open onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth aria-labelledby="pax-new-dialog">
      <DialogHeader id="pax-new-dialog" title={t("pax-new-title")} onClose={onClose} closeLabel={t("pax-close")} />
      <Box
        component="form"
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <DialogContent>
          <Box className="flex flex-col gap-4">
            <PersonFields
              idPrefix="pax-new"
              values={values}
              shown={FIRST_FIELDS}
              onChange={setValues}
              errorField={fieldProblem}
              errorText={problem ? t(paxErrorKey(problem.code)) : null}
              disabled={busy}
            />
            <Typography variant="body2" className="text-text-secondary">
              {t("pax-new-help")}
            </Typography>
            {problem && !fieldProblem && <Alert severity="error">{t(paxErrorKey(problem.code))}</Alert>}
          </Box>
        </DialogContent>
        <DialogActions>
          <Button variant="text" color="grey" onClick={onClose} disabled={busy}>
            {t("pax-cancel")}
          </Button>
          <Button type="submit" variant="contained" disabled={busy || values.full_name.trim() === ""}>
            {busy ? t("pax-saving") : t("pax-new-save")}
          </Button>
        </DialogActions>
      </Box>
    </Dialog>
  );
}
