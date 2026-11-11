"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, FormControlLabel, Switch, Typography } from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import EmptyState from "@/components/product/empty-state";
import StatusChip from "@/components/product/status-chip";
import NiUsers from "@/icons/nexture/ni-users";
import { autonomyErrorKey } from "@/lib/firm/autonomy";
import { setFirmSigner } from "@/lib/firm/autonomy-actions";

/** A partner or a lawyer of the firm, the states they are at the bar in, and whether they sign what ONE prepares. */
export type FirmSigner = { userId: string; name: string; states: string[]; signs: boolean };

/**
 * Who signs what ONE prepares: the partners and lawyers a partner named. ONE
 * names, for a lawsuit, those of them at the bar in its court's state, and a
 * lawsuit nobody of them can sign waits for one. Closed, it says who signs;
 * it opens by itself while nobody does, since ONE's lawsuits wait for one.
 */
export default function SignersCard({
  signers,
  editable,
  onSaved,
}: {
  signers: FirmSigner[] | null;
  editable: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const signing = (signers ?? []).filter((signer) => signer.signs);

  return (
    <CollapsibleCard
      id="quem-assina-title"
      anchor="quem-assina"
      title={t("autonomy-signers-title")}
      summary={
        signers === null
          ? t("autonomy-signers-load-error")
          : signers.length === 0
            ? t("autonomy-signers-empty-title")
            : signing.length > 0
              ? signing.map((signer) => signer.name).join(", ")
              : t("autonomy-signers-summary-nobody")
      }
      description={t("autonomy-signers-body")}
      defaultOpen={signers === null || signing.length === 0}
      bodyClassName="gap-3"
    >
      {signers === null ? (
        <Alert
          severity="error"
          className="neutral bg-background-paper/60!"
          action={
            <Button color="inherit" size="small" onClick={onSaved}>
              {t("autonomy-retry")}
            </Button>
          }
        >
          {t("autonomy-signers-load-error")}
        </Alert>
      ) : signers.length === 0 ? (
        <EmptyState
          icon={<NiUsers size="large" />}
          titleAs="h3"
          title={t("autonomy-signers-empty-title")}
          description={t("autonomy-signers-empty-body")}
          action={{ label: t("autonomy-signers-empty-action"), href: "/settings/team" }}
        />
      ) : (
        <SignersList
          // Who signs as the page read it last: what a partner switched starts again from it.
          key={signers.map((signer) => `${signer.userId}:${signer.signs}`).join(",")}
          signers={signers}
          editable={editable}
          onSaved={onSaved}
        />
      )}
    </CollapsibleCard>
  );
}

/** The signers, each with its switch for a partner. A switch says its new state at once, and is said back as it is once the page is read again. */
function SignersList({
  signers,
  editable,
  onSaved,
}: {
  signers: FirmSigner[];
  editable: boolean;
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [busy, setBusy] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  // What a partner just switched, until the page read again says the same.
  const [switched, setSwitched] = useState<Record<string, boolean>>({});
  const signs = (signer: FirmSigner) => switched[signer.userId] ?? signer.signs;

  const change = async (signer: FirmSigner, value: boolean) => {
    setBusy(signer.userId);
    setProblem(null);
    try {
      const result = await setFirmSigner(signer.userId, value);
      if (result.ok) setSwitched((before) => ({ ...before, [signer.userId]: value }));
      else setProblem(result.code);
      onSaved();
    } catch {
      setProblem("failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <Box component="ul" className="m-0 flex list-none flex-col gap-2 p-0">
        {signers.map((signer) => {
          const states =
            signer.states.length > 0
              ? t("autonomy-signers-states", { states: signer.states.join(", ") })
              : t("autonomy-signers-no-state");
          return (
            <Box component="li" key={signer.userId} className="flex flex-wrap items-center justify-between gap-2">
              {editable ? (
                <FormControlLabel
                  className="m-0"
                  control={
                    <Switch
                      checked={signs(signer)}
                      disabled={busy !== null}
                      onChange={(event) => void change(signer, event.target.checked)}
                    />
                  }
                  label={
                    <Box className="flex flex-col">
                      <Typography variant="body1">{signer.name}</Typography>
                      <Typography variant="body2" className="text-text-secondary">
                        {states}
                      </Typography>
                    </Box>
                  }
                />
              ) : (
                <>
                  <Box className="min-w-0">
                    <Typography variant="body1">{signer.name}</Typography>
                    <Typography variant="body2" className="text-text-secondary">
                      {states}
                    </Typography>
                  </Box>
                  <StatusChip
                    tone={signs(signer) ? "positive" : "neutral"}
                    label={t(signs(signer) ? "autonomy-signers-signs" : "autonomy-signers-does-not")}
                  />
                </>
              )}
            </Box>
          );
        })}
      </Box>
      {!signers.some((signer) => signs(signer)) && (
        <Alert severity="info" className="neutral bg-background-paper/60!">
          {t("autonomy-signers-none")}
        </Alert>
      )}
      {problem && (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
          {t(autonomyErrorKey(problem))}
        </Alert>
      )}
    </>
  );
}
