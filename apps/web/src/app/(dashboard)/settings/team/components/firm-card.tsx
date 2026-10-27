"use client";

import { type TeamData, teamErrorKey } from "../team-types";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, FormControl, FormHelperText, FormLabel, Grid, Input } from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import { renameFirm } from "@/lib/firm/actions";

/**
 * The firm's own name, for who manages the firm account. It is what the team
 * reads in the app and what an invitation says, so changing it goes through
 * the audited function (`rename_firm`, migration 0003), never a direct write.
 */
export default function FirmCard({ data, onChanged }: { data: TeamData; onChanged: () => void }) {
  const t = useTranslations("product");
  const [name, setName] = useState(data.firm.name);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ kind: "saved" } | { kind: "error"; code: string } | null>(null);

  const trimmed = name.trim().replace(/\s+/g, " ");
  const valid = trimmed.length >= 2 && trimmed.length <= 120;
  const changed = trimmed !== data.firm.name;

  const save = async () => {
    if (!valid || !changed || busy) return;
    setBusy(true);
    setStatus(null);
    const result = await renameFirm(trimmed);
    setBusy(false);
    if (!result.ok) {
      setStatus({ kind: "error", code: result.code });
      return;
    }
    setStatus({ kind: "saved" });
    onChanged();
  };

  return (
    <Grid size={12}>
      <CollapsibleCard
        id="team-firm"
        title={t("team-firm-title")}
        summary={data.firm.name}
        description={t("team-firm-body")}
        bodyClassName="gap-5"
      >
        <Grid container spacing={3}>
          <Grid size={{ xs: 12, md: 8 }}>
            <FormControl fullWidth className="outlined" variant="standard" error={!valid}>
              <FormLabel component="label" htmlFor="team-firm-name">
                {t("team-firm-name")}
              </FormLabel>
              <Input
                id="team-firm-name"
                value={name}
                autoComplete="organization"
                onChange={(event) => {
                  setName(event.target.value);
                  setStatus(null);
                }}
                disabled={busy}
                aria-describedby="team-firm-name-help"
              />
              <FormHelperText id="team-firm-name-help">
                {valid ? t("team-firm-name-help") : t("team-error-firm-name")}
              </FormHelperText>
            </FormControl>
          </Grid>
        </Grid>

        {status?.kind === "saved" && (
          <Alert severity="success" className="neutral bg-background-paper/60!">
            {t("team-firm-saved")}
          </Alert>
        )}
        {status?.kind === "error" && (
          <Alert severity="error" className="neutral bg-background-paper/60!">
            {t(teamErrorKey(status.code))}
          </Alert>
        )}

        <Box>
          <Button variant="contained" onClick={() => void save()} disabled={busy || !valid || !changed}>
            {busy ? t("team-working") : t("team-save")}
          </Button>
        </Box>
      </CollapsibleCard>
    </Grid>
  );
}
