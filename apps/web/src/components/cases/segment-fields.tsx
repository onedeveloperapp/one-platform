"use client";

import { useTranslations } from "next-intl";

import { Checkbox, FormControlLabel, Grid, TextField } from "@mui/material";

import type { SegmentField, SegmentValues } from "@/lib/cases/forms";

/**
 * The fields of a leg of the trip, as the firm and the client fill them. The
 * times are local, as the ticket prints them (no time zone); airports are the
 * three-letter codes printed on the ticket and the boarding pass. The
 * database checks every value again (`apply_segment_fields`, migration 0022).
 */

const LABEL_KEY: Record<SegmentField | "affected", string> = {
  flight_number: "case-segment-flight-number",
  origin_iata: "case-segment-origin",
  destination_iata: "case-segment-destination",
  scheduled_departure_local: "case-segment-scheduled-departure",
  scheduled_arrival_local: "case-segment-scheduled-arrival",
  actual_departure_local: "case-segment-actual-departure",
  actual_arrival_local: "case-segment-actual-arrival",
  booking_reference: "case-segment-booking",
  affected: "case-segment-affected",
};

export default function SegmentFields({
  idPrefix,
  values,
  onChange,
  errorField,
  errorText,
  disabled,
}: {
  idPrefix: string;
  values: SegmentValues;
  onChange: (next: SegmentValues) => void;
  errorField?: string | null;
  errorText?: string | null;
  disabled?: boolean;
}) {
  const t = useTranslations("product");
  const set = (field: SegmentField, value: string) => onChange({ ...values, [field]: value });
  const errorOf = (field: SegmentField) => (errorField === field ? (errorText ?? undefined) : undefined);
  const common = (field: SegmentField) => ({
    id: `${idPrefix}-${field}`,
    name: field,
    label: t(LABEL_KEY[field]),
    value: values[field],
    fullWidth: true,
    size: "small" as const,
    disabled,
    error: Boolean(errorOf(field)),
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => set(field, event.target.value),
  });
  const code = (field: "origin_iata" | "destination_iata") => ({
    ...common(field),
    helperText: errorOf(field) ?? t("case-segment-airport-help"),
    slotProps: {
      htmlInput: { maxLength: 3, autoCapitalize: "characters", style: { textTransform: "uppercase" as const } },
    },
  });
  const time = (field: SegmentField) => ({
    ...common(field),
    type: "datetime-local",
    helperText: errorOf(field),
    slotProps: { inputLabel: { shrink: true } },
  });

  return (
    <Grid container spacing={2}>
      <Grid size={{ xs: 12, sm: 6 }}>
        <TextField
          {...common("flight_number")}
          helperText={errorOf("flight_number") ?? t("case-segment-flight-number-help")}
          slotProps={{ htmlInput: { maxLength: 9, autoCapitalize: "characters" } }}
        />
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <TextField
          {...common("booking_reference")}
          helperText={errorOf("booking_reference") ?? t("case-segment-booking-help")}
          slotProps={{ htmlInput: { maxLength: 8, autoCapitalize: "characters" } }}
        />
      </Grid>
      <Grid size={{ xs: 6 }}>
        <TextField {...code("origin_iata")} />
      </Grid>
      <Grid size={{ xs: 6 }}>
        <TextField {...code("destination_iata")} />
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <TextField {...time("scheduled_departure_local")} />
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <TextField {...time("scheduled_arrival_local")} />
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <TextField {...time("actual_departure_local")} />
      </Grid>
      <Grid size={{ xs: 12, sm: 6 }}>
        <TextField {...time("actual_arrival_local")} />
      </Grid>
      <Grid size={12}>
        <FormControlLabel
          control={
            <Checkbox
              size="small"
              id={`${idPrefix}-affected`}
              checked={values.affected}
              disabled={disabled}
              onChange={(event) => onChange({ ...values, affected: event.target.checked })}
            />
          }
          label={t(LABEL_KEY.affected)}
        />
      </Grid>
    </Grid>
  );
}
