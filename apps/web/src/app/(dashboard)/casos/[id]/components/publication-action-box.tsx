"use client";

import { useTranslations } from "next-intl";

import { Box, Typography } from "@mui/material";

import InfoHint from "@/components/product/info-hint";
import StateLine from "@/components/product/state-line";
import { ACTION_KEY, type PublicationActionView } from "@/lib/publications/actions-read";

const PENDING_KEY: Record<"cliente" | "escritorio", string> = {
  cliente: "publication-action-pending-client",
  escritorio: "publication-action-pending-firm",
};

/**
 * What ONE read of a publication (migration 0186, item 4.1), as one block under the court's words (the owner,
 * 2026-11-13, who found a publication disordered: "recomenda: nada a fazer" above "O escritório precisa: registre a
 * audiência", and "O ONE pode errar" three times): the summary for the firm; what ONE recommends doing in the lawsuit,
 * from the fixed list; what the client and the firm owe, each a line; and what the client reads on their link. Why
 * ONE recommends it and that ONE may err sit behind the "i". The lawyer decides.
 */
export default function PublicationActionBox({ view }: { view: PublicationActionView | null }) {
  const t = useTranslations("product");
  if (!view) return null;
  if (view.status === "owed") return <StateLine tone="waiting">{t("publication-action-reading")}</StateLine>;
  if (view.status === "failed" || !view.action) return null;
  const actionKey = ACTION_KEY[view.action];
  return (
    <Box className="border-grey-100 flex flex-col gap-2 rounded-xl border p-3">
      <Box className="flex items-center gap-1">
        <Typography variant="subtitle2" component="h4" className="mb-0">
          {t("publication-action-heading")}
        </Typography>
        <InfoHint
          label={[view.reason, t("publication-action-may-err")].filter(Boolean).join(" ")}
          placement="bottom-start"
          className="self-center"
        />
      </Box>
      {view.firmSummary ? (
        <Typography variant="body2" className="text-text-primary">
          {view.firmSummary}
        </Typography>
      ) : null}
      <StateLine tone={view.action === "nada" ? "done" : "attention"}>
        {t("publication-action-recommends", { action: t(actionKey) })}
      </StateLine>
      {view.pending.map((item, index) => (
        // What the client owes is the client's wait, never the firm's task.
        <StateLine key={index} tone={item.from === "cliente" ? "waiting" : "attention"}>
          {t(PENDING_KEY[item.from], { text: item.text })}
        </StateLine>
      ))}
      {view.clientSummary ? (
        <StateLine tone="info">{t("publication-action-client", { text: view.clientSummary })}</StateLine>
      ) : null}
    </Box>
  );
}
