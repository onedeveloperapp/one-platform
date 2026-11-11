"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { Alert, Box, Button, Card, CardContent, Typography } from "@mui/material";

import StateLine from "@/components/product/state-line";
import { answerClientJudgment } from "@/lib/cases/client-link-actions";
import type { ClientJudgment } from "@/lib/cases/judgment-paths";

const brl = (cents: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);

/**
 * The judgment of the client's lawsuit and what an appeal would cost them (migration 0185): the client learns the
 * costs before the firm decides, and says whether they agree; the lawyer decides with it. Shown once there is a
 * judgment the firm did not decide on yet, or what the client said of one.
 */
export default function ClientJudgment({
  token,
  items,
  onSaved,
}: {
  token: string;
  items: ClientJudgment[];
  onSaved: () => void;
}) {
  const t = useTranslations("product");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const shown = items.filter((item) => item.result && (item.decision === null || item.agrees !== null));
  if (shown.length === 0) return null;

  const send = async (id: string, agrees: boolean) => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await answerClientJudgment(token, id, agrees);
      if (result.ok) onSaved();
      else setProblem(result.code);
    } catch {
      setProblem("failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card component="section" aria-labelledby="client-judgment-title">
      <CardContent className="flex flex-col gap-4">
        <Typography id="client-judgment-title" variant="h6" component="h2" className="mb-0">
          {t("client-judgment-title")}
        </Typography>
        {problem ? (
          <Alert severity="error" className="neutral bg-background-paper/60!" role="alert">
            {t("client-judgment-error")}
          </Alert>
        ) : null}
        {shown.map((item) => {
          const resultKey =
            item.result === "procedente"
              ? "client-judgment-won"
              : item.result === "parcial"
                ? "client-judgment-partly"
                : "client-judgment-lost";
          const costsKey = item.freeJustice ? "client-judgment-costs-free" : "client-judgment-costs";
          const answerKey = item.agrees ? "client-judgment-agreed" : "client-judgment-refused";
          return (
            <Box key={item.id} className="flex flex-col gap-3">
              <Typography variant="body1">{t(resultKey, { value: item.cents ? brl(item.cents) : "" })}</Typography>
              <Typography variant="body2" className="text-text-secondary">
                {t(costsKey)}
              </Typography>
              {item.agrees !== null ? (
                <StateLine tone="done">{t(answerKey)}</StateLine>
              ) : (
                <Box className="flex flex-wrap gap-2">
                  <Button variant="contained" disabled={busy} onClick={() => void send(item.id, true)}>
                    {t("client-judgment-agree")}
                  </Button>
                  <Button variant="outlined" color="grey" disabled={busy} onClick={() => void send(item.id, false)}>
                    {t("client-judgment-refuse")}
                  </Button>
                </Box>
              )}
            </Box>
          );
        })}
      </CardContent>
    </Card>
  );
}
