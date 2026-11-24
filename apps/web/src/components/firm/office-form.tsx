"use client";

import { useTranslations } from "next-intl";
import { type Dispatch, type SetStateAction, useState } from "react";

import { Box, Button, Grid, IconButton, MenuItem, TextField, Typography } from "@mui/material";

import { CepField } from "@/components/product/fields";
import StateLine from "@/components/product/state-line";
import NiCross from "@/icons/nexture/ni-cross";
import { UFS } from "@/lib/cases/cases";
import { saveFirmOffice } from "@/lib/firm/actions";
import { type FirmOffice, officeProblem, type OfficeReadField } from "@/lib/firm/office";
import { formatCnpj, onlyDigits } from "@flyee/fields";

/** Where ONE read the firm's data, as the line over the form says it (0271). */
const READ_FROM_KEY: Record<string, string> = {
  procuracao: "office-read-from-procuracao",
  contrato: "office-read-from-contrato",
  timbrado: "office-read-from-timbrado",
  piece: "office-read-from-piece",
  peca_processo: "office-read-from-piece",
  declaracao_residencia: "office-read-from-declaration",
  declaracao_hipossuficiencia: "office-read-from-declaration",
};

/** What ONE read, as the line says each. */
const READ_FIELD_KEY: Record<OfficeReadField, string> = {
  address: "office-read-address",
  email: "office-read-email",
  society: "office-read-society",
  cnpj: "office-read-cnpj",
  phone: "office-read-phone",
  lawyers: "office-read-lawyers",
};

/** The office as the form opens it: an address ONE read without its CEP fills the form, which then asks the CEP. */
function opening(office: FirmOffice): FirmOffice {
  const left = office.read?.left;
  if (!left || office.street.trim() || office.city.trim()) return office;
  return { ...office, ...left, uf: left.uf.toUpperCase() };
}

const PROBLEM_KEY = {
  address: "office-error-address",
  society: "office-error-society",
  email: "office-error-email",
} as const;

/** A field as it is compared with what is kept: the CEP's mask is not a change. */
const sameField = (key: keyof FirmOffice, a: FirmOffice, b: FirmOffice): boolean =>
  key === "postalCode" ? onlyDigits(a.postalCode) === onlyDigits(b.postalCode) : a[key] === b[key];

/** What is typed in the form, and its save: kept by whoever draws the form, so leaving it loses nothing. */
export type OfficeDraft = {
  values: FirmOffice;
  setValues: Dispatch<SetStateAction<FirmOffice>>;
  set: (field: keyof FirmOffice, value: string) => void;
  busy: boolean;
  status: "saved" | "failed" | "not_authorized" | null;
  problem: ReturnType<typeof officeProblem>;
  /** Something differs from what is kept. */
  changed: boolean;
  /** A save was asked and refused for what is typed: the problem is said even before anything changed. */
  tried: boolean;
  /** Saves what changed, or confirms what ONE read as it is; true when there was nothing to save. */
  save: () => Promise<boolean>;
};

export function useOfficeDraft(office: FirmOffice, onSaved: () => void): OfficeDraft {
  const [values, setValues] = useState<FirmOffice>(() => opening(office));
  const [busy, setBusy] = useState(false);
  const [tried, setTried] = useState(false);
  const [status, setStatus] = useState<OfficeDraft["status"]>(null);
  const problem = officeProblem(values);
  const changed = (Object.keys(values) as (keyof FirmOffice)[]).some((key) => !sameField(key, values, office));

  const set = (field: keyof FirmOffice, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setStatus(null);
  };

  const save = async (): Promise<boolean> => {
    if (busy) return false;
    if (problem) {
      setTried(true);
      return false;
    }
    if (!changed && !office.read) return true;
    setBusy(true);
    setStatus(null);
    try {
      const result = await saveFirmOffice(values);
      if (result.ok) {
        setStatus("saved");
        setTried(false);
        onSaved();
        return true;
      }
      setStatus(result.code === "not_authorized" ? "not_authorized" : "failed");
      return false;
    } catch {
      setStatus("failed");
      return false;
    } finally {
      setBusy(false);
    }
  };

  return { values, setValues, set, busy, status, problem, changed, tried, save };
}

/**
 * Where the firm is, as the power of attorney says it (migration 0217): the address, with the CEP filling the street,
 * the district, the city and the state; the professional e-mail; and the registration at the bar of a society of
 * lawyers. Saved through `set_firm_office`, by who manages the firm account. Shared by "Dados do escritório" and the
 * setup. What ONE read of the firm from one of its documents (0271) is said over the form and beside each field it
 * filled, until a person saves, which confirms it; an address read without its CEP opens filled and asks the CEP;
 * the lawyers the firm's papers name who are not of the team are listed, and may be left out.
 *
 * In the setup (`embedded`, with the step's `draft`) the form has no button of its own: the step's "Continuar" saves
 * it, and leaving the step keeps what was typed (the owner, 2026-11-24: a "Salvar" over "Continuar" left the address
 * behind whenever the person went on).
 */
export default function OfficeForm({
  office,
  disabled,
  onSaved,
  draft: given,
  embedded = false,
}: {
  office: FirmOffice;
  disabled?: boolean;
  onSaved: () => void;
  draft?: OfficeDraft;
  embedded?: boolean;
}) {
  const t = useTranslations("product");
  const own = useOfficeDraft(office, onSaved);
  const { values, setValues, set, busy, status, problem, changed, tried, save } = given ?? own;
  const off = disabled || busy;
  const read = office.read;
  // A field ONE filled says so until a person changes it; saving confirms it.
  const readMark = (field: OfficeReadField, keys: (keyof FirmOffice)[]) =>
    read?.fields.includes(field) && keys.every((key) => sameField(key, values, office))
      ? t("fact-read-by-one")
      : undefined;
  const readWords = read
    ? new Intl.ListFormat("pt-BR", { style: "long", type: "conjunction" }).format(
        read.fields.map((field) => t(READ_FIELD_KEY[field])),
      )
    : "";
  const leftWithoutCep =
    Boolean(read?.left) && !office.street.trim() && values.postalCode.replace(/\D/g, "").length !== 8;

  return (
    <Box className="flex flex-col gap-4">
      {read && read.fields.length > 0 ? (
        <StateLine tone="info">
          {t("office-read-line", {
            what: readWords,
            from: t(READ_FROM_KEY[read.source] ?? "office-read-from-document"),
          })}
        </StateLine>
      ) : null}
      {leftWithoutCep ? <StateLine tone="attention">{t("office-read-without-cep")}</StateLine> : null}
      {/* The CNPJ is the billing profile's ("Plano e pagamentos"): shown, so what ONE read of it can be checked. */}
      {office.cnpj ? (
        <Box className="flex flex-col">
          <Typography variant="body2">{t("office-cnpj", { cnpj: formatCnpj(office.cnpj) })}</Typography>
          <Typography variant="caption" className="text-text-secondary">
            {read?.fields.includes("cnpj") ? t("office-cnpj-read") : t("office-cnpj-where")}
          </Typography>
        </Box>
      ) : null}
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, sm: 4 }}>
          <CepField
            id="office-postal-code"
            label={t("office-postal-code")}
            value={values.postalCode}
            invalidMessage={t("office-postal-code-invalid")}
            onChange={(event) => set("postalCode", event.target.value)}
            onAddressFound={(address) =>
              setValues((current) => ({
                ...current,
                postalCode: address.postalCode || current.postalCode,
                street: address.street || current.street,
                district: address.district || current.district,
                city: address.city || current.city,
                uf: address.state || current.uf,
              }))
            }
            disabled={off}
            fullWidth
            size="small"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 8 }}>
          <TextField
            id="office-street"
            label={t("office-street")}
            value={values.street}
            autoComplete="address-line1"
            onChange={(event) => set("street", event.target.value)}
            helperText={readMark("address", ["postalCode", "street", "number", "city", "uf"])}
            disabled={off}
            fullWidth
            size="small"
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 3 }}>
          <TextField
            id="office-number"
            label={t("office-number")}
            value={values.number}
            onChange={(event) => set("number", event.target.value)}
            disabled={off}
            fullWidth
            size="small"
          />
        </Grid>
        <Grid size={{ xs: 6, sm: 4 }}>
          <TextField
            id="office-complement"
            label={t("office-complement")}
            value={values.complement}
            autoComplete="address-line2"
            onChange={(event) => set("complement", event.target.value)}
            disabled={off}
            fullWidth
            size="small"
          />
        </Grid>
        <Grid size={{ xs: 12, sm: 5 }}>
          <TextField
            id="office-district"
            label={t("office-district")}
            value={values.district}
            onChange={(event) => set("district", event.target.value)}
            disabled={off}
            fullWidth
            size="small"
          />
        </Grid>
        <Grid size={{ xs: 8, sm: 9 }}>
          <TextField
            id="office-city"
            label={t("office-city")}
            value={values.city}
            autoComplete="address-level2"
            onChange={(event) => set("city", event.target.value)}
            disabled={off}
            fullWidth
            size="small"
          />
        </Grid>
        <Grid size={{ xs: 4, sm: 3 }}>
          <TextField
            id="office-uf"
            select
            label={t("office-uf")}
            value={values.uf}
            onChange={(event) => set("uf", event.target.value)}
            disabled={off}
            fullWidth
            size="small"
          >
            <MenuItem value="">{t("office-uf-none")}</MenuItem>
            {UFS.map((uf) => (
              <MenuItem key={uf} value={uf}>
                {uf}
              </MenuItem>
            ))}
          </TextField>
        </Grid>
        <Grid size={12}>
          <TextField
            id="office-email"
            type="email"
            label={t("office-email")}
            value={values.email}
            autoComplete="email"
            onChange={(event) => set("email", event.target.value)}
            helperText={readMark("email", ["email"])}
            disabled={off}
            fullWidth
            size="small"
          />
        </Grid>
      </Grid>

      <Box className="flex flex-col gap-2">
        <Typography variant="subtitle2" component="h3" className="mb-0">
          {t("office-society")}
        </Typography>
        <Grid container spacing={2}>
          <Grid size={{ xs: 4, sm: 3 }}>
            <TextField
              id="office-society-uf"
              select
              label={t("office-society-uf")}
              value={values.societyUf}
              onChange={(event) => set("societyUf", event.target.value)}
              disabled={off}
              fullWidth
              size="small"
            >
              <MenuItem value="">{t("office-uf-none")}</MenuItem>
              {UFS.map((uf) => (
                <MenuItem key={uf} value={uf}>
                  {uf}
                </MenuItem>
              ))}
            </TextField>
          </Grid>
          <Grid size={{ xs: 8, sm: 5 }}>
            <TextField
              id="office-society-number"
              label={t("office-society-number")}
              value={values.societyNumber}
              inputMode="numeric"
              onChange={(event) => set("societyNumber", event.target.value)}
              helperText={readMark("society", ["societyUf", "societyNumber"]) ?? t("office-society-help")}
              disabled={off}
              fullWidth
              size="small"
            />
          </Grid>
        </Grid>
      </Box>

      {values.lawyers.length > 0 || office.lawyers.length > 0 ? (
        <Box component="section" aria-labelledby="office-lawyers" className="flex flex-col gap-2">
          <Typography id="office-lawyers" variant="subtitle2" component="h3" className="mb-0">
            {t("office-lawyers")}
          </Typography>
          {values.lawyers.length > 0 ? (
            <Box component="ul" className="m-0 flex list-none flex-col gap-1 p-0">
              {values.lawyers.map((lawyer) => (
                <Box component="li" key={lawyer.uf + lawyer.number} className="flex items-center gap-2">
                  <Typography variant="body2" className="min-w-0 flex-1 break-words">
                    {t("office-lawyer", { name: lawyer.name, uf: lawyer.uf, number: lawyer.number })}
                  </Typography>
                  <IconButton
                    size="small"
                    aria-label={t("office-lawyer-remove", { name: lawyer.name })}
                    disabled={off}
                    onClick={() => {
                      setValues((current) => ({
                        ...current,
                        lawyers: current.lawyers.filter(
                          (kept) => kept.uf !== lawyer.uf || kept.number !== lawyer.number,
                        ),
                      }));
                    }}
                  >
                    <NiCross size="small" />
                  </IconButton>
                </Box>
              ))}
            </Box>
          ) : (
            <Typography variant="body2" className="text-text-secondary">
              {t("office-lawyers-none")}
            </Typography>
          )}
        </Box>
      ) : null}

      {problem && (changed || tried) && !leftWithoutCep ? (
        <StateLine tone="attention">{t(PROBLEM_KEY[problem])}</StateLine>
      ) : null}
      {status === "saved" && !embedded ? <StateLine tone="done">{t("office-saved")}</StateLine> : null}
      {status === "failed" ? <StateLine tone="failed">{t("office-error-failed")}</StateLine> : null}
      {status === "not_authorized" ? <StateLine tone="failed">{t("team-error-not-authorized")}</StateLine> : null}

      {embedded ? null : (
        <Box>
          {/* What ONE read is confirmed by saving it as it is. */}
          <Button
            variant="contained"
            onClick={() => void save()}
            disabled={off || (!changed && !read) || problem !== null}
          >
            {busy ? t("team-working") : !changed && read ? t("office-confirm") : t("office-save")}
          </Button>
        </Box>
      )}
    </Box>
  );
}
