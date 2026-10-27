"use client";

import { type CertificateEntry, teamErrorKey } from "../team-types";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Checkbox, FormControlLabel, Grid, MenuItem, TextField, Typography } from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import EmptyState from "@/components/product/empty-state";
import StatusChip, { type StatusTone } from "@/components/product/status-chip";
import NiShieldCheck from "@/icons/nexture/ni-shield-check";
import {
  CERTIFICATE_KIND_KEY,
  CERTIFICATE_KINDS,
  certificateExpiry,
  type CertificateKind,
  COURT_SYSTEMS,
  type CourtSystemName,
  STATION_CHECK_KEY,
  type StationCheck,
  stationChecks,
} from "@/lib/cases/statements";
import { removeCertificateEntry, saveCertificateEntry } from "@/lib/firm/actions";
import { formatDayBr } from "@flyee/rules/person";

const SYSTEM_KEY: Record<CourtSystemName, string> = {
  projudi: "case-system-projudi",
  eproc: "case-system-eproc",
  pje: "case-system-pje",
  esaj: "case-system-esaj",
  outro: "case-system-outro",
};

const EXPIRY: Record<"expired" | "soon" | "ok" | "unknown", { key: string; tone: StatusTone } | null> = {
  expired: { key: "team-certificate-expired", tone: "attention" },
  soon: { key: "team-certificate-soon", tone: "attention" },
  ok: null,
  unknown: null,
};

/**
 * What a lawyer signs with in each court system, as they declare it: the
 * kind of digital certificate, who issued it, until when they say it is
 * valid, and the last day they confirmed that their computer signs there.
 * The firm reads it to know who can file where. Nothing of a certificate
 * itself is ever asked or kept: signing happens in the court's own system,
 * on the lawyer's station. The lawyer's own entries, one per system.
 */
export default function CertificatesCard({
  entries,
  today,
  onChanged,
}: {
  entries: CertificateEntry[];
  /** The day in Brazil's official time, to tell a validity that is over or close to it. */
  today: string;
  onChanged: () => void;
}) {
  const t = useTranslations("product");
  const [adding, setAdding] = useState(false);
  const [system, setSystem] = useState<CourtSystemName | "">("");
  const [kind, setKind] = useState<CertificateKind | "">("");
  const [issuer, setIssuer] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  // The station check in course: the system, and what the lawyer ticked of it so far.
  const [checking, setChecking] = useState<CourtSystemName | null>(null);
  const [ticked, setTicked] = useState<StationCheck[]>([]);

  const taken = new Set(entries.map((entry) => entry.system));
  // A validity over, or close to its end, is what this card is opened for: the lawyer may not sign that day.
  const expiries = entries.map((entry) => certificateExpiry(entry.validUntil, today));
  const worst = expiries.includes("expired") ? EXPIRY.expired : expiries.includes("soon") ? EXPIRY.soon : null;

  const run = async (key: string, work: () => Promise<{ ok: boolean; code: string }>, after?: () => void) => {
    if (busy) return;
    setBusy(key);
    setErrorCode(null);
    try {
      const result = await work();
      if (!result.ok) {
        setErrorCode(result.code);
        return;
      }
      after?.();
      onChanged();
    } catch {
      setErrorCode("failed");
    } finally {
      setBusy(null);
    }
  };

  const startAdding = () => {
    setSystem("");
    setKind("");
    setIssuer("");
    setValidUntil("");
    setErrorCode(null);
    setAdding(true);
  };

  return (
    <Grid size={12}>
      <CollapsibleCard
        id="team-certificates"
        title={t("team-certificates-title")}
        summary={
          entries.length === 0
            ? t("team-certificates-empty-title")
            : entries
                .map((entry) => `${t(SYSTEM_KEY[entry.system])}: ${t(CERTIFICATE_KIND_KEY[entry.kind])}`)
                .join(" · ")
        }
        chip={worst ? <StatusChip label={t(worst.key)} tone={worst.tone} /> : null}
        description={t("team-certificates-body")}
        defaultOpen={worst !== null}
        bodyClassName="gap-5"
      >
        {errorCode ? (
          <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setErrorCode(null)}>
            {t(teamErrorKey(errorCode))}
          </Alert>
        ) : null}

        {entries.length === 0 && !adding ? (
          <EmptyState
            titleAs="h3"
            icon={<NiShieldCheck size="large" />}
            title={t("team-certificates-empty-title")}
            description={t("team-certificates-empty-body")}
            action={{ label: t("team-certificates-add"), onClick: startAdding }}
            className="py-10"
          />
        ) : (
          <Box component="ul" className="m-0 flex list-none flex-col p-0">
            {entries.map((entry) => {
              const expiry = EXPIRY[certificateExpiry(entry.validUntil, today)];
              return (
                <Box
                  component="li"
                  key={entry.system}
                  className="border-grey-100 flex flex-col gap-2 border-b py-3 last:border-b-0"
                >
                  <Box className="flex flex-row flex-wrap items-center gap-3">
                    <Typography variant="subtitle2" component="p" className="mb-0 min-w-0 flex-1">
                      {[t(SYSTEM_KEY[entry.system]), t(CERTIFICATE_KIND_KEY[entry.kind])].join(" · ")}
                    </Typography>
                    {expiry ? <StatusChip label={t(expiry.key)} tone={expiry.tone} /> : null}
                  </Box>
                  <Typography variant="body2" className="text-text-secondary">
                    {[
                      entry.issuer,
                      entry.validUntil
                        ? t("team-certificate-valid-until", { day: formatDayBr(entry.validUntil) ?? "" })
                        : null,
                      entry.stationCheckedLabel
                        ? t("team-certificate-station-checked", { when: entry.stationCheckedLabel })
                        : t("team-certificate-station-never"),
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </Typography>
                  {checking === entry.system ? (
                    <Box
                      component="fieldset"
                      className="border-grey-100 m-0 flex flex-col gap-1 rounded-2xl border p-4"
                    >
                      <Typography component="legend" variant="body2" className="text-text-secondary px-1">
                        {t("team-station-title", { system: t(SYSTEM_KEY[entry.system]) })}
                      </Typography>
                      {stationChecks(entry.system).map((check) => (
                        <FormControlLabel
                          key={check}
                          label={t(STATION_CHECK_KEY[check])}
                          control={
                            <Checkbox
                              size="small"
                              checked={ticked.includes(check)}
                              disabled={busy !== null}
                              onChange={(event) =>
                                setTicked((current) =>
                                  event.target.checked ? [...current, check] : current.filter((item) => item !== check),
                                )
                              }
                            />
                          }
                        />
                      ))}
                      <Box className="flex flex-row flex-wrap gap-2 pt-2">
                        <Button
                          variant="contained"
                          size="small"
                          disabled={
                            busy !== null || stationChecks(entry.system).some((check) => !ticked.includes(check))
                          }
                          onClick={() =>
                            void run(
                              `check-${entry.system}`,
                              () =>
                                saveCertificateEntry({
                                  system: entry.system,
                                  kind: entry.kind,
                                  issuer: entry.issuer,
                                  validUntil: entry.validUntil,
                                  stationChecked: true,
                                }),
                              () => setChecking(null),
                            )
                          }
                        >
                          {busy === `check-${entry.system}` ? t("team-certificate-saving") : t("team-station-done")}
                        </Button>
                        <Button
                          variant="text"
                          color="grey"
                          size="small"
                          disabled={busy !== null}
                          onClick={() => setChecking(null)}
                        >
                          {t("team-certificate-cancel")}
                        </Button>
                      </Box>
                    </Box>
                  ) : null}
                  <Box className="flex flex-row flex-wrap gap-2">
                    {checking === entry.system ? null : (
                      <Button
                        variant="outlined"
                        color="grey"
                        size="small"
                        disabled={busy !== null}
                        onClick={() => {
                          setChecking(entry.system);
                          setTicked([]);
                        }}
                      >
                        {t("team-certificate-station-confirm")}
                      </Button>
                    )}
                    <Button
                      variant="text"
                      color="grey"
                      size="small"
                      disabled={busy !== null}
                      onClick={() => void run(`remove-${entry.system}`, () => removeCertificateEntry(entry.system))}
                    >
                      {t("team-certificate-remove")}
                    </Button>
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}

        {entries.length > 0 ? (
          <Typography variant="body2" className="text-text-secondary max-w-3xl">
            {t("team-certificate-station-help")}
          </Typography>
        ) : null}

        {adding ? (
          <Box className="flex flex-col gap-3">
            <Grid container spacing={3}>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  select
                  fullWidth
                  size="small"
                  id="team-certificate-system"
                  label={t("team-certificate-system")}
                  value={system}
                  disabled={busy !== null}
                  onChange={(event) => setSystem(event.target.value as CourtSystemName)}
                >
                  {COURT_SYSTEMS.map((value) => (
                    <MenuItem key={value} value={value} disabled={taken.has(value)}>
                      {t(SYSTEM_KEY[value])}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  select
                  fullWidth
                  size="small"
                  id="team-certificate-kind"
                  label={t("team-certificate-kind")}
                  value={kind}
                  disabled={busy !== null}
                  onChange={(event) => setKind(event.target.value as CertificateKind)}
                >
                  {CERTIFICATE_KINDS.map((value) => (
                    <MenuItem key={value} value={value}>
                      {t(CERTIFICATE_KIND_KEY[value])}
                    </MenuItem>
                  ))}
                </TextField>
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  size="small"
                  id="team-certificate-issuer"
                  label={t("team-certificate-issuer")}
                  helperText={t("team-certificate-issuer-help")}
                  value={issuer}
                  disabled={busy !== null}
                  slotProps={{ htmlInput: { maxLength: 80 } }}
                  onChange={(event) => setIssuer(event.target.value)}
                />
              </Grid>
              <Grid size={{ xs: 12, sm: 6 }}>
                <TextField
                  fullWidth
                  size="small"
                  type="date"
                  id="team-certificate-valid"
                  label={t("team-certificate-valid")}
                  value={validUntil}
                  disabled={busy !== null}
                  slotProps={{ inputLabel: { shrink: true } }}
                  onChange={(event) => setValidUntil(event.target.value)}
                />
              </Grid>
            </Grid>
            <Box className="flex flex-row flex-wrap gap-2">
              <Button
                variant="contained"
                disabled={busy !== null || !system || !kind}
                onClick={() =>
                  void run(
                    "add",
                    () =>
                      saveCertificateEntry({
                        system: system as CourtSystemName,
                        kind: kind as CertificateKind,
                        issuer: issuer.trim() || null,
                        validUntil: validUntil || null,
                        stationChecked: false,
                      }),
                    () => setAdding(false),
                  )
                }
              >
                {busy === "add" ? t("team-certificate-saving") : t("team-certificate-save")}
              </Button>
              <Button variant="text" color="grey" onClick={() => setAdding(false)} disabled={busy !== null}>
                {t("team-certificate-cancel")}
              </Button>
            </Box>
          </Box>
        ) : entries.length > 0 && entries.length < COURT_SYSTEMS.length ? (
          <Box>
            <Button variant="outlined" color="grey" onClick={startAdding} disabled={busy !== null}>
              {t("team-certificates-add")}
            </Button>
          </Box>
        ) : null}
      </CollapsibleCard>
    </Grid>
  );
}
