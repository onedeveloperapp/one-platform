"use client";

import { useTranslations } from "next-intl";

import { Box, Typography } from "@mui/material";

import StateLine from "@/components/product/state-line";
import { ACTION_KEY, type PublicationActionView } from "@/lib/publications/actions-read";

const PENDING_KEY: Record<"cliente" | "escritorio", string> = {
  cliente: "publication-action-pending-client",
  escritorio: "publication-action-pending-firm",
};

/**
 * What ONE read of a publication (migration 0186, item 4.1): the summary for the firm, the action it recommends from
 * the fixed list and why, what the client and the firm owe, and the summary the client reads on their link; said as
 * ONE's and that ONE may err. The lawyer decides.
 */
export default function PublicationActionBox({ view }: { view: PublicationActionView | null }) {
  const t = useTranslations("product");
  if (!view) return null;
  if (view.status === "owed") return <StateLine tone="waiting">{t("publication-action-reading")}</StateLine>;
  if (view.status === "failed" || !view.action) return null;
  const actionKey = ACTION_KEY[view.action];
  return (
    <Box className="border-grey-100 bg-grey-25 flex flex-col gap-2 rounded-xl border p-3">
      <Typography variant="subtitle2" component="p" className="mb-0">
        {t("publication-action-title", { action: t(actionKey) })}
      </Typography>
      {view.firmSummary ? (
        <Typography variant="body2" className="text-text-primary">
          {view.firmSummary}
        </Typography>
      ) : null}
      {view.reason ? (
        <Typography variant="body2" className="text-text-secondary">
          {view.reason}
        </Typography>
      ) : null}
      {view.pending.map((item, index) => (
        // What the client owes is the client's wait, never the firm's task.
        <StateLine key={index} tone={item.from === "cliente" ? "waiting" : "attention"}>
          {t(PENDING_KEY[item.from], { text: item.text })}
        </StateLine>
      ))}
      {view.clientSummary ? (
        <StateLine tone="info">{t("publication-action-client", { text: view.clientSummary })}</StateLine>
      ) : null}
      <Typography variant="caption" className="text-text-secondary">
        {t("publication-action-may-err")}
      </Typography>
    </Box>
  );
}
