"use client";

import { useTranslations } from "next-intl";
import { useEffect, useMemo, useState } from "react";

import {
  Alert,
  Autocomplete,
  Button,
  Card,
  CardContent,
  FormControl,
  FormLabel,
  Grid,
  Skeleton,
  TextField,
  Typography,
} from "@mui/material";

import { updateProfile } from "@/lib/member/actions";
import { createClient } from "@flyee/auth/client";

/**
 * The person's timezone: the dates in the notices and e-mails ONE writes to
 * them follow it (lib/messages/format.ts). Saved through
 * `update_member_profile`.
 */
export default function MemberCard() {
  const t = useTranslations("product");
  const [initial, setInitial] = useState<string | null>(null);
  const [timezone, setTimezone] = useState("");
  const [status, setStatus] = useState<"saved" | "error" | null>(null);
  const [saving, setSaving] = useState(false);

  const timezones = useMemo(() => {
    try {
      return Intl.supportedValuesOf("timeZone");
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    const load = async () => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from("profiles").select("timezone").eq("id", user.id).maybeSingle();
      const loaded = (data?.timezone as string | null) ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
      setInitial(loaded);
      setTimezone(loaded);
    };
    void load();
  }, []);

  const save = async () => {
    if (initial === null || !timezone) return;
    setSaving(true);
    setStatus(null);
    const result = await updateProfile({ timezone });
    if (result.ok) setInitial(timezone);
    setStatus(result.ok ? "saved" : "error");
    setSaving(false);
  };

  return (
    <Grid size={12}>
      <Card>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-1">
            <Typography variant="h5" component="h2" className="mb-0">
              {t("settings-member-title")}
            </Typography>
            <Typography variant="body2" className="text-text-secondary">
              {t("settings-member-body")}
            </Typography>
          </div>

          {initial === null ? (
            <Skeleton variant="rounded" height={72} />
          ) : (
            <Grid container spacing={3}>
              <Grid size={{ xs: 12, md: 6 }}>
                <FormControl fullWidth>
                  <FormLabel htmlFor="member-timezone" component="label">
                    {t("settings-member-timezone")}
                  </FormLabel>
                  <Autocomplete
                    id="member-timezone"
                    options={timezones}
                    value={timezone || null}
                    onChange={(_, value) => setTimezone(value ?? "")}
                    renderInput={(params) => <TextField {...params} />}
                  />
                </FormControl>
              </Grid>
            </Grid>
          )}

          {status === "saved" ? (
            <Alert severity="success" className="neutral bg-background-paper/60!">
              {t("settings-member-saved")}
            </Alert>
          ) : null}
          {status === "error" ? (
            <Alert severity="error" className="neutral bg-background-paper/60!">
              {t("settings-member-error")}
            </Alert>
          ) : null}

          <div>
            <Button variant="contained" onClick={() => void save()} disabled={initial === null || saving || !timezone}>
              {t("settings-member-save")}
            </Button>
          </div>
        </CardContent>
      </Card>
    </Grid>
  );
}
