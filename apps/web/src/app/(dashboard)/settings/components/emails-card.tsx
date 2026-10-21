"use client";

import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";

import { Alert, Card, CardContent, FormControlLabel, Grid, Skeleton, Switch, Typography } from "@mui/material";

import { createClient } from "@flyee/auth/client";

/**
 * What ONE sends to the person's address, and the one thing they can
 * turn off: the news. Receipts and notices about the account are part of the
 * service, so the card says they keep coming instead of offering a switch that
 * would not be honoured.
 *
 * The switch saves on change (`set_marketing_email_opt_out`): there is one
 * choice here, and a separate "save" button would only add a way to forget it.
 * The same preference is what the unsubscribe link of a news e-mail changes.
 */
export default function EmailsCard() {
  const t = useTranslations("product");
  const [receives, setReceives] = useState<boolean | null>(null);
  const [status, setStatus] = useState<"saved" | "error" | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from("profiles")
        .select("marketing_email_opt_out")
        .eq("id", user.id)
        .maybeSingle();
      setReceives(!data?.marketing_email_opt_out);
    };
    void load();
  }, []);

  const change = async (next: boolean) => {
    const previous = receives;
    setReceives(next);
    setSaving(true);
    setStatus(null);
    const { error } = await createClient().rpc("set_marketing_email_opt_out", { p_opt_out: !next });
    setSaving(false);
    if (error) {
      // The switch goes back to what the account really has.
      setReceives(previous);
      setStatus("error");
      return;
    }
    setStatus("saved");
  };

  return (
    <Grid size={12}>
      <Card component="section" aria-labelledby="settings-emails-title">
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <Typography id="settings-emails-title" variant="h5" component="h2" className="mb-0">
              {t("settings-emails-title")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {t("settings-emails-body")}
            </Typography>
          </div>

          {receives === null ? (
            <Skeleton variant="rounded" height={56} />
          ) : (
            <div className="flex flex-col gap-1">
              <FormControlLabel
                control={
                  <Switch
                    checked={receives}
                    disabled={saving}
                    onChange={(event) => void change(event.target.checked)}
                  />
                }
                label={t("settings-emails-news-label")}
              />
              <Typography variant="body2" className="text-text-secondary">
                {t("settings-emails-news-help")}
              </Typography>
            </div>
          )}

          <Typography variant="body2" className="text-text-secondary">
            {t("settings-emails-always")}
          </Typography>

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
    </Grid>
  );
}
