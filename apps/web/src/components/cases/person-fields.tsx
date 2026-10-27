"use client";

import { useTranslations } from "next-intl";

import { Grid, MenuItem, TextField } from "@mui/material";

import { CepField, CpfField, PhoneField } from "@/components/product/fields";
import { MARITAL_KEY, MARITAL_STATUSES, PERSON_FIELD_KEY, UFS } from "@/lib/cases/cases";
import type { PersonField, PersonValues } from "@/lib/cases/forms";

/**
 * The fields of a person of a case, as the firm and the client fill them
 * (the client's link and the case screen share it). What is shown depends on
 * who the person is: an adult is named in a power of attorney (address,
 * marital status, profession); a minor only by who they are. The database
 * checks every value again (`apply_person_fields`, migration 0022).
 */

export default function PersonFields({
  idPrefix,
  values,
  shown,
  onChange,
  errorField,
  errorText,
  disabled,
  read,
}: {
  idPrefix: string;
  values: PersonValues;
  shown: readonly PersonField[];
  onChange: (next: PersonValues) => void;
  /** The field the database refused, with the words for why. */
  errorField?: string | null;
  errorText?: string | null;
  disabled?: boolean;
  /** The fields ONE read from a document (migration 0063), said under each while what is there is still the document's. */
  read?: ReadonlySet<PersonField>;
}) {
  const t = useTranslations("product");
  const has = (field: PersonField) => shown.includes(field);
  const set = (field: PersonField, value: string) => onChange({ ...values, [field]: value });
  const errorOf = (field: PersonField) => (errorField === field ? (errorText ?? undefined) : undefined);
  const common = (field: PersonField) => ({
    id: `${idPrefix}-${field}`,
    name: field,
    label: t(PERSON_FIELD_KEY[field]),
    value: values[field],
    fullWidth: true,
    size: "small" as const,
    disabled,
    error: Boolean(errorOf(field)),
    helperText: errorOf(field) ?? (read?.has(field) ? t("person-field-read") : undefined),
  });

  return (
    <Grid container spacing={2}>
      {has("full_name") && (
        <Grid size={12}>
          <TextField
            {...common("full_name")}
            autoComplete="name"
            onChange={(event) => set("full_name", event.target.value)}
          />
        </Grid>
      )}
      {has("cpf") && (
        <Grid size={{ xs: 12, sm: 6 }}>
          <CpfField
            {...common("cpf")}
            invalidMessage={t("case-error-cpf")}
            onChange={(event) => set("cpf", event.target.value)}
          />
        </Grid>
      )}
      {has("birth_date") && (
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            {...common("birth_date")}
            type="date"
            autoComplete="bday"
            slotProps={{ inputLabel: { shrink: true } }}
            onChange={(event) => set("birth_date", event.target.value)}
          />
        </Grid>
      )}
      {has("nationality") && (
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            {...common("nationality")}
            placeholder={t("case-field-nationality-placeholder")}
            onChange={(event) => set("nationality", event.target.value)}
          />
        </Grid>
      )}
      {has("marital_status") && (
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            {...common("marital_status")}
            select
            onChange={(event) => set("marital_status", event.target.value)}
          >
            <MenuItem value="">{t("case-field-choose")}</MenuItem>
            {MARITAL_STATUSES.map((status) => (
              <MenuItem key={status} value={status}>
                {t(MARITAL_KEY[status])}
              </MenuItem>
            ))}
          </TextField>
        </Grid>
      )}
      {has("profession") && (
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            {...common("profession")}
            autoComplete="organization-title"
            onChange={(event) => set("profession", event.target.value)}
          />
        </Grid>
      )}
      {has("email") && (
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            {...common("email")}
            type="email"
            autoComplete="email"
            onChange={(event) => set("email", event.target.value)}
          />
        </Grid>
      )}
      {has("phone") && (
        <Grid size={{ xs: 12, sm: 6 }}>
          <PhoneField
            {...common("phone")}
            invalidMessage={t("case-error-phone")}
            onChange={(event) => set("phone", event.target.value)}
          />
        </Grid>
      )}
      {has("postal_code") && (
        <Grid size={{ xs: 12, sm: 6 }}>
          <CepField
            {...common("postal_code")}
            invalidMessage={t("case-error-postal-code")}
            onChange={(event) => set("postal_code", event.target.value)}
            onAddressFound={(address) =>
              onChange({
                ...values,
                postal_code: address.postalCode || values.postal_code,
                street: address.street || values.street,
                district: address.district || values.district,
                city: address.city || values.city,
                uf: address.state || values.uf,
              })
            }
          />
        </Grid>
      )}
      {has("street") && (
        <Grid size={{ xs: 12, sm: 8 }}>
          <TextField
            {...common("street")}
            autoComplete="address-line1"
            onChange={(event) => set("street", event.target.value)}
          />
        </Grid>
      )}
      {has("address_number") && (
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField {...common("address_number")} onChange={(event) => set("address_number", event.target.value)} />
        </Grid>
      )}
      {has("complement") && (
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField
            {...common("complement")}
            autoComplete="address-line2"
            onChange={(event) => set("complement", event.target.value)}
          />
        </Grid>
      )}
      {has("district") && (
        <Grid size={{ xs: 12, sm: 6 }}>
          <TextField {...common("district")} onChange={(event) => set("district", event.target.value)} />
        </Grid>
      )}
      {has("city") && (
        <Grid size={{ xs: 12, sm: 8 }}>
          <TextField
            {...common("city")}
            autoComplete="address-level2"
            onChange={(event) => set("city", event.target.value)}
          />
        </Grid>
      )}
      {has("uf") && (
        <Grid size={{ xs: 12, sm: 4 }}>
          <TextField {...common("uf")} select onChange={(event) => set("uf", event.target.value)}>
            <MenuItem value="">{t("case-field-choose")}</MenuItem>
            {UFS.map((uf) => (
              <MenuItem key={uf} value={uf}>
                {uf}
              </MenuItem>
            ))}
          </TextField>
        </Grid>
      )}
    </Grid>
  );
}
