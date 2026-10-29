"use client";

import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";

import { Autocomplete, TextField } from "@mui/material";

import { findPassengers } from "@/modules/direito-do-passageiro/agency/actions";
import type { PaxPerson } from "@/modules/direito-do-passageiro/agency/passengers";

type Option = PaxPerson & { minor: boolean };

/**
 * The passengers of the partnership a person searches by name or CPF as they type: a list of thousands is never
 * carried to the browser. `exclude` leaves out who cannot be chosen here (the passenger of the page, the holder of
 * a trip), `adultsOnly` the children.
 */
function usePassengerSearch(input: string, exclude: readonly string[], adultsOnly: boolean) {
  const [options, setOptions] = useState<Option[]>([]);
  const [loading, setLoading] = useState(false);
  const asked = useRef(0);
  const excluded = exclude.join(",");
  useEffect(() => {
    const ask = ++asked.current;
    setLoading(true);
    const wait = setTimeout(async () => {
      const result = await findPassengers(input);
      if (ask !== asked.current) return;
      setLoading(false);
      if (!result.ok) return;
      const out = new Set(excluded.split(","));
      setOptions(result.people.filter((person) => !out.has(person.id) && (!adultsOnly || !person.minor)));
    }, 300);
    return () => clearTimeout(wait);
  }, [input, excluded, adultsOnly]);
  return { options, loading };
}

type Common = {
  id: string;
  label: string;
  helperText?: string;
  error?: boolean;
  exclude?: readonly string[];
  adultsOnly?: boolean;
  disabled?: boolean;
};

/** One passenger: who answers for a child. */
export function PassengerPicker({
  value,
  onChange,
  ...common
}: Common & { value: PaxPerson | null; onChange: (next: PaxPerson | null) => void }) {
  const t = useTranslations("product");
  const [input, setInput] = useState("");
  const { options, loading } = usePassengerSearch(input, common.exclude ?? [], common.adultsOnly ?? false);
  return (
    <Autocomplete
      id={common.id}
      options={options as PaxPerson[]}
      value={value}
      loading={loading}
      disabled={common.disabled}
      filterOptions={(all) => all}
      onInputChange={(_, next) => setInput(next)}
      onChange={(_, next) => onChange(next)}
      getOptionLabel={(option) => option.fullName}
      getOptionKey={(option) => option.id}
      isOptionEqualToValue={(option, chosen) => option.id === chosen.id}
      noOptionsText={t("pax-picker-none")}
      loadingText={t("pax-picker-loading")}
      renderInput={(params) => (
        <TextField {...params} label={common.label} size="small" helperText={common.helperText} error={common.error} />
      )}
    />
  );
}

/** Several passengers: who travels along on a trip. */
export function PassengerMultiPicker({
  value,
  onChange,
  ...common
}: Common & { value: PaxPerson[]; onChange: (next: PaxPerson[]) => void }) {
  const t = useTranslations("product");
  const [input, setInput] = useState("");
  const { options, loading } = usePassengerSearch(input, common.exclude ?? [], common.adultsOnly ?? false);
  return (
    <Autocomplete
      multiple
      id={common.id}
      options={options as PaxPerson[]}
      value={value}
      loading={loading}
      disabled={common.disabled}
      filterOptions={(all) => all}
      filterSelectedOptions
      onInputChange={(_, next, reason) => {
        if (reason !== "reset") setInput(next);
      }}
      onChange={(_, next) => onChange(next)}
      getOptionLabel={(option) => option.fullName}
      getOptionKey={(option) => option.id}
      isOptionEqualToValue={(option, chosen) => option.id === chosen.id}
      noOptionsText={t("pax-picker-none")}
      loadingText={t("pax-picker-loading")}
      renderInput={(params) => (
        <TextField {...params} label={common.label} size="small" helperText={common.helperText} error={common.error} />
      )}
    />
  );
}
