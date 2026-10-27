"use client";

import { type TeamData, teamErrorKey } from "../team-types";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Box, Button, Grid } from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import { leaveFirm } from "@/lib/firm/actions";

/**
 * Leaving the firm. Anybody may, except its owner: a firm always has one, so
 * the owner hands it over first (from a colleague's menu in the roster) and
 * the card says so instead of offering a button that would be refused.
 */
export default function LeaveCard({ data }: { data: TeamData }) {
  const t = useTranslations("product");
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const owner = data.me.role === "owner";

  const leave = async (): Promise<string | null> => {
    const result = await leaveFirm();
    if (!result.ok) return t(teamErrorKey(result.code));
    // The account now belongs to no firm: the next screen is where it founds
    // one or accepts an invitation.
    router.push("/auth/complete-profile");
    router.refresh();
    return null;
  };

  return (
    <Grid size={12}>
      <CollapsibleCard
        id="team-leave"
        title={t("team-leave-title")}
        summary={
          owner
            ? t("team-leave-summary-owner", { firm: data.firm.name })
            : t("team-leave-summary", { firm: data.firm.name })
        }
        description={
          owner ? t("team-leave-owner", { firm: data.firm.name }) : t("team-leave-body", { firm: data.firm.name })
        }
      >
        {!owner && (
          <Box>
            <Button variant="outlined" color="grey" onClick={() => setConfirming(true)}>
              {t("team-leave-action")}
            </Button>
          </Box>
        )}
      </CollapsibleCard>

      {confirming && (
        <ConfirmActionDialog
          requireReason={false}
          tone="danger"
          title={t("team-leave-confirm-title", { firm: data.firm.name })}
          consequences={[t("team-leave-does-1", { firm: data.firm.name }), t("team-leave-does-2")]}
          staysTitle={t("team-confirm-stays")}
          stays={[t("team-leave-stays")]}
          confirmLabel={t("team-leave-action")}
          cancelLabel={t("team-cancel")}
          busyLabel={t("team-working")}
          onConfirm={leave}
          onClose={() => setConfirming(false)}
        />
      )}
    </Grid>
  );
}
