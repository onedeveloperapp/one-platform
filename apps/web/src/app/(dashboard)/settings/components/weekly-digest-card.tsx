"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Grid,
  Skeleton,
  Switch,
  Typography,
} from "@mui/material";

import CardTitle from "@/components/product/card-title";
import NiChartBar from "@/icons/nexture/ni-chart-bar";
import { readWeeklyDigest, setWeeklyDigest, type WeeklyDigestRead } from "@/lib/firm/weekly-digest-actions";

/**
 * The partner's weekly digest (migration 0200): who decides for the firm turns it on or off, saved on change, and reads
 * the week before this one in the very words the next e-mail uses. Anybody else of the firm sees nothing here.
 */
export default function WeeklyDigestCard() {
  const t = useTranslations("product");
  const [read, setRead] = useState<WeeklyDigestRead | null>(null);
  const [on, setOn] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"saved" | "error" | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    void readWeeklyDigest().then((answer) => {
      setRead(answer);
      if (answer.ok && answer.decides) setOn(answer.on);
    });
  }, []);

  if (read === null) {
    return (
      <Grid size={12}>
        <Skeleton variant="rounded" height={140} />
      </Grid>
    );
  }
  if (!read.ok || !read.decides) return null;

  const change = async (next: boolean) => {
    const previous = on;
    setOn(next);
    setSaving(true);
    setStatus(null);
    const answer = await setWeeklyDigest(next);
    setSaving(false);
    if (!answer.ok) {
      setOn(previous);
      setStatus("error");
      return;
    }
    setStatus("saved");
  };

  return (
    <Grid size={12}>
      <Card component="section" id="resumo-semanal" aria-labelledby="settings-weekly-title">
        <CardContent className="flex flex-col gap-4">
          <CardTitle
            id="settings-weekly-title"
            icon={<NiChartBar size="medium" />}
            title={t("settings-weekly-title")}
            description={t("settings-weekly-hint")}
          />
          <FormControlLabel
            control={<Switch checked={on} disabled={saving} onChange={(event) => void change(event.target.checked)} />}
            label={t("settings-weekly-label")}
          />
          {!read.emailReady ? (
            <Typography variant="body2" className="text-text-secondary">
              {t("settings-weekly-no-email")}
            </Typography>
          ) : null}
          <Box>
            <Button variant="outlined" color="grey" onClick={() => setOpen(true)}>
              {t("settings-weekly-preview")}
            </Button>
          </Box>
          {status === "saved" ? (
            <Alert severity="success" className="neutral bg-background-paper/60!">
              {t("settings-emails-saved")}
            </Alert>
          ) : null}
          {status === "error" ? (
            <Alert severity="error" className="neutral bg-background-paper/60!">
              {t("settings-emails-error")}
            </Alert>
          ) : null}
        </CardContent>
      </Card>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        fullWidth
        maxWidth="sm"
        aria-labelledby="settings-weekly-preview"
      >
        <DialogTitle id="settings-weekly-preview">
          {t("settings-weekly-preview-title", { week: read.weekLabel })}
        </DialogTitle>
        <DialogContent className="flex flex-col gap-4">
          {read.testsCounted ? (
            <Typography variant="body2" className="text-text-secondary">
              {t("settings-weekly-tests")}
            </Typography>
          ) : null}
          {read.empty ? (
            <Typography variant="body2" className="text-text-secondary">
              {t("settings-weekly-empty")}
            </Typography>
          ) : null}
          {read.sections.map((section) => (
            <Box key={section.key} className="flex flex-col gap-1">
              <Box className="flex flex-row flex-wrap items-baseline gap-x-2">
                <Typography variant="subtitle2" component="h3">
                  {section.title}
                </Typography>
                <Link href={section.url} className="text-text-secondary text-sm underline">
                  {t("settings-weekly-open")}
                </Link>
              </Box>
              <ul className="m-0 flex list-disc flex-col gap-1 pl-5">
                {section.lines.map((line) => (
                  <li key={line}>
                    <Typography variant="body2">{line}</Typography>
                  </li>
                ))}
              </ul>
            </Box>
          ))}
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={() => setOpen(false)}>
            {t("settings-weekly-close")}
          </Button>
        </DialogActions>
      </Dialog>
    </Grid>
  );
}
