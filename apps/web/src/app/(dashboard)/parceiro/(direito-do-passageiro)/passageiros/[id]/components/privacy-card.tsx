"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Card, CardContent, Typography } from "@mui/material";

import ConfirmActionDialog from "@/components/product/confirm-action-dialog";
import { exportPassenger, forgetPassenger } from "@/modules/direito-do-passageiro/agency/actions";
import { downloadJson } from "@/modules/direito-do-passageiro/agency/download-json";
import { type PaxDetail, paxErrorKey } from "@/modules/direito-do-passageiro/agency/passengers";

/**
 * The passenger's rights over what the agency keeps (migration 0072): the file of it, for when they ask, and the
 * deletion of it, which who manages the agency confirms after reading what goes and what stays. What the agency
 * keeps is forgotten by itself too, the setting's days after the last trip.
 */
export default function PrivacyCard({ detail, manager }: { detail: PaxDetail; manager: boolean }) {
  const t = useTranslations("product");
  const router = useRouter();
  const traveler = detail.traveler;
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [forgetting, setForgetting] = useState(false);

  const download = async () => {
    setBusy(true);
    setProblem(null);
    const result = await exportPassenger(traveler.id);
    setBusy(false);
    if (!result.ok) {
      setProblem(t(paxErrorKey(result.code)));
      return;
    }
    downloadJson(result.data, "dados-do-passageiro.json");
  };

  return (
    <Card component="section" aria-labelledby="pax-privacy-title">
      <CardContent className="flex flex-col gap-4">
        <Box className="flex flex-col gap-1">
          <Typography id="pax-privacy-title" variant="h5" component="h2" className="mb-0">
            {t("pax-privacy-title")}
          </Typography>
          <Typography variant="body2" className="text-text-secondary">
            {t("pax-privacy-help")}
          </Typography>
        </Box>
        {problem && <Alert severity="error">{problem}</Alert>}
        <Box className="flex flex-wrap gap-2">
          <Button variant="outlined" color="grey" disabled={busy} onClick={() => void download()}>
            {busy ? t("pax-privacy-downloading") : t("pax-privacy-download")}
          </Button>
          {manager && (
            <Button variant="text" color="error" disabled={busy} onClick={() => setForgetting(true)}>
              {t("pax-privacy-forget")}
            </Button>
          )}
        </Box>
      </CardContent>

      {forgetting && (
        <ConfirmActionDialog
          title={t("pax-privacy-forget-title", { name: traveler.fullName })}
          consequences={[
            t("pax-privacy-forget-consequence-1"),
            t("pax-privacy-forget-consequence-2"),
            ...(detail.children.length > 0 ? [t("pax-privacy-forget-consequence-children")] : []),
          ]}
          staysTitle={t("pax-privacy-forget-stays-title")}
          stays={[t("pax-privacy-forget-stays")]}
          requireReason={false}
          confirmLabel={t("pax-privacy-forget-confirm")}
          cancelLabel={t("pax-cancel")}
          busyLabel={t("pax-privacy-forgetting")}
          tone="danger"
          onConfirm={async () => {
            const result = await forgetPassenger(traveler.id);
            if (!result.ok) return t(paxErrorKey(result.code));
            router.push("/parceiro/passageiros");
            return null;
          }}
          onClose={() => setForgetting(false)}
        />
      )}
    </Card>
  );
}
