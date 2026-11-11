"use client";

import { useLocale, useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { Alert, Box, Button, Card, CardContent, Grid, MenuItem, Skeleton, TextField, Typography } from "@mui/material";

import CardTitle from "@/components/product/card-title";
import SecondFactorPrompt from "@/components/product/second-factor-prompt";
import StateLine from "@/components/product/state-line";
import StatusChip from "@/components/product/status-chip";
import NiHeadset from "@/icons/nexture/ni-headset";
import {
  endSupportAccess,
  type FirmSupportAccess,
  grantSupportAccess,
  readFirmSupportAccess,
} from "@/lib/support-access-actions";

const HOURS = [1, 24, 72, 168] as const;

const ERROR_KEY: Record<string, string> = {
  not_allowed: "support-access-error-not-allowed",
  support_visit: "support-access-error-support-visit",
  invalid_hours: "support-access-error-hours",
};

/**
 * Whether ONE's support may enter the firm (migration 0203): the firm's data are its clients', so a support visit
 * opens only with the firm's authorization in force. Anybody of the firm reads it and the visits made; who manages
 * the firm's account, or decides for it, lets the support in for some hours with the second factor, or ends it.
 */
export default function SupportAccessCard() {
  const t = useTranslations("product");
  const locale = useLocale();
  const [access, setAccess] = useState<FirmSupportAccess | null | undefined>(undefined);
  const [hours, setHours] = useState<number>(24);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [factor, setFactor] = useState<"missing" | "challenge" | null>(null);

  const load = useCallback(async () => {
    const read = await readFirmSupportAccess().catch(() => ({ ok: false as const }));
    setAccess(read.ok ? read.access : null);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(new Date(iso));

  const grant = async () => {
    setBusy(true);
    setProblem(null);
    const result = await grantSupportAccess(hours, note);
    setBusy(false);
    if (result.ok) {
      setNote("");
      await load();
      return;
    }
    if (result.code === "second_factor") {
      setFactor(result.factor ?? "challenge");
      return;
    }
    setProblem(ERROR_KEY[result.code] ?? "support-access-error");
  };

  const end = async () => {
    setBusy(true);
    setProblem(null);
    const result = await endSupportAccess();
    setBusy(false);
    if (!result.ok) {
      setProblem(ERROR_KEY[result.code] ?? "support-access-error");
      return;
    }
    await load();
  };

  return (
    <Grid size={12}>
      <Card component="section" id="acesso-suporte" aria-labelledby="support-access-title">
        <CardContent className="flex flex-col gap-4">
          <CardTitle
            id="support-access-title"
            icon={<NiHeadset size="medium" />}
            title={t("support-access-title")}
            description={t("support-access-hint")}
            chip={
              access?.live ? (
                <StatusChip tone="attention" label={t("support-access-chip-open")} />
              ) : access ? (
                <StatusChip tone="neutral" label={t("support-access-chip-closed")} />
              ) : undefined
            }
          />
          {access === undefined ? (
            <Skeleton variant="rounded" height={96} />
          ) : access === null ? (
            <Alert severity="error" className="neutral bg-background-paper/60!">
              {t("support-access-failed")}
            </Alert>
          ) : (
            <>
              {access.live ? (
                <StateLine
                  tone="attention"
                  action={
                    access.manages ? (
                      <Button variant="outlined" color="grey" size="small" disabled={busy} onClick={() => void end()}>
                        {t("support-access-end")}
                      </Button>
                    ) : undefined
                  }
                >
                  {t("support-access-live", {
                    until: when(access.live.endsAt),
                    who: access.live.grantedBy,
                  })}
                  {access.live.note ? ` ${t("support-access-live-note", { note: access.live.note })}` : ""}
                </StateLine>
              ) : (
                <StateLine tone="done">{t("support-access-closed")}</StateLine>
              )}

              {access.manages && !access.live ? (
                <Box className="flex flex-col gap-3">
                  <Box className="flex flex-col gap-3 sm:flex-row">
                    <TextField
                      select
                      size="small"
                      label={t("support-access-hours")}
                      value={hours}
                      onChange={(event) => setHours(Number(event.target.value))}
                      className="sm:w-56"
                    >
                      {HOURS.filter((value) => value <= access.maxHours).map((value) => (
                        <MenuItem key={value} value={value}>
                          {t("support-access-hours-option", { count: value })}
                        </MenuItem>
                      ))}
                    </TextField>
                    <TextField
                      size="small"
                      fullWidth
                      label={t("support-access-note")}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                      slotProps={{ htmlInput: { maxLength: 300 } }}
                    />
                  </Box>
                  {factor ? (
                    <SecondFactorPrompt
                      state={factor}
                      reason={t("support-access-factor")}
                      onConfirmed={() => {
                        setFactor(null);
                        void grant();
                      }}
                    />
                  ) : (
                    <Box>
                      <Button variant="contained" disabled={busy} onClick={() => void grant()}>
                        {t("support-access-grant")}
                      </Button>
                    </Box>
                  )}
                </Box>
              ) : null}

              {problem ? (
                <Alert severity="error" className="neutral bg-background-paper/60!">
                  {t(problem)}
                </Alert>
              ) : null}

              <Box className="flex flex-col gap-1">
                <Typography variant="subtitle2" component="h3">
                  {t("support-access-visits")}
                </Typography>
                {access.visits.length === 0 ? (
                  <Typography variant="body2" className="text-text-secondary">
                    {t("support-access-no-visits")}
                  </Typography>
                ) : (
                  access.visits.map((visit) => (
                    <StateLine key={visit.startedAt} tone="info">
                      {t("support-access-visit", { when: when(visit.startedAt), reason: visit.reason })}
                    </StateLine>
                  ))
                )}
              </Box>
            </>
          )}
        </CardContent>
      </Card>
    </Grid>
  );
}
