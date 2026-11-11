"use client";

import { checkMarketThesis, type MarketHealth, readMarketHealth, releaseMarketTheses } from "../market-actions";
import { useEffect, useState } from "react";

import { Alert, Box, Button, MenuItem, TextField, Typography } from "@mui/material";

import CollapsibleCard from "@/components/product/collapsible-card";
import EmptyState from "@/components/product/empty-state";
import MetricBars from "@/components/product/metric-bars";
import StatusChip from "@/components/product/status-chip";
import IllustrationAnalytics from "@/icons/illustrations/illustration-analytics";
import { formatDate, formatNumber } from "@/lib/admin/format";

/**
 * The jurimetry (migration 0190): how the reading of the market's public decisions goes per court and airline, and
 * the theses read by rule, in the shadow until the operator said the thesis of a sample at the source and the reading
 * agreed in the goal's share. Counts only: a decision keeps no passenger.
 */
export default function MarketCard({ captureOn }: { captureOn: boolean }) {
  const [health, setHealth] = useState<MarketHealth | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => {
    const read = await readMarketHealth().catch(() => ({ ok: false as const, code: "failed" }));
    if (read.ok) setHealth(read.health);
    else setProblem("Não foi possível ler a jurimetria agora.");
  };
  useEffect(() => {
    void load();
  }, []);
  const act = async (work: () => Promise<{ ok: boolean; code?: string }>) => {
    setBusy(true);
    setProblem(null);
    try {
      const result = await work();
      if (!result.ok) {
        setProblem(
          result.code === "goal_not_met"
            ? "A amostra conferida ainda não atinge a meta."
            : result.code === "second_factor"
              ? "Confirme o segundo fator para liberar."
              : "Não foi possível agora.",
        );
      }
      await load();
    } finally {
      setBusy(false);
    }
  };
  const theses = health?.theses;
  const goalMet =
    theses !== undefined &&
    theses.checked >= theses.minChecked &&
    theses.agreed * 100 >= theses.minAgreement * theses.checked;
  return (
    <CollapsibleCard
      id="ai-jurimetry"
      title="Jurimetria: decisões do mercado"
      summary={
        health
          ? `${formatNumber(health.decisions)} decisões lidas · teses ${theses?.released ? "liberadas" : "em sombra"}`
          : "Lendo"
      }
      chip={
        !captureOn ? (
          <StatusChip tone="neutral" label="Leitura desligada neste ambiente" />
        ) : theses?.released ? (
          <StatusChip tone="positive" label="Teses liberadas" />
        ) : null
      }
      description="As decisões públicas contra companhias aéreas, lidas por tribunal e companhia, guardando só a decisão, a unidade, o juiz e a companhia."
      defaultOpen={false}
    >
      {problem ? (
        <Alert severity="error" className="neutral bg-background-paper/60!" onClose={() => setProblem(null)}>
          {problem}
        </Alert>
      ) : null}
      {!health ? null : health.captures.length === 0 ? (
        <EmptyState
          titleAs="h3"
          layout="row"
          framed={false}
          illustration={<IllustrationAnalytics />}
          title="Nada a ler"
          description="Nenhuma companhia tem o nome em juízo registrado para ler as decisões."
        />
      ) : (
        <Box className="flex flex-col gap-4">
          <MetricBars
            whole={false}
            items={health.captures.map((capture) => ({
              key: capture.id,
              label: `${capture.court} · ${capture.party}`,
              value: capture.decisions,
              hint: `Próximo dia ${formatDate(capture.nextDay)} · ${formatNumber(capture.readDays)} dias lidos${
                capture.incompleteDays > 0 ? ` · ${formatNumber(capture.incompleteDays)} dias em parte` : ""
              }${capture.lastError ? ` · última leitura falhou (${capture.lastError})` : ""}`,
            }))}
          />
          {theses ? (
            <Box className="flex flex-col gap-2">
              <Typography variant="subtitle2" component="h3">
                Teses lidas por regra
              </Typography>
              <MetricBars
                total={theses.checked}
                items={[
                  {
                    key: "agreed",
                    label: "A regra concordou com a conferência",
                    value: theses.agreed,
                    tone: "primary",
                  },
                  {
                    key: "differed",
                    label: "A regra divergiu",
                    value: Math.max(theses.checked - theses.agreed, 0),
                    tone: "attention",
                  },
                ]}
              />
              <Typography variant="caption" className="text-text-secondary">
                {`Meta: ${theses.minChecked} decisões conferidas e ${theses.minAgreement}% de acordo.`}
              </Typography>
              <Box>
                <Button
                  variant={theses.released ? "outlined" : "contained"}
                  size="small"
                  disabled={busy || (!theses.released && !goalMet)}
                  onClick={() => void act(() => releaseMarketTheses(!theses.released))}
                >
                  {theses.released ? "Voltar as teses para a sombra" : "Liberar as teses"}
                </Button>
              </Box>
              {health.sample.map((decision) => (
                <Box key={decision.id} className="flex flex-wrap items-center gap-2">
                  <Typography variant="body2" className="min-w-0 flex-1">
                    <a href={decision.url} target="_blank" rel="noopener noreferrer">
                      {`${decision.court} · ${decision.unit ?? "unidade não dita"} · ${formatDate(decision.day)} · ${decision.result}`}
                    </a>
                    {` · a regra leu: ${decision.thesis ?? "nenhuma"}`}
                  </Typography>
                  <TextField
                    select
                    size="small"
                    label="Tese na fonte"
                    value=""
                    disabled={busy}
                    className="min-w-56"
                    onChange={(event) => void act(() => checkMarketThesis(decision.id, event.target.value))}
                  >
                    <MenuItem value="nenhuma">Nenhuma</MenuItem>
                    {health.catalog.map((thesis) => (
                      <MenuItem key={thesis.slug} value={thesis.slug}>
                        {thesis.name}
                      </MenuItem>
                    ))}
                  </TextField>
                </Box>
              ))}
            </Box>
          ) : null}
        </Box>
      )}
    </CollapsibleCard>
  );
}
