"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useCallback, useEffect, useState } from "react";

import { Box, Button, Card, CardContent, Grid, Typography } from "@mui/material";

import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import SecondFactorPrompt from "@/components/product/second-factor-prompt";
import StatusChip from "@/components/product/status-chip";
import { TILE_TONE } from "@/components/product/tile-tone";
import NiShieldCheck from "@/icons/nexture/ni-shield-check";
import { cn } from "@/lib/utils";
import { createClient } from "@flyee/auth/client";

type Factor = { id: string; friendly_name?: string | null; status: string };

/**
 * Where the account's second factor is kept: the factor in use, with the way to take it off, or its setup. The
 * setup is the firm's setup's own (`SecondFactorPrompt`: the QR with its key, the code in six boxes), so the two
 * places a person sets a factor up never differ; the factor in use sits in the same bordered panel, and is taken
 * off only after a confirmation that says what changes (`ConfirmActionDialog`, red: it takes protection away).
 */
export default function TwoFactorCard({ onVerified }: { onVerified?: () => void } = {}) {
  const t = useTranslations("product");
  const router = useRouter();
  const [factors, setFactors] = useState<Factor[] | null>(null);

  const refresh = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase.auth.mfa.listFactors();
    setFactors((data?.all ?? []) as Factor[]);
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // Taking the factor off is asked first: it leaves the account on its password alone. The answer is the
  // dialog's, so a failure keeps it open with what went wrong.
  const [removing, setRemoving] = useState<Factor | null>(null);

  const removeFactor = async (factorId: string): Promise<string | null> => {
    const supabase = createClient();
    const { error: unenrollError } = await supabase.auth.mfa.unenroll({ factorId });
    void refresh();
    if (unenrollError) return t("security-action-error");
    // The session's token still says a factor was verified until it is refreshed, and the layout reads the
    // token: refreshed first, the layout sees the factor gone.
    await supabase.auth.refreshSession();
    router.refresh();
    return null;
  };

  const verifiedFactors = (factors ?? []).filter((factor) => factor.status === "verified");

  return (
    <Grid size={12}>
      <Card component="section">
        <CardContent className="flex flex-col gap-4">
          <Typography variant="h5" component="h2" className="card-title">
            {t("security-two-factor-title")}
          </Typography>
          <Typography variant="body1" className="text-text-secondary">
            {t("security-two-factor-body")}
          </Typography>

          {verifiedFactors.map((factor) => (
            <Box
              key={factor.id}
              className="border-grey-200 flex flex-row flex-wrap items-center gap-4 rounded-2xl border p-5"
            >
              <span
                className={cn(
                  "flex h-12 w-12 flex-none items-center justify-center rounded-2xl",
                  TILE_TONE.primary.bg,
                  TILE_TONE.primary.text,
                )}
              >
                <NiShieldCheck size="medium" />
              </span>
              <Box className="flex min-w-0 flex-1 flex-row flex-wrap items-center gap-2">
                <Typography variant="body1">{factor.friendly_name ?? t("security-authenticator")}</Typography>
                <StatusChip label={t("security-active")} tone="positive" />
              </Box>
              <Button size="small" color="error" variant="text" onClick={() => setRemoving(factor)}>
                {t("security-remove")}
              </Button>
            </Box>
          ))}

          {/* Read before the setup is offered: an account whose factor is on never sees it for a moment. */}
          {factors !== null && verifiedFactors.length === 0 ? (
            <SecondFactorPrompt
              state="missing"
              onConfirmed={() => {
                void refresh();
                onVerified?.();
              }}
            />
          ) : null}
        </CardContent>
      </Card>
      {removing ? (
        <ConfirmActionDialog
          title={t("security-remove-title")}
          intro={t("security-remove-intro")}
          consequences={[
            t("security-remove-consequence-1"),
            t("security-remove-consequence-2"),
            t("security-remove-consequence-3"),
          ]}
          staysTitle={t("security-remove-stays-title")}
          stays={[t("security-remove-stays-1"), t("security-remove-stays-2")]}
          requireReason={false}
          confirmLabel={t("security-remove-confirm")}
          cancelLabel={t("cancel")}
          busyLabel={t("security-remove-busy")}
          tone="danger"
          onConfirm={() => removeFactor(removing.id)}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </Grid>
  );
}
