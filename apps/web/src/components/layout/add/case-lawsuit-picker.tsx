"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Autocomplete, Box, InputAdornment, MenuItem, TextField, Typography } from "@mui/material";

import { useCaseSearch } from "@/components/layout/search/use-case-search";
import StateLine from "@/components/product/state-line";
import NiSearch from "@/icons/nexture/ni-search";
import { type AddLawsuit, readCaseLawsuits } from "@/lib/add/actions";
import { STATUS_KEY } from "@/lib/cases/cases";
import { searchable, type SearchHit } from "@/lib/search/global-search";
import { formatCnj } from "@flyee/rules/cnj";

const KIND_KEY: Record<AddLawsuit["kind"], string> = {
  juizado: "case-proceeding-kind-juizado",
  comum: "case-proceeding-kind-comum",
};

type Lawsuits = { kind: "idle" } | { kind: "loading" } | { kind: "ready"; rows: AddLawsuit[] } | { kind: "error" };

/** The lawsuit chosen, with the label the form names it by and the case it is of. */
export type PickedLawsuit = AddLawsuit & { label: string; caseId: string; caseName: string };

/** A case as the field names it once chosen: its client, or its own number when it has no client yet. */
const caseName = (hit: SearchHit) => hit.client || hit.label;

/**
 * The case and the lawsuit a new deadline or hearing is of, chosen first in the panel the "Adicionar" of the top
 * opens (the screen pattern of 2026-11-07): the case searched as the top searches it (the client's name, a CPF, a
 * lawsuit's number, the case's own number), then the lawsuit among the ones the court has, taken by itself when the
 * case has one. A case with none says so: a deadline and a hearing are of a lawsuit the court already has.
 */
export default function CaseLawsuitPicker({
  onLawsuit,
  disabled = false,
}: {
  /** The lawsuit chosen; null while there is none. */
  onLawsuit: (lawsuit: PickedLawsuit | null) => void;
  disabled?: boolean;
}) {
  const t = useTranslations("product");
  const [text, setText] = useState("");
  const [chosen, setChosen] = useState<SearchHit | null>(null);
  const [lawsuits, setLawsuits] = useState<Lawsuits>({ kind: "idle" });
  const [lawsuitId, setLawsuitId] = useState("");
  // Once a case is chosen, its name in the field is no question to the database.
  const found = useCaseSearch(chosen && text === caseName(chosen) ? "" : text);
  const label = (lawsuit: AddLawsuit) => [t(KIND_KEY[lawsuit.kind]), formatCnj(lawsuit.cnj) ?? lawsuit.cnj].join(" · ");

  useEffect(() => {
    setLawsuitId("");
    onLawsuit(null);
    if (!chosen) {
      setLawsuits({ kind: "idle" });
      return;
    }
    let live = true;
    setLawsuits({ kind: "loading" });
    readCaseLawsuits(chosen.id)
      .then((answer) => {
        if (!live) return;
        if (!answer.ok) {
          setLawsuits({ kind: "error" });
          return;
        }
        setLawsuits({ kind: "ready", rows: answer.lawsuits });
        // A case with one lawsuit in court: that is the lawsuit.
        if (answer.lawsuits.length === 1) {
          const only = answer.lawsuits[0];
          setLawsuitId(only.id);
          onLawsuit({ ...only, label: label(only), caseId: chosen.id, caseName: caseName(chosen) });
        }
      })
      .catch(() => {
        if (live) setLawsuits({ kind: "error" });
      });
    return () => {
      live = false;
    };
    // The lawsuits are read again only when another case is chosen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chosen?.id]);

  const hits = found.kind === "ready" ? found.hits : [];
  const nothing =
    found.kind === "error" ? t("add-case-error") : searchable(text) ? t("add-case-empty") : t("add-case-hint");

  return (
    <Box className="flex flex-col gap-3">
      <Autocomplete<SearchHit, false, false, false>
        options={hits}
        value={chosen}
        inputValue={text}
        onInputChange={(_event, next) => setText(next)}
        onChange={(_event, next) => setChosen(next)}
        filterOptions={(all) => all}
        getOptionLabel={caseName}
        getOptionKey={(option) => option.id}
        isOptionEqualToValue={(option, value) => option.id === value.id}
        loading={found.kind === "loading"}
        loadingText={t("add-case-loading")}
        noOptionsText={nothing}
        autoHighlight
        disabled={disabled}
        forcePopupIcon={false}
        renderOption={(props, option) => {
          const { key, ...rest } = props as typeof props & { key: string };
          return (
            <li key={key} {...rest}>
              <Box className="flex min-w-0 flex-col py-0.5">
                <Typography variant="body1" component="span" className="truncate font-semibold">
                  {caseName(option)}
                </Typography>
                <Typography variant="body2" component="span" className="text-text-secondary truncate">
                  {t("add-case-hit", { label: option.label, status: t(STATUS_KEY[option.status]) })}
                </Typography>
              </Box>
            </li>
          );
        }}
        renderInput={(params) => (
          <TextField
            {...params}
            size="small"
            label={t("add-case-label")}
            placeholder={t("add-case-placeholder")}
            slotProps={{
              ...params.slotProps,
              input: {
                ...params.slotProps.input,
                startAdornment: (
                  <>
                    <InputAdornment position="start">
                      <NiSearch size="small" className="text-text-secondary" />
                    </InputAdornment>
                    {params.slotProps.input.startAdornment}
                  </>
                ),
              },
            }}
          />
        )}
      />
      {chosen ? (
        lawsuits.kind === "loading" ? (
          <StateLine tone="waiting">{t("add-lawsuits-loading")}</StateLine>
        ) : lawsuits.kind === "error" ? (
          <StateLine tone="failed">{t("add-lawsuits-error")}</StateLine>
        ) : lawsuits.kind === "ready" && lawsuits.rows.length === 0 ? (
          <StateLine tone="info">{t("add-lawsuits-none")}</StateLine>
        ) : lawsuits.kind === "ready" ? (
          <TextField
            select
            fullWidth
            size="small"
            id="add-lawsuit"
            label={t("add-lawsuit-label")}
            value={lawsuitId}
            disabled={disabled}
            onChange={(event) => {
              const next = lawsuits.rows.find((row) => row.id === event.target.value) ?? null;
              setLawsuitId(next?.id ?? "");
              onLawsuit(next ? { ...next, label: label(next), caseId: chosen.id, caseName: caseName(chosen) } : null);
            }}
            helperText={lawsuits.rows.length > 1 ? t("add-lawsuit-help") : undefined}
          >
            {lawsuits.rows.map((row) => (
              <MenuItem key={row.id} value={row.id}>
                {label(row)}
              </MenuItem>
            ))}
          </TextField>
        ) : null
      ) : (
        <Typography variant="body2" className="text-text-secondary">
          {t("add-choose-case")}
        </Typography>
      )}
    </Box>
  );
}
