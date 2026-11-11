"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, MenuItem, TextField, Typography } from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import StateLine from "@/components/product/state-line";
import { setInternalDeadlineDays, setInternalDeadlineDaysForAct } from "@/lib/agenda/actions";

/** The business days a person may choose; 0 is no internal deadline. */
const DAY_CHOICES = [0, 1, 2, 3, 4, 5, 7, 10] as const;

const ERROR_KEY: Record<string, string> = {
  support_visit: "agenda-subscribe-support",
  not_allowed: "agenda-subscribe-not-allowed",
};

/**
 * The firm's internal deadline (migrations 0132 and 0167): how many of the court's business days before the fatal
 * deadline the internal one comes, for the whole firm, and, apart, for an act that needs another. A partner or the
 * controladoria changes it (the database checks who); everybody else reads it. It was in the person's panel of the
 * agenda, which now says it and leads here: it is the firm's, so it lives with the firm's rules of the cases.
 */
export default function InternalDeadlineCard({
  days: firmDays,
  byAct: firmByAct,
  acts,
  sets,
  supportVisit,
}: {
  days: number;
  /** The days of each act the firm set apart from its own (0167). */
  byAct: Record<string, number>;
  /** The acts of the list, read only for who sets the days. */
  acts: { slug: string; name: string }[];
  /** A partner or the controladoria. */
  sets: boolean;
  supportVisit: boolean;
}) {
  const t = useTranslations("product");
  const [days, setDays] = useState(firmDays);
  const [savedDays, setSavedDays] = useState(firmDays);
  const [byAct, setByAct] = useState(firmByAct);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const editable = sets && !supportVisit;
  const apart = Object.keys(byAct).length;
  const dayWords = (count: number) => (count === 0 ? t("agenda-internal-off") : t("agenda-internal-days", { count }));

  const run = async (work: () => Promise<{ ok: true } | { ok: false; code: string }>, then: () => void) => {
    setBusy(true);
    setProblem(null);
    setSaved(false);
    try {
      const result = await work();
      if (result.ok) then();
      else setProblem(t(ERROR_KEY[result.code] ?? "agenda-subscribe-failed"));
    } catch {
      setProblem(t("agenda-subscribe-failed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <CollapsibleCard
      id="prazo-interno-title"
      anchor="prazo-interno"
      title={t("agenda-internal-title")}
      summary={
        apart > 0
          ? t("rules-internal-summary-apart", { days: t("agenda-internal-now", { count: savedDays }), count: apart })
          : t("agenda-internal-now", { count: savedDays })
      }
      description={t("agenda-internal-body")}
      bodyClassName="gap-3"
    >
      {problem ? (
        <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
          {problem}
        </Alert>
      ) : null}
      {editable ? (
        <>
          <Box className="flex flex-wrap items-center gap-2">
            <TextField
              select
              size="small"
              id="rules-internal-days"
              label={t("agenda-internal-title")}
              value={String(days)}
              disabled={busy}
              onChange={(event) => {
                setDays(Number(event.target.value));
                setSaved(false);
              }}
              className="w-56"
            >
              {DAY_CHOICES.map((count) => (
                <MenuItem key={count} value={String(count)}>
                  {dayWords(count)}
                </MenuItem>
              ))}
            </TextField>
            <Button
              variant="contained"
              size="small"
              disabled={busy || days === savedDays}
              onClick={() =>
                void run(
                  () => setInternalDeadlineDays(days),
                  () => {
                    setSavedDays(days);
                    setSaved(true);
                  },
                )
              }
            >
              {busy ? t("cases-working") : t("agenda-internal-save")}
            </Button>
          </Box>
          {saved ? <StateLine tone="done">{t("agenda-internal-saved")}</StateLine> : null}
          {acts.length > 0 ? (
            <Box className="flex flex-col gap-3 pt-2">
              <Typography variant="body2" className="text-text-secondary">
                {t("agenda-internal-acts-body")}
              </Typography>
              {acts.map((act) => (
                <TextField
                  key={act.slug}
                  select
                  size="small"
                  label={act.name}
                  value={act.slug in byAct ? String(byAct[act.slug]) : "firm"}
                  disabled={busy}
                  onChange={(event) => {
                    const chosen = event.target.value === "firm" ? null : Number(event.target.value);
                    void run(
                      () => setInternalDeadlineDaysForAct(act.slug, chosen),
                      () =>
                        setByAct((current) => {
                          const next = { ...current };
                          if (chosen === null) delete next[act.slug];
                          else next[act.slug] = chosen;
                          return next;
                        }),
                    );
                  }}
                >
                  <MenuItem value="firm">{t("agenda-internal-act-firm", { count: savedDays })}</MenuItem>
                  {DAY_CHOICES.map((count) => (
                    <MenuItem key={count} value={String(count)}>
                      {dayWords(count)}
                    </MenuItem>
                  ))}
                </TextField>
              ))}
            </Box>
          ) : null}
        </>
      ) : (
        <Typography variant="body2" className="text-text-secondary">
          {supportVisit ? t("agenda-subscribe-support") : t("agenda-subscribe-not-allowed")}
        </Typography>
      )}
    </CollapsibleCard>
  );
}
